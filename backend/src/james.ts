// ============================================================
// james.ts — Engine de Resposta Inbound 24/7 (WhatsApp)
// !! Lógica de IA centralizada em services/james-engine.ts !!
// ============================================================
import { sendMessageViaChip } from './chips'
import { supabase } from './server'
import { logger } from './logger'
import { handleJamesRequest } from './services/james-engine'

// ── Tipos ─────────────────────────────────────────────────────
interface EvolutionEvent {
  event: string
  instance: string
  data: {
    key: { remoteJid: string; fromMe: boolean }
    message: { conversation?: string; extendedTextMessage?: { text: string } }
    pushName?: string
  }
}

// ── Processa mensagem inbound (chamado pelo worker BullMQ) ────
export async function processInboundMessage(event: EvolutionEvent): Promise<void> {
  try {
    const { data, instance } = event
    if (data.key.fromMe) return // ignora mensagens próprias

    const phone = data.key.remoteJid.replace('@s.whatsapp.net', '').replace('55', '')
    const name  = data.pushName ?? 'Cliente'
    const text  = data.message?.conversation
               ?? data.message?.extendedTextMessage?.text
               ?? ''

    if (!text.trim()) return

    logger.info(`[JAMES INBOUND] ${name} (${phone}): "${text.substring(0, 60)}"`)

    // Busca contexto do lead + tenant em paralelo
    const [leadRes, chipRes] = await Promise.all([
      supabase.from('leads')
        .select('id, status, tenant_id')
        .ilike('phone', `%${phone.slice(-8)}%`)
        .maybeSingle(),
      supabase.from('api_keys')
        .select('tenant_id, tenants(name)')
        .eq('api_key', instance)
        .maybeSingle(),
    ])

    const lead       = leadRes.data
    const chipMapping = chipRes.data
    const tenantId   = chipMapping?.tenant_id ?? lead?.tenant_id ?? 'default'
    const tenantName = (chipMapping?.tenants as { name?: string } | null)?.name ?? 'O Núcleo'
    const affiliateLink = `https://app.thebeautyhub.com.br/agendar?ref=${instance}`

    // Chama o engine central — única fonte de lógica de IA
    const reply = await handleJamesRequest({
      message:       text,
      tenant_id:     tenantId,
      origin:        'whatsapp',
      clientName:    name,
      clientPhone:   phone,
      affiliateLink,
      isKnownLead:   !!lead,
      leadStatus:    lead?.status,
    })

    // Envia resposta pelo mesmo chip
    await sendMessageViaChip(instance, phone, reply)

    // Atualiza status do lead (non-blocking)
    if (lead) {
      void supabase.from('leads').update({ status: 'contacted' }).eq('id', lead.id)
    } else {
      void supabase.from('leads').insert({
        name, phone,
        tenant_id:         tenantId,
        source:            'inbound_whatsapp',
        status:            'contacted',
        validation_status: 'valid',
      })
    }

  } catch (err) {
    logger.error('[JAMES INBOUND] Erro ao processar', err)
    throw err // BullMQ vai tentar de novo (retry)
  }
}
