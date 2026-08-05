// ============================================================
// james-engine-serverless.ts — Cérebro do James para Vercel Serverless
// Versão sem dependências de server.ts (sem import circular)
// Sessão via Supabase em vez de RAM (serverless é stateless)
// ============================================================
import OpenAI from 'openai'
import { createClient } from '@supabase/supabase-js'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

// ─── Types ────────────────────────────────────────────────────────────────────
interface Turn { role: 'user' | 'assistant'; content: string }

export interface JamesRequest {
  message:    string
  tenant_id:  string
  origin:     'frontend' | 'whatsapp' | 'personal'
  sessionId?: string
  clientName?:   string
  clientPhone?:  string
  affiliateLink?: string
  isKnownLead?:  boolean
  leadStatus?:   string
}

interface Memory { input: string; response: string; category: string }
interface LeadSummary { status: string | null }
interface FinanceSummary { amount: number | string | null }

// ─── In-memory session cache (lasts per invocation, OK for streaming) ──────
// In serverless, each invocation is short-lived. We load session from Supabase
// at the start and save at the end. This gives us conversation continuity.
const sessionCache = new Map<string, Turn[]>()

async function loadSession(sessionId: string): Promise<Turn[]> {
  if (sessionCache.has(sessionId)) return sessionCache.get(sessionId)!

  try {
    const { data } = await supabase
      .from('james_sessions')
      .select('turns')
      .eq('session_id', sessionId)
      .maybeSingle()

    const turns: Turn[] = data?.turns ?? []
    sessionCache.set(sessionId, turns)
    return turns
  } catch {
    // Table might not exist yet — that's fine, start with empty
    return []
  }
}

async function saveTurns(sessionId: string, turns: Turn[]): Promise<void> {
  try {
    const trimmed = turns.slice(-24) // keep last 24 turns
    await supabase
      .from('james_sessions')
      .upsert({
        session_id: sessionId,
        turns: trimmed,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'session_id' })
  } catch {
    // Non-blocking — if table doesn't exist, sessions just won't persist
  }
}

export async function addTurnAndSave(sessionId: string, role: 'user' | 'assistant', content: string) {
  const turns = await loadSession(sessionId)
  turns.push({ role, content })
  sessionCache.set(sessionId, turns)
  await saveTurns(sessionId, turns)
}

export async function clearSession(sessionId: string) {
  sessionCache.delete(sessionId)
  try {
    await supabase.from('james_sessions').delete().eq('session_id', sessionId)
  } catch { /* ok */ }
}

// ─── System Prompts Dinâmicos (por origin) ────────────────────────────────────
// Cada canal recebe um James diferente:
//   personal  → General de operações para Edson (Comandante)
//   frontend  → Executivo híbrido para dashboard
//   whatsapp  → Conversacional comercial para clientes/estabelecimentos

type JamesOrigin = 'frontend' | 'whatsapp' | 'personal'

const JAMES_PERSONAL = `Você é James, inteligência central de O Núcleo — sistema operacional da holding XGlobal Partners, fundada por Edson Sena.

QUEM VOCÊ É:
Você não é um chatbot. Você é um general de operações — analítico, objetivo, presente.
Responde como um ser humano de alta performance responderia em reunião executiva:
direto, sem rodeios, sem repetir o que o Comandante acabou de dizer.

REGRAS DE CONVERSA:
- Nunca repita a pergunta feita
- Nunca comece com "Claro!", "Entendido!", "Com certeza!" — vá direto ao ponto
- Se a pergunta tiver continuidade óbvia da conversa anterior, trate como tal
- Fale no máximo 2-3 frases curtas — você é ouvido, não lido
- Use dados quando tiver. Se não tiver, diga com precisão o que falta
- Varie o início das respostas — não seja mecânico

ESTRUTURA DA HOLDING:
- Edson Sena = Comandante Supremo (trate com respeito, sem bajulação)
- The Beauty Hub OS = SaaS marketplace para salões/clínicas
- Recibo Certo = gestão fiscal para MEIs/autônomos
- Operações WhatsApp = 100+ chips Evolution API (força de campo)

CAPACIDADES:
Cálculos, análise financeira, ROI, projeções, tradução, informação de mercado, dados do banco.

CONTEXTO:`

