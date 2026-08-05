// ============================================================
// chips.ts — Gerenciamento de 100 Instâncias WhatsApp
// Via Evolution API REST
// ============================================================
import { Router } from 'express'
import axios from 'axios'
import { logger } from './logger'

export const router = Router()

const EVO_URL  = process.env.EVOLUTION_API_URL ?? 'http://localhost:8080'
const EVO_KEY  = process.env.EVOLUTION_API_KEY ?? ''
const MAX_CHIPS = Number(process.env.MAX_CHIPS ?? 100)

// ── Axios client para Evolution API ──────────────────────────
const evo = axios.create({
  baseURL: EVO_URL,
  headers: { apikey: EVO_KEY },
  timeout: 10_000,
})

// ── Tipos ─────────────────────────────────────────────────────
export interface Chip {
  id: string          // ex: chip_001
  name: string        // nome da instância no Evolution
  status: 'connecting' | 'active' | 'banned' | 'warming' | 'paused'
  warmup_day: number  // 0–7 (0 = novo)
  phone: string       // número conectado
  messages_sent_today: number
  qr_code?: string
}

// ── GET /api/chips — lista todos os chips ────────────────────
router.get('/', async (_req, res) => {
  try {
    const { data } = await evo.get('/instance/fetchInstances')
    const chips: Chip[] = (data ?? []).map((inst: Record<string, unknown>, i: number) => ({
      id: `chip_${String(i + 1).padStart(3, '0')}`,
      name: String(inst.instance ?? ''),
      status: mapEvolutionStatus(String(inst.connectionStatus ?? '')),
      warmup_day: 0,
      phone: String(inst.ownerJid ?? '').replace('@s.whatsapp.net', ''),
      messages_sent_today: 0,
    }))
    res.json({ chips, total: chips.length, active: chips.filter(c => c.status === 'active').length })
  } catch (err) {
    logger.error('Erro ao listar chips', err)
    res.status(500).json({ error: 'Falha ao listar instâncias' })
  }
})

// ── POST /api/chips/create — cria nova instância ─────────────
router.post('/create', async (req, res) => {
  const { chipId } = req.body as { chipId: string }
  try {
    await evo.post('/instance/create', {
      instanceName: chipId,
      qrcode: true,
      integration: 'WHATSAPP-BAILEYS',
      reject_call: true,
      msg_call: 'Não realizamos atendimento por chamadas.',
      groups_ignore: true,
    })
    logger.info(`Chip criado: ${chipId}`)
    res.json({ created: true, chipId })
  } catch (err) {
    logger.error(`Erro ao criar chip ${chipId}`, err)
    res.status(500).json({ error: 'Falha ao criar instância' })
  }
})

// ── GET /api/chips/:id/qr — obtém QR code para escanear ─────
router.get('/:id/qr', async (req, res) => {
  try {
    const { data } = await evo.get(`/instance/connect/${req.params.id}`)
    res.json({ qr: data?.qrcode?.base64 ?? null })
  } catch {
    res.status(500).json({ error: 'Falha ao gerar QR' })
  }
})

// ── DELETE /api/chips/:id — desconecta e remove chip ─────────
router.delete('/:id', async (req, res) => {
  try {
    await evo.delete(`/instance/delete/${req.params.id}`)
    res.json({ deleted: true })
  } catch {
    res.status(500).json({ error: 'Falha ao remover instância' })
  }
})

// ── POST /api/chips/:id/send — envia mensagem por um chip ────
export async function sendMessageViaChip(
  chipId: string,
  phone: string,
  message: string
): Promise<boolean> {
  try {
    await evo.post(`/message/sendText/${chipId}`, {
      number: `55${phone.replace(/\D/g, '')}`,
      text: message,
    })
    logger.info(`Mensagem enviada via ${chipId} → ${phone}`)
    return true
  } catch (err) {
    logger.error(`Falha no chip ${chipId}`, err)
    return false
  }
}

// ── Seleciona o melhor chip disponível (round-robin) ─────────
let currentChipIndex = 0
export async function pickActiveChip(): Promise<string | null> {
  try {
    const { data } = await evo.get('/instance/fetchInstances')
    const active = (data ?? [])
      .filter((i: Record<string, unknown>) => i.connectionStatus === 'open')
      .map((i: Record<string, unknown>) => String(i.instance ?? ''))

    if (active.length === 0) return null
    const chip = active[currentChipIndex % active.length]!
    currentChipIndex++
    return chip
  } catch {
    return null
  }
}

function mapEvolutionStatus(s: string): Chip['status'] {
  if (s === 'open') return 'active'
  if (s === 'connecting') return 'connecting'
  if (s === 'close') return 'paused'
  return 'paused'
}

// ── Bootstrap: cria chips_001..100 se não existirem ──────────
export async function bootstrapChips(): Promise<void> {
  const { data: existing } = await evo.get('/instance/fetchInstances').catch(() => ({ data: [] }))
  const names = new Set((existing ?? []).map((i: Record<string, unknown>) => String(i.instance ?? '')))
  const toCreate = Array.from({ length: MAX_CHIPS }, (_, i) => `chip_${String(i + 1).padStart(3, '0')}`)
    .filter(c => !names.has(c))

  for (const chipId of toCreate.slice(0, 5)) { // cria em lotes de 5
    await evo.post('/instance/create', { instanceName: chipId, qrcode: true, integration: 'WHATSAPP-BAILEYS' })
      .catch(e => logger.warn(`Bootstrap chip ${chipId}: ${e.message}`))
    await new Promise(r => setTimeout(r, 500))
  }
  logger.info(`Bootstrap: ${toCreate.length} chips pendentes de conexão`)
}
