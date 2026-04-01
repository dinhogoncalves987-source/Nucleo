// ============================================================
// james-engine.ts — Cérebro Central do James / O Núcleo
// MELHORIAS v2:
//   1. SESSION HISTORY: mantém últimas N trocas por sessão em RAM
//      → James lembra o que foi dito há 30 segundos
//   2. PROMPT EXECUTIVO: natural, sem repetição, fluxo de conversa real
//   3. MODELO: gpt-4o-mini com temperatura baixa → respostas rápidas e diretas
// ============================================================
import OpenAI from 'openai'
import { supabase } from '../server'
import { logger } from '../logger'
import axios from 'axios'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! })

// ─── Session History (in-memory, por sessionId) ──────────────────────────────
// Cada sessão frontend tem seu próprio histórico de conversa.
// TTL: limpa sessões inativas há mais de 30 minutos.

interface Turn { role: 'user' | 'assistant'; content: string }
interface Session { turns: Turn[]; lastActivity: number }

const SESSIONS = new Map<string, Session>()
const SESSION_MAX_TURNS = 12      // últimas 12 trocas (~6 interações completas)
const SESSION_TTL_MS    = 30 * 60 * 1000  // 30 minutos sem atividade

function getSession(sessionId: string): Session {
  let s = SESSIONS.get(sessionId)
  if (!s) {
    s = { turns: [], lastActivity: Date.now() }
    SESSIONS.set(sessionId, s)
  }
  s.lastActivity = Date.now()
  return s
}

function addTurn(sessionId: string, role: 'user' | 'assistant', content: string) {
  const s = getSession(sessionId)
  s.turns.push({ role, content })
  // Mantém só os últimos N turns (remove pares mais antigos)
  if (s.turns.length > SESSION_MAX_TURNS * 2) {
    s.turns.splice(0, 2)
  }
}

// Limpa sessões expiradas a cada 10min
setInterval(() => {
  const now = Date.now()
  for (const [id, s] of SESSIONS.entries()) {
    if (now - s.lastActivity > SESSION_TTL_MS) SESSIONS.delete(id)
  }
}, 10 * 60 * 1000)

// ─── System Prompt Executivo ──────────────────────────────────────────────────
// Pessoa real, fluida, inteligente. Sem formatos rígidos. Sem repetições.
const JAMES_SYSTEM = `Você é James, inteligência central de O Núcleo — sistema operacional da holding XGlobal Partners, fundada por Edson Sena.

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
Cálculos, análise financeira, ROI, projeções, tradução, informação de mercado, dados do banco, busca web quando necessário.

CONTEXTO:`

// ─── Tipos ───────────────────────────────────────────────────────────────────
export interface JamesRequest {
  message:    string
  tenant_id:  string
  origin:     'frontend' | 'whatsapp' | 'personal'
  sessionId?: string     // identifica a sessão de voz atual
  clientName?:   string
  clientPhone?:  string
  affiliateLink?: string
  isKnownLead?:  boolean
  leadStatus?:   string
}

interface Memory { input: string; response: string; category: string }

// ─── Detecção de categoria ────────────────────────────────────────────────────
export function detectCategory(text: string): string {
  const t = text.toLowerCase()
  if (t.includes('cliente') || t.includes('contato'))                           return 'cliente'
  if (t.includes('contrato') || t.includes('negoci') || t.includes('fechar'))  return 'negociacao'
  if (t.includes('estabelecimento') || t.includes('salao') || t.includes('clínica')) return 'estabelecimento'
  if (t.includes('calcula') || t.includes('quanto') || t.includes('%'))         return 'calculo'
  if (t.includes('traduz') || t.includes('inglês') || t.includes('interprete')) return 'traducao'
  return 'geral'
}

// ─── Memória persistente (Supabase) ──────────────────────────────────────────
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
  input:    string,
  response: string,
  tenantId: string,
  important = false,
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

// ─── Contexto ao vivo ─────────────────────────────────────────────────────────
export function getLiveContext(): string {
  const now     = new Date()
  const dateStr = now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const timeStr = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return `Data: ${dateStr}, ${timeStr} (Brasília)`
}

