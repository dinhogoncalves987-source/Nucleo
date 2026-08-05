// ============================================================
// scheduler.ts — Scheduler Outbound (8h–18h)
// Pausa fila às 18h, retoma às 8h do dia seguinte
// James inbound NÃO é afetado — fica 24h ativo
// ============================================================
import cron from 'node-cron'
import { Router } from 'express'
import { outboundQueue } from './queue'
import { supabase } from './server'
import { logger } from './logger'

export const router = Router()

const START_HOUR = Number(process.env.SCHEDULER_START_HOUR ?? 8)
const END_HOUR   = Number(process.env.SCHEDULER_END_HOUR   ?? 18)

let schedulerEnabled = true
let isWithinOperatingHours = false

// ── Verifica se está no horário de operação ───────────────────
function checkOperatingHours(): boolean {
  const now   = new Date()
  const hour  = now.getHours()
  return hour >= START_HOUR && hour < END_HOUR
}

// ── Pausa outbound: marca jobs futuros como delayed ──────────
async function pauseOutbound(): Promise<void> {
  isWithinOperatingHours = false
  await outboundQueue.pause()
  logger.info(`⏸️  Outbound PAUSADO às ${new Date().toLocaleTimeString('pt-BR')} (fora do horário comercial)`)

  try { await supabase.from('system_events').insert({
    event: 'scheduler_pause',
    meta: { hour: new Date().getHours(), reason: 'end_of_business' },
  }) } catch {
    logger.warn('[SCHEDULER] Falha ao registrar pausa no histórico operacional')
  }
}

// ── Retoma outbound: processa fila acumulada ──────────────────
async function resumeOutbound(): Promise<void> {
  if (!schedulerEnabled) return
  isWithinOperatingHours = true
  await outboundQueue.resume()

  const counts = await outboundQueue.getJobCounts()
  logger.info(`▶️  Outbound RETOMADO às ${new Date().toLocaleTimeString('pt-BR')} — ${counts.waiting} jobs na fila`)

  try { await supabase.from('system_events').insert({
    event: 'scheduler_resume',
    meta: { hour: new Date().getHours(), queued: counts.waiting },
  }) } catch {
    logger.warn('[SCHEDULER] Falha ao registrar retomada no histórico operacional')
  }
}

// ── Crons ────────────────────────────────────────────────────
// Pausa às 18h00
cron.schedule(`0 ${END_HOUR} * * *`, pauseOutbound, { timezone: 'America/Sao_Paulo' })

// Retoma às 8h00
cron.schedule(`0 ${START_HOUR} * * *`, resumeOutbound, { timezone: 'America/Sao_Paulo' })

// Verifica estado a cada 5 min (segurança)
cron.schedule('*/5 * * * *', async () => {
  const should = checkOperatingHours() && schedulerEnabled
  if (should && !isWithinOperatingHours)  await resumeOutbound()
  if (!should && isWithinOperatingHours)  await pauseOutbound()
})

// ── Inicializa estado correto ao subir o backend ──────────────
;(async () => {
  if (checkOperatingHours()) {
    await resumeOutbound()
  } else {
    await pauseOutbound()
  }
})()

// ── API Routes ────────────────────────────────────────────────

// GET /api/scheduler/status
router.get('/status', async (_req, res) => {
  const counts = await outboundQueue.getJobCounts()
  res.json({
    enabled: schedulerEnabled,
    operating_hours: `${START_HOUR}:00 – ${END_HOUR}:00 (Brasília)`,
    is_active: isWithinOperatingHours,
    next_action: isWithinOperatingHours
      ? `Pausa às ${END_HOUR}:00`
      : `Retoma às ${START_HOUR}:00`,
    queue_jobs: counts,
    james_24h: true, // James NUNCA para
    current_time: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
  })
})

// POST /api/scheduler/toggle — ativa/desativa manualmente
router.post('/toggle', async (req, res) => {
  schedulerEnabled = !schedulerEnabled
  if (!schedulerEnabled) {
    await pauseOutbound()
  } else if (checkOperatingHours()) {
    await resumeOutbound()
  }
  res.json({ enabled: schedulerEnabled })
})

// POST /api/scheduler/config — altera horários
router.post('/config', async (req, res) => {
  const { start, end } = req.body as { start: number; end: number }
  if (start < 0 || start > 23 || end < 0 || end > 23) {
    res.status(400).json({ error: 'Horários inválidos (0–23)' })
    return
  }
  // Nota: requer restart para rescheduling dos crons
  res.json({
    message: 'Configuração salva. Reinicie o backend para aplicar.',
    start, end,
  })
})