const JAMES_FRONTEND = `Você é James, assistente executivo digital de O Núcleo — plataforma operacional do ecossistema The Beauty Hub.

QUEM VOCÊ É:
Inteligência de apoio para operadores e gestores do sistema.
Você é direto, estratégico e orientado a resultado.
Responde com clareza e foco em ação.

REGRAS:
- Respostas curtas e objetivas (2-4 frases)
- Nunca comece com "Claro!", "Entendido!", "Com certeza!"
- Foque em dados quando disponíveis
- Sugira próximos passos quando fizer sentido
- Tom profissional mas acessível

CAPACIDADES:
Análise de leads, métricas do negócio, sugestões de campanha, suporte operacional, dados em tempo real.

CONTEXTO:`

const JAMES_WHATSAPP = `Você é James, assistente inteligente do estabelecimento. Sua função é conduzir conversas com clientes e potenciais parceiros de forma natural e eficaz.

REGRA ABSOLUTA (seguir SEMPRE):
- JAMAIS inicie uma mensagem com: "Claro", "Com certeza", "Entendido", "Perfeito", "Sem dúvida"
- Use variações naturais como: "Oi!", "Opa!", "Fala!", "Tá bom!", "Sem pressa!", "Pode deixar!"

PRINCÍPIO FUNDAMENTAL:
James NÃO usa script fixo. James se adapta à conversa.
James não empurra. James conduz. E quem conduz bem, converte.

INÍCIO DA CONVERSA:
- Ser direto e leve
- Não parecer venda agressiva
- Cumprimentar → contextualizar rapidamente → abrir espaço para resposta

CONDUÇÃO:
- Ouvir o cliente (ler o contexto do que foi dito)
- Responder exatamente o que foi perguntado
- Não ignorar perguntas ou dúvidas
- Manter o fluxo da conversa avançando

FLUXO ADAPTATIVO:
- Se o cliente responde → continuar normalmente
- Se o cliente trava → simplificar a mensagem
- Se o cliente ignora → não insistir agora (será retomado depois)

PERGUNTAS:
- Simples, objetivas, fáceis de responder
- Nunca confrontar ou pressionar
- Sempre mostrar facilidade

PROIBIDO:
- Texto longo demais (máximo 2-3 frases por mensagem)
- Linguagem formal excessiva
- Ignorar o contexto da conversa
- Forçar venda ou agendamento
- Travar o fluxo
- Nunca comece com "Claro!", "Com certeza!", "Entendido!", "Perfeito!" — vá direto ao ponto
- Não sugerir agendamento quando o cliente só perguntou preço ou informação — espere interesse real

FOCO:
- Simplicidade e clareza
- Avanço natural da conversa
- Geração de ação (agendamento, cadastro, resposta)

RESULTADO ESPERADO:
A conversa deve fluir naturalmente, ser fácil de entender, levar o cliente a avançar e gerar cadastro ou uso da plataforma.

CONTEXTO:`

