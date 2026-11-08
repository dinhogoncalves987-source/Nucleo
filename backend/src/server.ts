// ============================================================
// server.ts — API Principal do Backend O Núcleo
// Express + BullMQ (opcional) + Scheduler + James Engine
// ============================================================
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { createClient } from '@supabase/supabase-js'
import { logger } from './logger'
import { router as jamesRouter } from './routes/james'
import { conversationRouter } from './routes/james-conversation'
import { router as searchRouter } from './search'
import { router as asaasRouter, handleAsaasWebhook } from './asaas'
import { createApiSecretAuth } from './api-secret-auth'
import { createSupabaseJwtAuth } from './auth/jwt-auth'
import { createSupabaseClaimsVerifier } from './auth/supabase-jwt-verifier'
import { createTenantContext } from './auth/tenant-context'
import { demoMutationGuard, isDemoMode } from './runtime'
import { router as integrationsRouter } from './routes/integrations'
import axios from 'axios'

const app = express()
const PORT = process.env.PORT ?? 3001

// ── Supabase (service role — backend only) ────────────────────
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// ── Middleware ────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  .split(',').map(value => value.trim()).filter(Boolean)
app.use(cors({ origin: allowedOrigins, credentials: true }))
app.use(express.json({ limit: '10mb' }))

const requestBuckets = new Map<string, { count: number; resetAt: number }>()
app.use('/api', (req, res, next) => {
  const now = Date.now()
  const key = req.ip || 'unknown'
  const bucket = requestBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    requestBuckets.set(key, { count: 1, resetAt: now + 60_000 }); next(); return
  }
  bucket.count += 1
  if (bucket.count > 120) { res.status(429).json({ error: 'Muitas requisicoes' }); return }
  next()
})

// Auth middleware para rotas da API
app.use('/api', createSupabaseJwtAuth(createSupabaseClaimsVerifier(supabase.auth)))
app.use('/api', createTenantContext(supabase))
app.use(demoMutationGuard)
app.use('/internal', createApiSecretAuth(process.env.API_SECRET))

// ── Health check (sem auth) ───────────────────────────────────
app.get('/health', (_, res) => {
  res.json({
    status: 'ok',
    mode: isDemoMode ? 'demo' : 'production',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
})

app.get('/ready', async (_, res) => {
  const { error } = await supabase.from('profiles').select('id', { head: true, count: 'exact' }).limit(1)
  const ready = !error
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready', mode: isDemoMode ? 'demo' : 'production',
    dependencies: { supabase: ready ? 'up' : 'down', redis: 'checked_by_queue_monitor', evolution: isDemoMode ? 'disabled_demo' : 'checked_by_chips_monitor' },
  })
})

// ── James API (voz, transcrição, TTS) ────────────────────────
app.use('/api/james', conversationRouter)
app.use('/api/james', jamesRouter)

// ── Search API ────────────────────────────────────────────────
app.use('/api/search', searchRouter)
app.use('/api/integrations', integrationsRouter)

// ── Asaas webhook ─────────────────────────────────────────────
app.post('/webhook/asaas', express.json(), (req, res) => {
  if (isDemoMode) { res.json({ received: true, simulated: true }); return }
  void handleAsaasWebhook(req, res)
})
app.use('/api/asaas', asaasRouter)

// ── BullMQ + Redis (carrega de forma lazy — não crasha se Redis offline) ──
async function loadQueueServices() {
  try {
    const { router: queueRouter, inboundQueue } = await import('./queue')
    const { router: chipsRouter } = await import('./chips')
    const { router: schedulerRouter } = await import('./scheduler')
    const { handlePersonalJames } = await import('./james-personal')

    app.use('/api/chips', chipsRouter)
    app.use('/api/queue', queueRouter)
    app.use('/api/scheduler', schedulerRouter)

    // Webhook Evolution (James WhatsApp inbound)
    app.post('/webhook/evolution', express.json(), async (req, res) => {
      try {
        if (isDemoMode) { res.json({ received: true, simulated: true }); return }
        const event = req.body
        logger.info('Webhook Evolution recebido', { event: event.event, instance: event.instance })

        if (event.event === 'messages.upsert' && event.data?.message) {
          const { data, instance } = event
          if (data.key.fromMe) { res.json({ received: true }); return }

          const phone = data.key.remoteJid.replace('@s.whatsapp.net', '').replace(/^55/, '')
          const edsonPhone = (process.env.EDSON_PHONE ?? '').replace(/\D/g, '')

          if (edsonPhone && phone.endsWith(edsonPhone.slice(-8))) {
            const text = data.message?.conversation ?? data.message?.extendedTextMessage?.text ?? ''
            const name = data.pushName ?? 'Edson'
            if (text.trim()) {
              handlePersonalJames({
                instance, phone, name, text,
                sendReply: async (reply: string) => {
                  const apiUrl = process.env.EVOLUTION_API_URL ?? 'http://localhost:8080'
                  const apiKey = process.env.EVOLUTION_API_KEY ?? ''
                  await axios.post(
                    `${apiUrl}/message/sendText/${instance}`,
                    { number: `55${phone}@s.whatsapp.net`, text: reply },
                    { headers: { apikey: apiKey }, timeout: 10000 },
                  )
                }
              }).catch(err => logger.error('[JAMES PESSOAL] Erro', err))
            }
          } else {
            await inboundQueue.add('inbound_message', event, {
              priority: 1, attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
            })
          }
        }
        res.json({ received: true })
      } catch (err) {
        logger.error('Erro no webhook Evolution', err)
        res.status(500).json({ error: 'Webhook processing failed' })
      }
    })

    logger.info('✅ BullMQ + Redis: workers ativos')
  } catch {
    logger.warn('⚠️  BullMQ/Redis offline — WhatsApp desativado. James frontend ativo normalmente.')
  }
}

// ── Start ─────────────────────────────────────────────────────
// Prevent unhandled rejections from crashing the process (Redis, BullMQ workers)
process.on('unhandledRejection', (reason) => {
  logger.warn(`[Process] Unhandled rejection (non-fatal): ${reason}`)
})

app.listen(PORT, async () => {
  logger.info(`🚀 O Núcleo backend rodando na porta ${PORT}`)
  logger.info(`🤖 James: POST /api/james/think | /transcribe | /tts`)
  await loadQueueServices()
})

export default app
