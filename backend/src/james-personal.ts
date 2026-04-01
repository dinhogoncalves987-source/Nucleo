// ============================================================
// james-personal.ts — James Assistente Pessoal do Comandante
// Ativado quando Edson manda mensagem via WhatsApp para James
// !! Lógica de IA centralizada em services/james-engine.ts !!
// ============================================================
import { logger } from './logger'
import { handleJamesRequest } from './services/james-engine'

// tenant_id fixo para o canal pessoal do Comandante
const PERSONAL_TENANT = 'personal'

// ── Handler principal ──────────────────────────────────────────
export async function handlePersonalJames(event: {
  instance: string
  phone:    string
  name:     string
  text:     string
  sendReply: (text: string) => Promise<void>
}): Promise<void> {
  const { phone, name, text, sendReply } = event

  logger.info(`[JAMES PESSOAL] ${name} (${phone}): "${text.substring(0, 80)}"`)

  try {
    // Engine central — mesmo sistema de contexto, memória e IA
    const reply = await handleJamesRequest({
      message:   text,
      tenant_id: PERSONAL_TENANT,
      origin:    'personal',
      clientName: name,
    })

    await sendReply(reply)
    logger.info(`[JAMES PESSOAL] Resposta enviada para ${phone}`)

  } catch (err) {
    logger.error('[JAMES PESSOAL] Erro ao processar mensagem', err)
    try { await sendReply('Tive um problema técnico agora. Pode repetir?') } catch {}
  }
}
