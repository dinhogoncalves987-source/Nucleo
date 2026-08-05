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
import { router as searchRouter } from './search'
import { router as asaasRouter, handleAsaasWebhook } from './asaas'
import { createApiSecretAuth } from './api-secret-auth'
import axios from 'axios'

const app = express()
const PORT = process.env.PORT ?? 3001

// ── Supabase (service role — backend only) ────────────────────
export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// ── Middleware ────────────────────────────────────────────────
app.use(cors({ origin: '*' }))
app.use(express.json({ limit: '10mb' }))

// Auth middleware para rotas da API
app.use('/api', createApiSecretAuth(process.env.API_SECRET))

// ── Health check (sem auth) ───────────────────────────────────
app.get('/health', (_, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  })
})

// ── James API (voz, transcrição, TTS) ────────────────────────
app.use('/api/james', jamesRouter)

// ── Search API ────────────────────────────────────────────────
app.use('/api/search', searchRouter)

// ── Asaas webhook ─────────────────────────────────────────────
app.post('/webhook/asaas', express.json(), handleAsaasWebhook)
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
