import { validateTenantRow } from './tenant-directory.ts'
import type { TenantDirectoryRow, TenantScope } from './tenant-directory.ts'

export type TenantValues = { name?: string; phone?: string | null; address?: string | null; segment?: string; status?: string }
export type TenantMutationRequest = TenantScope & {
  kind: 'create' | 'update' | 'delete'; targetId: string; details: boolean;
  values?: TenantValues; before?: TenantDirectoryRow;
}
export class TenantMutationFailure extends Error {
  outcome: 'rejected' | 'uncertain' | 'stale' | 'busy'
  settled: boolean
  constructor(outcome: TenantMutationFailure['outcome'], settled = false) {
    super({
      rejected: 'Operação recusada. Confira os dados e peça ao administrador para verificar as permissões e dependências da empresa.',
      uncertain: 'Não foi possível confirmar a alteração. O formulário e a última leitura foram preservados. Não repita a operação: peça ao administrador para conferir o resultado no servidor.',
      stale: 'O contexto de acesso mudou. Nenhum resultado será aplicado nesta tela; confira a empresa e a conta corretas antes de continuar.',
      busy: 'Existe uma alteração de empresa pendente ou incerta neste navegador. Não repita a operação. Peça ao administrador para conferir seu resultado antes de liberar novas alterações.',
    }[outcome])
    this.name = 'TenantMutationFailure'
    this.outcome = outcome
    this.settled = settled
  }
}
const fail = (outcome: TenantMutationFailure['outcome'], settled = false): never => { throw new TenantMutationFailure(outcome, settled) }
const identity = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value === value.trim()
const current = (check: () => boolean): boolean => { try { return check() === true } catch { return false } }
const knownRejection = (error: unknown): boolean => !!error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' &&
  (/^(22|23|42)[A-Z0-9]{3}$/.test(error.code) || error.code === 'P0001' || error.code === 'PGRST202')

function validRequest(request: TenantMutationRequest): boolean {
  if (!request || !identity(request.tenantId) || !identity(request.actorId) || !identity(request.targetId) ||
    !['create', 'update', 'delete'].includes(request.kind) || typeof request.details !== 'boolean') return false
  if (request.kind === 'create') {
    // Client correlation ID lets the receipt identify this exact insert, not an
    // unrelated row with a matching name. It does not authorize provisioning.
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(request.targetId) || request.before !== undefined) return false
  } else {
    try { if (validateTenantRow(request.before, request.details).id !== request.targetId) return false } catch { return false }
  }
  if (request.kind === 'delete') return request.values === undefined
  const values = request.values
  if (!values || typeof values !== 'object' || !Object.keys(values).length ||
    Object.keys(values).some(key => !['name', 'phone', 'address', 'segment', 'status'].includes(key))) return false
  if ((request.kind === 'create' || 'name' in values) && !identity(values.name)) return false
  for (const field of ['phone', 'address'] as const) if (field in values && values[field] !== null && typeof values[field] !== 'string') return false
  if ('segment' in values && !['salao', 'clinica', 'barbearia', 'estetica', 'outro'].includes(values.segment ?? '')) return false
  if ('status' in values && !['pendente', 'ativo', 'inativo'].includes(values.status ?? '')) return false
  if (!request.details && Object.keys(values).some(key => key !== 'name')) return false
  return true
}

