// Source/validation metadata cannot establish permission to contact anyone.
export const LEAD_CONTACT_AVAILABLE = false
export const LEAD_CONTACT_BLOCK_REASON = 'Contato bloqueado: ainda nao existe permissao verificavel nem canal autorizado. Origem e validacao do cadastro nao autorizam contato.'

export type LeadMutationStatus = 'new' | 'contacted' | 'qualified' | 'converted' | 'lost'
export type MutationOutcome = 'rejected' | 'uncertain' | 'stale'
export class MutationFailure extends Error {
  outcome: MutationOutcome
  settled: boolean
  constructor(message: string, outcome: MutationOutcome, settled = false) {
    super(message)
    this.name = 'MutationFailure'
    this.outcome = outcome
    this.settled = settled
  }
}
export type LeadMutationRequest = {
  kind: 'delete' | 'status'; tenantId: string; ids: string[]; status?: LeadMutationStatus;
}
export type LeadMutationOptions = LeadMutationRequest & {
  isCurrent: () => boolean;
  execute: (request: LeadMutationRequest) => PromiseLike<{ data: unknown; error: unknown }>;
}
const statuses: readonly string[] = ['new', 'contacted', 'qualified', 'converted', 'lost']
const identity = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value === value.trim()
function fail(outcome: MutationOutcome, settled = false): never {
  const messages = {
    rejected: 'Operacao recusada. Confira empresa, selecao e permissao antes de continuar.',
    uncertain: 'Resultado nao confirmado. Atualize os cadastros e confira o resultado antes de tentar novamente.',
    stale: 'O contexto mudou. Nenhum resultado sera aplicado nesta tela; confira os cadastros da empresa correta antes de repetir.',
  }
  throw new MutationFailure(messages[outcome], outcome, settled)
}
function current(check: () => boolean): boolean {
  try { return check() === true } catch { return false }
}
function knownRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error) || typeof error.code !== 'string') return false
  return /^(22|23|42)[A-Z0-9]{3}$/.test(error.code) || error.code === 'P0001' || error.code === 'PGRST202'
}
function validRequest(request: LeadMutationRequest): boolean {
  return !!request && identity(request.tenantId) && Array.isArray(request.ids) &&
    request.ids.length >= 1 && request.ids.length <= 1000 && request.ids.every(identity) &&
    new Set(request.ids).size === request.ids.length && ['delete', 'status'].includes(request.kind) &&
    (request.kind === 'status' ? statuses.includes(request.status ?? '') : request.status === undefined)
}

// No retry: a transport failure or deadline cannot prove a write did not happen.
export async function mutateLeadRecords(options: LeadMutationOptions): Promise<{ ids: string[]; status?: LeadMutationStatus }> {
  if (!validRequest(options) || typeof options.execute !== 'function') return fail('rejected', true)
  const { tenantId, kind, status, execute, isCurrent } = options
  const ids = [...options.ids]
  if (!current(isCurrent)) return fail('stale', true)
  let timer: ReturnType<typeof setTimeout> | undefined
  let dispatched = false
  let result: { data: unknown; error: unknown }
  try {
    result = await Promise.race([
      Promise.resolve().then(() => {
        if (!current(isCurrent)) return fail('stale', true)
        dispatched = true
        return execute({ tenantId, kind, ids: [...ids], ...(kind === 'status' ? { status } : {}) })
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('deadline')), 45_000)
      }),
    ])
  } catch {
    if (!dispatched || !current(isCurrent)) return fail('stale', !dispatched)
    return fail('uncertain')
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
  const unconfirmed = (): never => fail(current(isCurrent) ? 'uncertain' : 'stale')
  if (!result || typeof result !== 'object') return unconfirmed()
  if (result.error !== null) {
    if (knownRejection(result.error)) return fail(current(isCurrent) ? 'rejected' : 'stale', true)
    return unconfirmed()
  }
  if (!Array.isArray(result.data) || result.data.length !== ids.length) return unconfirmed()
  const expected = new Set(ids)
  for (const row of result.data) {
    if (!row || typeof row !== 'object' || typeof row.id !== 'string' ||
      !expected.delete(row.id) || row.tenant_id !== tenantId ||
      (kind === 'status' && row.status !== status)) return unconfirmed()
  }
  if (expected.size) return unconfirmed()
  if (!current(isCurrent)) return fail('stale', true)
  return { ids, ...(kind === 'status' ? { status } : {}) }
}

export type LeadMutationStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type PendingLeadMutation = LeadMutationRequest & { requestId: string; userId: string; createdAt: string }
export function pendingLeadMutationKey(tenantId: string): string {
  if (!identity(tenantId)) return fail('rejected', true)
  return 'nucleo.lead-mutation.v1.' + tenantId
}
export function readPendingLeadMutation(storage: LeadMutationStorage, key: string, tenantId: string): PendingLeadMutation | null {
  try {
    if (key !== pendingLeadMutationKey(tenantId)) return fail('rejected', true)
    const raw = storage.getItem(key)
    if (raw === null) return null
    const marker = JSON.parse(raw) as PendingLeadMutation
    if (!validRequest(marker) || marker.tenantId !== tenantId || !identity(marker.requestId) || !identity(marker.userId) ||
      typeof marker.createdAt !== 'string' || !Number.isFinite(Date.parse(marker.createdAt)) ||
      new Date(marker.createdAt).toISOString() !== marker.createdAt ||
      Object.keys(marker).some(field => !['requestId', 'tenantId', 'userId', 'kind', 'ids', 'status', 'createdAt'].includes(field))) return fail('rejected', true)
    return marker
  } catch { return fail('rejected', true) }
}

// The marker has no expiry: uncertainty must survive navigation, reloads and other users.
// All cooperating tabs reserve under the same tenant lock, before any write dispatch.
export async function withLeadMutationReservation<T>(options: LeadMutationRequest & {
  storage: LeadMutationStorage; locks: Pick<LockManager, 'request'> | undefined;
  userId: string; requestId: string; work: () => Promise<T>;
}): Promise<T> {
  if (!validRequest(options) || !identity(options.userId) || !identity(options.requestId) ||
    typeof options.work !== 'function' || !options.locks) return fail('rejected', true)
  const { storage, locks, work, tenantId, userId, requestId, kind, status } = options
  const key = pendingLeadMutationKey(tenantId)
  const marker: PendingLeadMutation = { requestId, tenantId, userId, kind, ids: [...options.ids],
    ...(kind === 'status' ? { status } : {}), createdAt: new Date().toISOString() }
  let entered = false
  try {
    return await locks.request(key, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) return fail('rejected', true)
      entered = true
      if (readPendingLeadMutation(storage, key, tenantId)) return fail('rejected', true)
      try {
        const serialized = JSON.stringify(marker)
        storage.setItem(key, serialized)
        if (storage.getItem(key) !== serialized) return fail('rejected', true)
      } catch { return fail('rejected', true) }
      const clearOwnMarker = () => {
        try {
          const pending = readPendingLeadMutation(storage, key, tenantId)
          if (pending?.requestId === requestId) storage.removeItem(key)
        } catch { /* Preserve the confirmed outcome; a retained marker still blocks further writes. */ }
      }
      let result: T
      try { result = await work() }
      catch (error) {
        if (error instanceof MutationFailure && error.settled) clearOwnMarker()
        throw error
      }
      clearOwnMarker()
      return result
    })
  } catch (error) {
    if (entered || error instanceof MutationFailure) throw error
    return fail('rejected', true)
  }
}
