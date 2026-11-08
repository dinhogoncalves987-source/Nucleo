/** Pure client: authenticated transport is supplied by the UI, never by unit tests. */
export type Provider = 'duckduckgo_instant_answer' | 'google_cse'
export type Identity = { tenantId: string; userId: string }
export type Transport = (path: string, init?: RequestInit) => Promise<Response>
export type UnavailableReason = 'search_disabled' | 'provider_not_supported' | 'provider_not_configured' | 'google_budget_not_approved' | 'google_eligibility_unconfirmed' | 'google_provider_retired' | 'duckduckgo_commercial_approval_required'
export type Capabilities = { tenant_id: string; enabled: boolean; provider: Provider; configured: boolean; reason: UnavailableReason | null; requires_query_authorization: true; limitations: string[] }
export const unavailableMessages: Record<UnavailableReason, string> = {
  search_disabled: 'Busca pública desabilitada pelo servidor.',
  provider_not_supported: 'Fonte configurada no servidor não é suportada.',
  provider_not_configured: 'Fonte indisponível: falta configuração no servidor.',
  google_budget_not_approved: 'Google indisponível: custo não autorizado no servidor.',
  google_eligibility_unconfirmed: 'Google indisponível: elegibilidade de cliente existente não confirmada. O serviço está fechado a novos clientes e encerra em 01/01/2027.',
  google_provider_retired: 'Google indisponível: serviço encerrado em 01/01/2027.',
  duckduckgo_commercial_approval_required: 'DuckDuckGo indisponível: autorização comercial precisa ser confirmada, incluindo as condições atuais de uso.',
}
export type SearchResult = { title: string; snippet: string; url: string; phone_evidence: { raw: string; normalized: string; excerpt: string }[] }
export type SearchResponse = { request_id: string; tenant_id: string; query: string; provider: Provider; searched_at: string; results: SearchResult[]; limitations: string[]; state: { whatsapp: 'unknown'; activity: 'unknown'; contact_permission: 'not_established' } }
export class PublicSearchFailure extends Error {}
const fail = (message = 'Resposta da busca inválida. Atualize a disponibilidade antes de tentar novamente.'): never => { throw new PublicSearchFailure(message) }
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
const hasControls = (x: string) => Array.from(x).some(c => c.charCodeAt(0) < 32 || (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159))
const string = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max && !hasControls(x)
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.length <= 30 && x.every(v => string(v, 2000))
const provider = (x: unknown): x is Provider => x === 'duckduckgo_instant_answer' || x === 'google_cse'
const uuid = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x)
export function isPublicSourceUrl(value: unknown): value is string {
  if (!string(value, 4096) || /[\s\\]/.test(value)) return false
  try {
    const u = new URL(value), h = u.hostname.toLowerCase().replace(/\.$/, '')
    // IP literals (including normalized decimal/hex/IPv6), local names and credentials are never source links.
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password && !u.port &&
      !h.includes(':') && !/^\d+(\.\d+){3}$/.test(h) && h.includes('.') &&
      !/(^|\.)(localhost|local|internal|lan|home|test|invalid|example|onion)$/.test(h) &&
      /^[a-z0-9.-]+$/.test(h) && h.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
  } catch { return false }
}
function assertIdentity(identity: Identity, isCurrent: () => boolean) {
  if (!identity.tenantId || !identity.userId || !isCurrent()) fail('Identidade alterada ou indisponível. Abra a busca novamente.')
}
const serverErrorMessages: Record<string, string> = {
  '503:request_ledger_full': 'Capacidade de controle de consultas esgotada no servidor. A solicitação foi recusada; nenhuma nova tentativa foi enviada.',
  '409:request_id_conflict': 'Identificador da consulta já usado com dados diferentes. A solicitação foi recusada; nenhuma nova tentativa foi enviada.',
  '409:request_in_progress': 'Esta consulta já está em andamento. Não envie outra consulta para repeti-la. Nenhuma nova tentativa foi enviada.',
  '409:request_outcome_uncertain': 'O resultado desta consulta é incerto. Confira a situação antes de repetir a busca. Nenhuma nova tentativa foi enviada.',
  '409:provider_changed': 'A fonte mudou. Atualize a disponibilidade e revise a autorização antes de buscar.',
  '409:tenant_changed': 'A empresa mudou. Abra a busca novamente no contexto correto.',
  '502:provider_response_invalid': 'A fonte retornou uma resposta inválida. Nenhum resultado foi aceito e nenhuma nova tentativa foi enviada.',
}
async function serverFailure(response: Response): Promise<never> {
  // Accept only a known status/code pair, never server prose, nested values or provider errors.
  let body: unknown
  try { body = await response.json() } catch { /* Malformed error bodies use the same safe fallback. */ }
  if (record(body) && typeof body.error === 'string') {
    const key = `${response.status}:${body.error}`
    if (Object.prototype.hasOwnProperty.call(serverErrorMessages, key)) return fail(serverErrorMessages[key])
  }
  return fail('Busca indisponível no servidor. Nenhum resultado foi aceito e nenhuma nova tentativa foi enviada.')
}
async function request(transport: Transport, path: string, init: RequestInit, signal?: AbortSignal, timeoutMs = 10000): Promise<unknown> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort = () => {}
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => { controller.abort(); reject(new PublicSearchFailure('Busca cancelada.')) }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    timer = setTimeout(() => { controller.abort(); reject(new PublicSearchFailure('A busca excedeu o prazo. Nenhuma nova tentativa foi enviada.')) }, Math.min(10000, Math.max(1, timeoutMs)))
  })
  try {
    if (signal?.aborted) return await stopped
    return await Promise.race([stopped, (async () => {
      const response = await transport(path, { ...init, signal: controller.signal, cache: 'no-store', redirect: 'error' })
      if (!response.ok) return await serverFailure(response)
      return await response.json()
    })()])
  } catch (error) {
    if (error instanceof PublicSearchFailure) throw error
    return fail('Não foi possível consultar o servidor. Nenhuma nova tentativa foi enviada.')
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort) }
}
type Context = { transport: Transport; identity: Identity; isCurrent: () => boolean; signal?: AbortSignal; timeoutMs?: number }
export async function getPublicSearchCapabilities(ctx: Context): Promise<Capabilities> {
  assertIdentity(ctx.identity, ctx.isCurrent)
  const x = await request(ctx.transport, '/api/search/capabilities', { method: 'GET' }, ctx.signal, ctx.timeoutMs)
  assertIdentity(ctx.identity, ctx.isCurrent)
  if (!record(x) || x.tenant_id !== ctx.identity.tenantId || typeof x.enabled !== 'boolean' || typeof x.configured !== 'boolean' || !provider(x.provider) || x.requires_query_authorization !== true || !(x.reason === null || (typeof x.reason === 'string' && Object.prototype.hasOwnProperty.call(unavailableMessages, x.reason))) || !strings(x.limitations)) return fail()
  if (x.enabled !== (x.reason === null) || (x.enabled && !x.configured) ||
      (x.reason === 'provider_not_configured' && (x.configured || x.provider !== 'google_cse')) ||
      (x.reason === 'google_budget_not_approved' && (!x.configured || x.provider !== 'google_cse')) ||
      ((x.reason === 'google_eligibility_unconfirmed' || x.reason === 'google_provider_retired') && x.provider !== 'google_cse') ||
      (x.reason === 'duckduckgo_commercial_approval_required' && (!x.configured || x.provider !== 'duckduckgo_instant_answer')) ||
      (x.reason === 'provider_not_supported' && x.configured)) return fail()
  return x as Capabilities
}
export async function submitPublicSearch(ctx: Context & { capabilities: Capabilities; query: string; authorized: boolean; requestId: string }): Promise<SearchResponse> {
  assertIdentity(ctx.identity, ctx.isCurrent)
  const { capabilities: caps } = ctx
  if (ctx.authorized !== true || !caps.enabled || !caps.configured || caps.reason !== null || caps.requires_query_authorization !== true || caps.tenant_id !== ctx.identity.tenantId || !provider(caps.provider)) return fail('Autorize explicitamente a consulta e confirme a disponibilidade da fonte.')
  if (!string(ctx.query, 200)) return fail('Digite uma consulta pública de até 200 caracteres.')
  const query = ctx.query.trim().replace(/\s+/g, ' ')
  if (!query || !uuid(ctx.requestId)) return fail('Digite uma consulta pública de até 200 caracteres.')
  const x = await request(ctx.transport, '/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, expected_tenant_id: ctx.identity.tenantId, expected_provider: caps.provider, authorize_public_query: true, request_id: ctx.requestId }) }, ctx.signal, ctx.timeoutMs)
  assertIdentity(ctx.identity, ctx.isCurrent)
  if (!record(x) || x.request_id !== ctx.requestId || x.tenant_id !== ctx.identity.tenantId || x.query !== query || x.provider !== caps.provider || !string(x.searched_at, 40) || !/^\d{4}-\d{2}-\d{2}T/.test(x.searched_at) || !Number.isFinite(Date.parse(x.searched_at)) || !strings(x.limitations) || !Array.isArray(x.results) || x.results.length > 10 || !record(x.state) || x.state.whatsapp !== 'unknown' || x.state.activity !== 'unknown' || x.state.contact_permission !== 'not_established') return fail()
  for (const r of x.results) {
    if (!record(r) || !string(r.title, 1000) || !r.title.trim() || !string(r.snippet, 10000) || !isPublicSourceUrl(r.url) || !Array.isArray(r.phone_evidence) || r.phone_evidence.length > 5) return fail()
    for (const p of r.phone_evidence) {
      if (!record(p) || !string(p.raw, 100) || !string(p.normalized, 32) || !string(p.excerpt, 2000) || !p.raw || !p.excerpt.includes(p.raw) || !r.snippet.includes(p.excerpt)) return fail()
      if (!/^(?:\+55[ .-]?)?(?:\([1-9]\d\)|[1-9]\d)[ .-]?(?:9\d{4}|[2-5]\d{3})[- .]?\d{4}$/.test(p.raw) || !/[(). -]/.test(p.raw)) return fail()
      const digits = p.raw.replace(/\D/g, ''), national = p.raw.startsWith('+55') ? digits.slice(2) : digits
      const ddds = '11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99'.split(' ')
      if (!ddds.includes(national.slice(0, 2)) || p.normalized !== '+55' + national) return fail()
    }
  }
  return x as SearchResponse
}
