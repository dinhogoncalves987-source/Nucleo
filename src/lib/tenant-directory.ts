// Frontend roles and successful reads never grant write capabilities. The server
// decides authorization; the deployed policy has not been inspected here.
export const TENANT_POLICY_NOTICE = 'As operações dependem das permissões do servidor. A política versionada permite apenas consultar a própria empresa; o fluxo administrativo da implantação precisa ser validado.'
export const TENANT_PROVISIONING_NOTICE = 'Cadastrar uma empresa não cria conta de acesso nem perfil de usuário.'

export type TenantScope = { tenantId: string; actorId: string }
export type TenantDirectoryRow = {
  id: string; name: string; created_at: string | null;
  phone?: string | null; address?: string | null;
  segment?: string | null; status?: string | null;
}
export type TenantReadRequest = TenantScope & { details: boolean }
export type TenantReadResult = { data: unknown; error: unknown; count: unknown }
export type TenantReader = (request: TenantReadRequest) => PromiseLike<TenantReadResult>
type Identity = {
  tenant: { id: string } | null;
  user: { id: string; tenant_id: string } | null;
  session: { user: { id: string }; access_token: string } | null;
  isAuthenticated: boolean; loading: boolean;
}
const validId = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value === value.trim()
const validScope = (scope: TenantScope | null): scope is TenantScope => !!scope && validId(scope.tenantId) && validId(scope.actorId)

export function tenantScope(identity: Identity): TenantScope | null {
  if (identity.loading || !identity.isAuthenticated || !identity.tenant || !identity.user ||
    identity.session?.user.id !== identity.user.id || !validId(identity.session?.access_token) || identity.user.tenant_id !== identity.tenant.id) return null
  const scope = { tenantId: identity.tenant.id, actorId: identity.user.id }
  return validScope(scope) ? scope : null
}

export const tenantScopeKey = (scope: TenantScope | null): string => validScope(scope) ? JSON.stringify([scope.tenantId, scope.actorId]) : 'no-identity'

export class TenantReadFailure extends Error {
  kind: 'denied' | 'unavailable' | 'stale'
  constructor(kind: TenantReadFailure['kind']) {
    super(kind === 'denied'
      ? 'Consulta não autorizada. Peça ao administrador para verificar o vínculo da sua conta com a empresa.'
      : kind === 'stale'
        ? 'O contexto de acesso mudou. Consulte novamente a empresa da sessão atual.'
        : 'Não foi possível confirmar os dados da empresa. A última leitura confirmada foi preservada, quando disponível. Atualize a consulta para tentar novamente.')
    this.name = 'TenantReadFailure'
    this.kind = kind
  }
}
const current = (check: () => boolean): boolean => { try { return check() === true } catch { return false } }
const fail = (kind: TenantReadFailure['kind']): never => { throw new TenantReadFailure(kind) }

export function validateTenantRow(data: unknown, details: boolean): TenantDirectoryRow {
  if (!data || typeof data !== 'object') return fail('unavailable')
  const row = data as Record<string, unknown>
  if (!validId(row.id) || typeof row.name !== 'string' || (row.created_at !== null &&
    (typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))))) return fail('unavailable')
  const result: TenantDirectoryRow = { id: row.id, name: row.name, created_at: row.created_at }
  if (details) {
    for (const field of ['phone', 'address', 'segment', 'status'] as const) {
      if (row[field] !== null && typeof row[field] !== 'string') return fail('unavailable')
      result[field] = row[field] as string | null
    }
    if (result.segment !== null && !['salao', 'clinica', 'barbearia', 'estetica', 'outro'].includes(result.segment!)) return fail('unavailable')
    if (result.status !== null && !['pendente', 'ativo', 'inativo'].includes(result.status!)) return fail('unavailable')
  }
  return result
}

// Preserve the existing administrative list scope; RLS determines which rows the
// actor may read. Origin tenant/actor only fence stale callbacks, never grant access.
export async function readTenantDirectory(options: {
  scope: TenantScope | null; details: boolean; isCurrent: () => boolean; execute: TenantReader; onTimeout?: () => void;
}): Promise<{ items: TenantDirectoryRow[]; total: number | null }> {
  if (!validScope(options.scope)) return fail('denied')
  const scope = { ...options.scope }
  const { details, isCurrent, execute } = options
  if (!current(isCurrent)) return fail('stale')
  let timer: ReturnType<typeof setTimeout> | undefined
  let response: TenantReadResult
  try {
    response = await Promise.race([
      Promise.resolve().then(() => {
        if (!current(isCurrent)) return fail('stale')
        return execute({ ...scope, details })
      }),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => {
        reject(new TenantReadFailure('unavailable'))
        options.onTimeout?.()
      }, 45_000) }),
    ])
  } catch {
    return fail(current(isCurrent) ? 'unavailable' : 'stale')
  } finally { if (timer !== undefined) clearTimeout(timer) }
  if (!current(isCurrent)) return fail('stale')
  if (!response || typeof response !== 'object') return fail('unavailable')
  if (response.error !== null) {
    const error = response.error
    return fail(error && typeof error === 'object' && 'code' in error && error.code === '42501' ? 'denied' : 'unavailable')
  }
  if (!Array.isArray(response.data)) return fail('unavailable')
  const total = response.count == null ? null : response.count
  if (total !== null && (typeof total !== 'number' || !Number.isSafeInteger(total) || total < response.data.length)) return fail('unavailable')
  const rows = response.data.map(row => validateTenantRow(row, details))
  if (new Set(rows.map(row => row.id)).size !== rows.length) return fail('unavailable')
  return { items: rows, total }
}

// Latest refresh wins; cleanup invalidates callbacks from a previous mount.
export function createTenantReadGate() {
  let generation = 0
  return {
    begin: () => { const own = ++generation; return () => generation === own },
    cancel: () => { ++generation },
  }
}
