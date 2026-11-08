import type { PreparedLeadFile as LeadFilePreview } from './lead-source-file.ts'

export type ImportReceipt = {
  ok: true; request_id: string; tenant_id: string;
  imported: number; existing: number; total: number;
  items: { lead_id: string; phone: string; outcome: 'imported' | 'existing' }[];
  state: { whatsapp: 'unknown'; activity: 'unknown'; contact_permission: 'not_established' };
}
export type Rpc = (name: string, parameters: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
export type PendingImport = { requestId: string; tenantId: string; sha256: string; fileName: string }
export type PendingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export class ImportFailure extends Error {
  outcome: 'rejected' | 'uncertain'
  constructor(message: string, outcome: 'rejected' | 'uncertain') { super(message); this.outcome = outcome }
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
function rejected(message: string): never { throw new ImportFailure(message, 'rejected') }
function uncertain(): never { throw new ImportFailure('Resultado ainda nao confirmado. Consulte o recibo antes de repetir.', 'uncertain') }
function receipt(value: unknown, requestId: string, tenantId: string): ImportReceipt {
  if (!value || typeof value !== 'object') return uncertain()
  const r = value as Partial<ImportReceipt>
  if (r.ok !== true || r.request_id !== requestId || r.tenant_id !== tenantId ||
    !Number.isInteger(r.imported) || !Number.isInteger(r.existing) || !Number.isInteger(r.total) ||
    r.imported! < 0 || r.existing! < 0 || r.total! < 1 || r.total! > 5000 || r.imported! + r.existing! !== r.total ||
    !Array.isArray(r.items) || r.items.length !== r.total ||
    r.state?.whatsapp !== 'unknown' || r.state?.activity !== 'unknown' || r.state?.contact_permission !== 'not_established') return uncertain()
  const phones = new Set<string>()
  let imported = 0
  for (const item of r.items) {
    if (!item || !uuid(item.lead_id) || typeof item.phone !== 'string' || !/^\+55[1-9][0-9](?:[2-5][0-9]{7}|9[0-9]{8})$/.test(item.phone) ||
      !['imported', 'existing'].includes(item.outcome) || phones.has(item.phone)) return uncertain()
    phones.add(item.phone); if (item.outcome === 'imported') imported++
  }
  if (imported !== r.imported) return uncertain()
  return r as ImportReceipt
}
// A deadline never proves that a write failed. Keep its durable request ID for lookup.
async function callRpc(rpc: Rpc, name: string, parameters: Record<string, unknown>): Promise<Awaited<ReturnType<Rpc>>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(() => rpc(name, parameters)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ImportFailure('Resposta demorou mais que o esperado. Consulte o recibo antes de repetir.', 'uncertain')), 45_000)
      }),
    ])
  } finally { if (timer !== undefined) clearTimeout(timer) }
}
function rpcFailure(error: { code?: string; message?: string }): never {
  const code = error.code ?? ''
  if (code === '22023' && error.message === 'lead_import_name_conflict') return rejected('Um telefone do arquivo ja pertence a um cadastro com nome diferente. Revise o cadastro existente antes de importar. Este lote nao foi gravado.')
  if (code === '22023' && error.message === 'lead_import_ambiguous_legacy') return rejected('Um telefone do arquivo corresponde a mais de um cadastro existente. Resolva a duplicidade antes de importar. Este lote nao foi gravado.')
  if (code === '22023') throw new ImportFailure('A referencia ja foi usada com outro conteudo. Consulte o recibo original; nao crie outra tentativa automaticamente.', 'uncertain')
  if (code === 'PGRST202' || code === '42883') return rejected('Importacao atomica ainda nao instalada neste banco. Nenhum cadastro foi confirmado.')
  if (/^(22|23|42)/.test(code) || code === 'P0001') return rejected('Importacao recusada pelo banco. Confira empresa, arquivo e permissao. Nao houve confirmacao de cadastro.')
  return uncertain()
}
export async function submitLeadImport(options: {
  preview: LeadFilePreview; confirmed: boolean; tenantId: string; isCurrent: () => boolean; rpc: Rpc;
}): Promise<ImportReceipt> {
  const { preview, tenantId } = options
  if (!options.confirmed || !options.isCurrent() || tenantId !== preview.tenantId || !uuid(tenantId) || !uuid(preview.requestId) || !preview.canImport || !preview.contacts.length) return rejected('Revise e autorize o lote para a empresa atual antes de importar.')
  let result: Awaited<ReturnType<Rpc>>
  try {
    result = await callRpc(options.rpc, 'nucleo_import_leads_v1', {
      p_request_id: preview.requestId, p_expected_tenant: tenantId,
      p_source: preview.source, p_contacts: preview.contacts,
    })
  } catch { return uncertain() }
  if (result.error) return rpcFailure(result.error)
  const confirmed = receipt(result.data, preview.requestId, tenantId)
  if (confirmed.total !== preview.contacts.length || confirmed.items.some(item => !preview.contacts.some(contact => contact.phone === item.phone))) return uncertain()
  return confirmed
}
export async function getLeadImportReceipt(options: { requestId: string; tenantId: string; rpc: Rpc }): Promise<ImportReceipt | null> {
  if (!uuid(options.requestId) || !uuid(options.tenantId)) return rejected('Referencia de importacao invalida.')
  let result: Awaited<ReturnType<Rpc>>
  try { result = await callRpc(options.rpc, 'nucleo_get_lead_import_v1', { p_request_id: options.requestId, p_expected_tenant: options.tenantId }) }
  catch { return uncertain() }
  if (result.error) return rpcFailure(result.error)
  return result.data === null ? null : receipt(result.data, options.requestId, options.tenantId)
}
export function pendingImportKey(tenantId: string, userId: string): string {
  if (!uuid(tenantId) || !uuid(userId)) return rejected('Identidade indisponivel para a importacao.')
  return 'nucleo.lead-import.v1.' + tenantId + '.' + userId
}
export function readPendingImport(storage: PendingStorage, key: string, tenantId: string): PendingImport | null {
  try {
    const raw = storage.getItem(key); if (raw === null) return null
    const p = JSON.parse(raw) as PendingImport
    if (!uuid(p.requestId) || p.tenantId !== tenantId || !/^[a-f0-9]{64}$/.test(p.sha256) || typeof p.fileName !== 'string' || p.fileName.length < 1 || p.fileName.length > 255) throw new Error('invalid')
    return p
  } catch { return rejected('Nao foi possivel recuperar a importacao pendente deste navegador. Nenhum novo lote sera enviado.') }
}
export function savePendingImport(storage: PendingStorage, key: string, pending: PendingImport) {
  try {
    const existing = readPendingImport(storage, key, pending.tenantId)
    if (existing && (existing.requestId !== pending.requestId || existing.sha256 !== pending.sha256)) throw new Error('another pending request')
    storage.setItem(key, JSON.stringify(pending))
    if (storage.getItem(key) !== JSON.stringify(pending)) throw new Error('not saved')
  } catch { return rejected('Nao foi possivel preservar a referencia do lote. Nada foi enviado ao banco.') }
}
export function clearPendingImport(storage: PendingStorage, key: string, requestId: string, tenantId: string) {
  const current = readPendingImport(storage, key, tenantId)
  if (current?.requestId === requestId) storage.removeItem(key)
}

// All tabs reserve/send under the same browser lock; the durable pointer outlives this lock.
export async function withPendingImportLock<T>(locks: Pick<LockManager, 'request'> | undefined, key: string, work: () => Promise<T>): Promise<T> {
  if (!locks) return rejected('Este navegador nao oferece reserva segura entre abas. Use um navegador atualizado para importar.')
  let entered = false
  try {
    return await locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) return rejected('Outra aba esta confirmando uma importacao desta empresa. Aguarde e consulte o resultado, sem repetir.')
      entered = true
      return work()
    })
  } catch (error) {
    if (entered || error instanceof ImportFailure) throw error
    return rejected('Nao foi possivel reservar esta importacao entre abas. Nenhum novo lote foi confirmado.')
  }
}
