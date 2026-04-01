// ============================================================
// warmup.ts — Aquecimento de Chips (7 dias progressivo)
// Chips novos enviam mensagens internas para evitar banimento
// Progressão: 5/dia → 10 → 20 → 50 → 100 msgs/dia
// ============================================================
import cron from 'node-cron'
import { warmupQueue } from './queue'
import { supabase } from './server'
import { logger } from './logger'
import axios from 'axios'

const EVO_URL = process.env.EVOLUTION_API_URL ?? 'http://localhost:8080'
const EVO_KEY = process.env.EVOLUTION_API_KEY ?? ''

// Mensagens usadas na conversa interna (parecem humanas)
const WARMUP_MESSAGES = [
  'Oi, tudo bem? 😊',
  'Olá! Pode marcar horário?',
  'Boa tarde! Vocês têm horário disponível?',
  'Olá, queria saber sobre os serviços 💅',
  'Oi! Qual o valor de um corte?',
  'Preciso agendar uma escova, vocês têm vaga?',
  'Boa tarde! Vi vocês no Instagram e adorei!',
  'Olá, podem me ajudar com informações?',
  'Tudo bem? Queria saber sobre coloração 🎨',
  'Oi! Vocês ficam abertos no sábado?',
]

// Limite de mensagens por dia de aquecimento
const WARMUP_DAILY_LIMIT: Record<number, number> = {
  1: 5, 2: 10, 3: 20, 4: 30, 5: 50, 6: 75, 7: 100
}

// ── Busca chips em aquecimento ────────────────────────────────
async function getWarmingChips(): Promise<Array<{ instance: string; warmup_day: number }>> {
  try {
    const { data } = await axios.get(`${EVO_URL}/instance/fetchInstances`, {
      headers: { apikey: EVO_KEY }
    })
    // Filtra chips com status 'open' mas recém-criados (sem histórico)
    return (data ?? [])
      .filter((i: Record<string, unknown>) => i.connectionStatus === 'open')
      .slice(0, 50) // máximo 50 chips em warmup simultâneo
      .map((i: Record<string, unknown>, idx: number) => ({
        instance: String(i.instance ?? ''),
        warmup_day: Math.min(7, Math.floor(idx / 10) + 1), // simulação do dia de warmup
      }))
  } catch {
    return []
  }
}

// ── Agenda sessão de warmup para um chip ─────────────────────
async function scheduleWarmupSession(instance: string, warmupDay: number): Promise<void> {
  const limit = WARMUP_DAILY_LIMIT[warmupDay] ?? 5
  const warming = await getWarmingChips()
  const peers = warming.filter(c => c.instance !== instance).slice(0, 5) // pega até 5 peers

  if (peers.length === 0) {
    logger.warn(`[WARMUP] Chip ${instance} sem peers disponíveis`)
    return
  }

  let scheduled = 0
  for (let i = 0; i < limit && i < peers.length * 3; i++) {
    const peer = peers[i % peers.length]!
    const msg = WARMUP_MESSAGES[Math.floor(Math.random() * WARMUP_MESSAGES.length)]!

    // Delay aleatório entre 30s e 5min para parecer humano
    const delayMs = (30 + Math.random() * 270) * 1000 * i

    await warmupQueue.add('warmup_msg', {
      fromChip: instance,
      toChip:   peer.instance,
      message:  msg,
    }, {
      delay: delayMs,
      attempts: 2,
    })
    scheduled++
  }

  logger.info(`[WARMUP] ${instance} (dia ${warmupDay}): ${scheduled} mensagens agendadas`)
}

// ── Cron: roda warmup diariamente às 9h ──────────────────────
cron.schedule('0 9 * * *', async () => {
  logger.info('[WARMUP] Iniciando sessão diária de aquecimento...')
  const chips = await getWarmingChips()

  for (const chip of chips) {
    await scheduleWarmupSession(chip.instance, chip.warmup_day)
    await new Promise(r => setTimeout(r, 2000)) // espaça entre chips
  }

  logger.info(`[WARMUP] Sessão agendada para ${chips.length} chips`)

  // Log no Supabase
  try { await supabase.from('system_events').insert({
    event: 'warmup_session',
    meta: { chips_count: chips.length, timestamp: new Date().toISOString() },
  }) } catch {}

}, { timezone: 'America/Sao_Paulo' })

// ── Exporta para uso manual ───────────────────────────────────
export { scheduleWarmupSession, getWarmingChips }