// ─── Dados do tenant ──────────────────────────────────────────────────────────
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
    const newL      = leads.filter((l: {status:string}) => l.status === 'new').length
    const converted = leads.filter((l: {status:string}) => l.status === 'converted').length
    const totalRev  = finances.reduce((s: number, f: {amount:number}) => s + Number(f.amount), 0)

    return `Leads: ${total} total | ${newL} novos | ${converted} convertidos | Faturamento: R$${totalRev.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
  } catch { return '' }
}

// ─── Busca web ────────────────────────────────────────────────────────────────
const SEARCH_KEYWORDS = [
  'pesquise','busque','procure','o que é','o que foi','notícia','noticias',
  'como está','quem é','quando foi','o que aconteceu','previsão',
]

export function needsSearch(text: string): boolean {
  return SEARCH_KEYWORDS.some(k => text.toLowerCase().includes(k))
}

export async function searchWeb(query: string): Promise<string> {
  try {
    const googleKey = process.env.GOOGLE_API_KEY
    const googleCx  = process.env.GOOGLE_SEARCH_ENGINE_ID

    let items: { title: string; snippet: string }[] = []

    if (googleKey && googleCx) {
      const { data } = await axios.get(
        `https://www.googleapis.com/customsearch/v1?key=${googleKey}&cx=${googleCx}&q=${encodeURIComponent(query)}&num=4&hl=pt-BR`,
        { timeout: 6000 },
      )
      items = (data.items ?? []).map((i: {title:string; snippet:string}) => ({ title: i.title, snippet: i.snippet }))
    } else {
      const { data } = await axios.get(
        `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1&no_html=1`,
        { timeout: 5000 },
      )
      if (data.AbstractText) items.push({ title: data.Heading || query, snippet: data.AbstractText })
      if (data.Answer)       items.push({ title: 'Resposta direta', snippet: data.Answer })
    }

    if (!items.length) return ''
    const summary = items.slice(0, 3).map(r => `• ${r.title}: ${r.snippet}`).join('\n')
    return `\nBUSCA WEB para "${query}":\n${summary}`
  } catch { return '' }
}

// ─── buildMessages — monta o array de messages para o GPT ────────────────────
// Exportado para ser reutilizado pelo endpoint de streaming
export async function buildMessages(req: JamesRequest): Promise<{ role: 'system' | 'user' | 'assistant'; content: string }[]> {
  const { message, tenant_id, origin } = req
  const sessionId = req.sessionId ?? tenant_id

  const [memoryCtx, searchCtx, tenantCtx] = await Promise.all([
    getSession(sessionId).turns.length < 4
      ? searchMemory(message, tenant_id)
      : Promise.resolve(''),
    needsSearch(message) ? searchWeb(message) : Promise.resolve(''),
    origin === 'frontend' || origin === 'personal'
      ? fetchTenantData(tenant_id)
      : Promise.resolve(''),
  ])

  let systemContent = JAMES_SYSTEM
  systemContent += '\n' + getLiveContext()
  if (tenantCtx)  systemContent += '\n' + tenantCtx
  if (searchCtx)  systemContent += searchCtx
  if (memoryCtx)  systemContent += memoryCtx

  if (origin === 'whatsapp' && req.clientName) {
    systemContent += `\nCANAL WhatsApp: atendendo ${req.clientName}.`
    if (req.affiliateLink) systemContent += ` Link: ${req.affiliateLink}`
    if (req.isKnownLead)   systemContent += ` Lead conhecido (${req.leadStatus ?? 'n/a'}).`
    else                   systemContent += ' Novo contato.'
  }

  const session = getSession(sessionId)
  return [
    { role: 'system', content: systemContent },
    ...session.turns.map(t => ({ role: t.role, content: t.content })),
    { role: 'user', content: message },
  ]
}

// Versão pública de addTurn (para uso pelo streaming route)
export function addTurnPublic(sessionId: string, role: 'user' | 'assistant', content: string) {
  addTurn(sessionId, role, content)
}

// ─── Engine Principal ─────────────────────────────────────────────────────────
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

    addTurn(sessionId, 'user',      message)
    addTurn(sessionId, 'assistant', reply)

    saveMemory(message, reply, tenant_id, important).catch(() => {})

    const session = getSession(sessionId)
    logger.info(`[JAMES] session:${sessionId} | turns:${session.turns.length / 2} | "${message.slice(0, 50)}"`)
    return reply

  } catch (err) {
    logger.error('[JAMES ENGINE] Erro ao processar', err)
    return 'Tive um problema técnico. Pode repetir?'
  }
}

// ─── Gestão de sessões ────────────────────────────────────────────────────────
export function clearSession(sessionId: string) {
  SESSIONS.delete(sessionId)
}

export function getSessionInfo(sessionId: string) {
  const s = SESSIONS.get(sessionId)
  return s ? { turns: s.turns.length, lastActivity: new Date(s.lastActivity).toISOString() } : null
}

