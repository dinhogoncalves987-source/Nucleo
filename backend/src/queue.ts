// ============================================================
// queue.ts — Filas BullMQ (Outbound + Inbound)
// Redis-backed, SLA < 30s para inbound (James 24h)
// ============================================================
import { Queue, Worker, QueueEvents, Job } from 'bullmq'
import { Router } from 'express'
import IORedis from 'ioredis'
import { sendMessageViaChip, pickActiveChip } from './chips'
import { processInboundMessage } from './james'
import { logger } from './logger'

const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
}) as any // eslint-disable-line -- BullMQ bundles its own ioredis types

export const router = Router()

// ── Filas ─────────────────────────────────────────────────────
export const outboundQueue = new Queue('outbound', { connection })   // Predador (8h–18h)
export const inboundQueue  = new Queue('inbound',  { connection })   // James (24h)
export const warmupQueue   = new Queue('warmup',   { connection })   // Aquecimento chips

// ── Worker OUTBOUND (disparo de campanhas) ────────────────────
const outboundWorker = new Worker('outbound', async (job: Job) => {
  const { phone, message, leadId, chipId } = job.data as {
    phone: string; message: string; leadId: string; chipId?: string
  }

  const chip = chipId ?? await pickActiveChip()
  if (!chip) throw new Error('Nenhum chip ativo disponível')

  const ok = await sendMessageViaChip(chip, phone, message)
  if (!ok) throw new Error(`Falha ao enviar via chip ${chip}`)

  logger.info(`[OUTBOUND] Lead ${leadId} → ${phone} via ${chip}`)
  return { sent: true, chip, phone }

}, {
  connection,
  concurrency: 10,          // máx 10 disparos simultâneos
  limiter: { max: 30, duration: 60_000 }, // 30 msgs/min por worker
})

// ── Worker INBOUND (James 24h) ────────────────────────────────
const inboundWorker = new Worker('inbound', async (job: Job) => {
  const start = Date.now()
  await processInboundMessage(job.data)
  const elapsed = Date.now() - start

  if (elapsed > 30_000) {
    logger.warn(`[INBOUND] SLA violado: ${elapsed}ms (limite: 30000ms)`)
  } else {
    logger.info(`[INBOUND] Processado em ${elapsed}ms`)
  }
}, {
  connection,
  concurrency: 20,          // James pode processar 20 msgs em paralelo
})

// ── Worker WARMUP ─────────────────────────────────────────────
const warmupWorker = new Worker('warmup', async (job: Job) => {
  const { fromChip, toChip, message } = job.data as {
    fromChip: string; toChip: string; message: string
  }
  await sendMessageViaChip(fromChip, toChip, message)
  logger.info(`[WARMUP] ${fromChip} → ${toChip}`)
}, { connection, concurrency: 5 })

// ── Event listeners ───────────────────────────────────────────
;[outboundWorker, inboundWorker, warmupWorker].forEach(w => {
  w.on('failed', (job, err) => logger.error(`Job ${job?.id} falhou: ${err.message}`))
  w.on('error', err => logger.error('Worker error', err))
})

// ── API Routes ────────────────────────────────────────────────

// GET /api/queue/stats — status de todas as filas
router.get('/stats', async (_req, res) => {
  const [outCounts, inCounts, wuCounts] = await Promise.all([
    outboundQueue.getJobCounts(),
    inboundQueue.getJobCounts(),
    warmupQueue.getJobCounts(),
  ])
  res.json({
    outbound: outCounts,
    inbound:  inCounts,
    warmup:   wuCounts,
    timestamp: new Date().toISOString(),
  })
})

// POST /api/queue/add — adiciona job de disparo manualmente
router.post('/add', async (req, res) => {
  const { phone, message, leadId, delay = 0 } = req.body as {
    phone: string; message: string; leadId: string; delay?: number
  }
  const job = await outboundQueue.add('send_message', { phone, message, leadId }, {
    delay,          // em ms, usado pelo scheduler para pausar à noite
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  })
  res.json({ jobId: job.id, queued: true })
})

// POST /api/queue/clear — limpa fila (admin)
router.post('/clear', async (req, res) => {
  const { queue } = req.body as { queue: 'outbound' | 'inbound' | 'warmup' }
  const q = queue === 'outbound' ? outboundQueue : queue === 'inbound' ? inboundQueue : warmupQueue
  await q.obliterate({ force: true })
  res.json({ cleared: true, queue })
})

// GET /api/queue/jobs/:queue — lista jobs recentes
router.get('/jobs/:queue', async (req, res) => {
  const q = req.params.queue === 'outbound' ? outboundQueue : inboundQueue
  const jobs = await q.getJobs(['active', 'waiting', 'delayed', 'failed'], 0, 50)
  res.json(jobs.map(j => ({
    id: j.id, name: j.name, data: j.data,
    status: j.finishedOn ? 'done' : 'pending',
    createdAt: new Date(j.timestamp).toISOString(),
  })))
})

export { connection }