export async function mutateTenant(options: TenantMutationRequest & {
  isCurrent: () => boolean;
  onTimeout?: () => void;
  execute: (request: TenantMutationRequest) => PromiseLike<{ data: unknown; error: unknown; count?: unknown; status?: unknown }>;
}): Promise<TenantDirectoryRow> {
  if (!validRequest(options)) return fail('rejected', true)
  const request: TenantMutationRequest = {
    tenantId: options.tenantId, actorId: options.actorId, targetId: options.targetId,
    kind: options.kind, details: options.details,
    ...(options.values ? { values: { ...options.values } } : {}),
    ...(options.before ? { before: validateTenantRow(options.before, options.details) } : {}),
  }
  if (!current(options.isCurrent)) return fail('stale', true)
  let dispatched = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let response: { data: unknown; error: unknown; count?: unknown; status?: unknown }
  try {
    response = await Promise.race([
      Promise.resolve().then(() => {
        if (!current(options.isCurrent)) return fail('stale', true)
        dispatched = true
        return options.execute({ ...request, ...(request.before ? { before: { ...request.before } } : {}), ...(request.values ? { values: { ...request.values } } : {}) })
      }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => {
        reject(new Error('deadline'))
        options.onTimeout?.()
      }, 45_000) }),
    ])
  } catch {
    if (!dispatched || !current(options.isCurrent)) return fail('stale', !dispatched)
    return fail('uncertain')
  } finally { if (timer !== undefined) clearTimeout(timer) }
  const uncertain = (): never => fail(current(options.isCurrent) ? 'uncertain' : 'stale')
  if (!response || typeof response !== 'object') return uncertain()
  if (response.error !== null) {
    const canonicalFailure = response.data === null && (response.count == null || response.count === 0) &&
      (response.status === undefined || (typeof response.status === 'number' && response.status >= 400 && response.status <= 599))
    if (knownRejection(response.error) && canonicalFailure) return fail(current(options.isCurrent) ? 'rejected' : 'stale', true)
    return uncertain()
  }
  if (!Array.isArray(response.data) || response.data.length !== 1) return uncertain()
  if (response.count != null && response.count !== 1) return uncertain()
  if (response.status !== undefined && (typeof response.status !== 'number' || response.status < 200 || response.status >= 300)) return uncertain()
  let row: TenantDirectoryRow
  try { row = validateTenantRow(response.data[0], request.details) } catch { return uncertain() }
  if (row.id !== request.targetId) return uncertain()
  const expected = { ...request.before, ...request.values }
  for (const field of Object.keys(expected) as (keyof TenantDirectoryRow)[]) {
    if (row[field] !== expected[field]) return uncertain()
  }
  if (!current(options.isCurrent)) return fail('stale', true)
  return row
}

export const TENANT_MUTATION_KEY = 'nucleo.tenant-mutation.v1'
export type TenantStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export type PendingTenantMutation = TenantScope & {
  requestId: string; targetId: string; kind: TenantMutationRequest['kind']; createdAt: string;
}
export function readPendingTenantMutation(storage: TenantStorage): PendingTenantMutation | null {
  try {
    const raw = storage.getItem(TENANT_MUTATION_KEY)
    if (raw === null) return null
    const marker = JSON.parse(raw) as PendingTenantMutation
    if (!marker || !identity(marker.requestId) || !identity(marker.tenantId) || !identity(marker.actorId) || !identity(marker.targetId) ||
      !['create', 'update', 'delete'].includes(marker.kind) || typeof marker.createdAt !== 'string' || !Number.isFinite(Date.parse(marker.createdAt)) ||
      new Date(marker.createdAt).toISOString() !== marker.createdAt ||
      Object.keys(marker).some(field => !['requestId', 'tenantId', 'actorId', 'targetId', 'kind', 'createdAt'].includes(field))) return fail('busy', true)
    return marker
  } catch { return fail('busy', true) }
}

// Global to tenant administration in this browser, across pages, actors and tabs.
// No expiry and no automatic reconciliation: a fresh list cannot prove whether a
// timed-out write is still running. A future administrative recovery must confirm
// its server outcome before clearing this marker. No personal form data is saved.
export async function withTenantReservation<T>(options: TenantScope & {
  targetId: string; kind: TenantMutationRequest['kind']; requestId: string;
  storage: TenantStorage; locks: Pick<LockManager, 'request'> | undefined; work: () => Promise<T>;
}): Promise<T> {
  if (!identity(options.tenantId) || !identity(options.actorId) || !identity(options.targetId) || !identity(options.requestId) ||
    !['create', 'update', 'delete'].includes(options.kind) || !options.locks) return fail('busy', true)
  const { storage, locks, work, tenantId, actorId, targetId, kind, requestId } = options
  let entered = false
  try {
    return await locks.request(TENANT_MUTATION_KEY, { mode: 'exclusive', ifAvailable: true }, async lock => {
      if (!lock) return fail('busy', true)
      entered = true
      if (readPendingTenantMutation(storage)) return fail('busy', true)
      const marker: PendingTenantMutation = { tenantId, actorId, targetId, kind, requestId, createdAt: new Date().toISOString() }
      try {
        const serialized = JSON.stringify(marker)
        storage.setItem(TENANT_MUTATION_KEY, serialized)
        if (storage.getItem(TENANT_MUTATION_KEY) !== serialized) return fail('busy', true)
      } catch { return fail('busy', true) }
      const clearOwnMarker = () => {
        try { if (readPendingTenantMutation(storage)?.requestId === requestId) storage.removeItem(TENANT_MUTATION_KEY) }
        catch { /* A retained marker blocks future work, even after confirmed success. */ }
      }
      let value: T
      try { value = await work() }
      catch (error) {
        if (error instanceof TenantMutationFailure && error.settled) clearOwnMarker()
        throw error
      }
      clearOwnMarker()
      return value
    })
  } catch (error) {
    if (entered || error instanceof TenantMutationFailure) throw error
    return fail('busy', true)
  }
}