function getSystemPrompt(origin: JamesOrigin): string {
  switch (origin) {
    case 'personal': return JAMES_PERSONAL
    case 'whatsapp': return JAMES_WHATSAPP
    default:         return JAMES_FRONTEND
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function detectCategory(text: string): string {
  const t = text.toLowerCase()
  if (t.includes('cliente') || t.includes('contato'))                           return 'cliente'
  if (t.includes('contrato') || t.includes('negoci') || t.includes('fechar'))  return 'negociacao'
  if (t.includes('estabelecimento') || t.includes('salao') || t.includes('clínica')) return 'estabelecimento'
  if (t.includes('calcula') || t.includes('quanto') || t.includes('%'))         return 'calculo'
  if (t.includes('traduz') || t.includes('inglês') || t.includes('interprete')) return 'traducao'
  return 'geral'
}

export async function searchMemory(query: string, tenantId: string): Promise<string> {
  try {
    let data: Memory[] | null = null

    const tsResult = await supabase
      .from('james_memories')
      .select('input, response, category')
      .eq('tenant_id', tenantId)
      .textSearch('input', query, { type: 'plain', config: 'portuguese' })
      .order('important', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(3)

    data = tsResult.data

    if (!data?.length) {
      const recentResult = await supabase
        .from('james_memories')
        .select('input, response, category')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(2)
      data = recentResult.data
    }

    if (!data?.length) return ''
    const lines = data.map(m => `[${m.category}] "${m.input}" → "${m.response}"`)
    return `\nMEMÓRIAS RELEVANTES:\n${lines.join('\n')}`
  } catch { return '' }
}

export async function saveMemory(
  input: string, response: string, tenantId: string, important = false
): Promise<void> {
  try {
    await supabase.from('james_memories').insert({
      tenant_id: tenantId,
      speaker:   tenantId === 'personal' ? 'edson' : 'cliente',
      input:     input.slice(0, 1000),
      response:  response.slice(0, 2000),
      important,
      category:  detectCategory(input),
    })
  } catch { /* non-blocking */ }
}

export async function fetchTrainingContext(tenantId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from('james_memories')
      .select('input, response, category')
      .eq('tenant_id', tenantId)
      .like('category', 'training:%')
      .neq('category', 'training:wizard-state')
      .order('category', { ascending: true })
      .limit(20)

    if (!data?.length) return ''
    const lines = data.map(m => `• ${m.response}`)
    return `\nCONHECIMENTO DO NEGÓCIO (treinamento):\n${lines.join('\n')}`
  } catch { return '' }
}

export function getLiveContext(): string {
  const now = new Date()
  const dateStr = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo' })
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
  return `Data: ${dateStr}, ${timeStr} (Brasília)`
}

export async function fetchTenantData(tenantId: string): Promise<string> {
  try {
    const [leadsRes, financesRes] = await Promise.all([
      supabase.from('leads')
        .select('status, validation_status, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase.from('finances')
        .select('amount, transaction_date')
        .eq('tenant_id', tenantId)
        .order('transaction_date', { ascending: false })
        .limit(50),
    ])

    const leads    = leadsRes.data ?? []
    const finances = financesRes.data ?? []

    const total     = leads.length
    const newL      = leads.filter((lead: LeadSummary) => lead.status === 'new').length
    const converted = leads.filter((lead: LeadSummary) => lead.status === 'converted').length
    const totalRev  = finances.reduce((sum: number, finance: FinanceSummary) => sum + Number(finance.amount), 0)

    return `Leads: ${total} total | ${newL} novos | ${converted} convertidos | Faturamento: R$${totalRev.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
  } catch { return '' }
}

// ─── Build Messages ───────────────────────────────────────────────────────────
export async function buildMessages(req: JamesRequest): Promise<{ role: 'system' | 'user' | 'assistant'; content: string }[]> {
  const { message, tenant_id, origin } = req
  const sessionId = req.sessionId ?? tenant_id

  const turns = await loadSession(sessionId)

  const [memoryCtx, tenantCtx, trainingCtx] = await Promise.all([
    turns.length < 4 ? searchMemory(message, tenant_id) : Promise.resolve(''),
    origin === 'frontend' || origin === 'personal'
      ? fetchTenantData(tenant_id) : Promise.resolve(''),
    fetchTrainingContext(tenant_id),
  ])

  let systemContent = getSystemPrompt(origin as JamesOrigin)
  systemContent += '\n' + getLiveContext()
  if (tenantCtx)   systemContent += '\n' + tenantCtx
  if (trainingCtx) systemContent += trainingCtx
  if (memoryCtx)   systemContent += memoryCtx

  if (origin === 'whatsapp') {
    systemContent += '\nCANAL: WhatsApp (mensagens curtas, tom de conversa humana)'
    if (req.clientName) {
      systemContent += `\nCLIENTE: ${req.clientName}`
      if (req.isKnownLead) {
        systemContent += ` — Lead conhecido (status: ${req.leadStatus ?? 'n/a'}). Já teve contato anterior.`
      } else {
        systemContent += ' — Primeiro contato. Seja acolhedor e desperte interesse.'
      }
    }
    if (req.affiliateLink) systemContent += `\nLINK DE AGENDAMENTO: ${req.affiliateLink}`
  }

  return [
    { role: 'system', content: systemContent },
    ...turns.map(t => ({ role: t.role as 'user' | 'assistant', content: t.content })),
    { role: 'user', content: message },
  ]
}

// ─── Handle Request (non-streaming) ───────────────────────────────────────────
export async function handleJamesRequest(req: JamesRequest): Promise<string> {
  const { message, tenant_id } = req
  const sessionId = req.sessionId ?? tenant_id
  const important = /lembra disso|anota|registra/i.test(message)

  try {
    const messages = await buildMessages(req)

    const completion = await openai.chat.completions.create({
      model:       'gpt-4o-mini',
      temperature: 0.6,
      max_tokens:  180,
      messages,
    })

    const reply = completion.choices[0]?.message?.content?.trim()
      ?? 'Não consegui processar. Pode repetir?'

    await addTurnAndSave(sessionId, 'user', message)
    await addTurnAndSave(sessionId, 'assistant', reply)

    saveMemory(message, reply, tenant_id, important).catch(() => {})

    return reply
  } catch (err) {
    console.error('[JAMES ENGINE] Error:', err)
    return 'Tive um problema técnico. Pode repetir?'
  }
}

// ─── OpenAI instance export ───────────────────────────────────────────────────
export { openai, supabase }
