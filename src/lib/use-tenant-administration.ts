import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTenant } from '../contexts/tenant-context'
import { supabase } from './supabase'
import { createTenantReadGate, readTenantDirectory, tenantScope, tenantScopeKey, TenantReadFailure } from './tenant-directory'
import type { TenantDirectoryRow } from './tenant-directory'
import { mutateTenant, readPendingTenantMutation, TENANT_MUTATION_KEY, TenantMutationFailure, withTenantReservation } from './tenant-operations'
import type { TenantMutationRequest, TenantValues } from './tenant-operations'

const CHANGED = 'nucleo-tenant-mutation-changed'
const columns = (details: boolean) => details ? 'id, name, phone, address, segment, status, created_at' : 'id, name, created_at'

export function useTenantAdministration(details: boolean) {
  const identity = useTenant()
  const scope = tenantScope(identity)
  const scopeKey = tenantScopeKey(scope)
  const latestScope = useRef(scope)
  latestScope.current = scope
  const latestSession = useRef(identity.session)
  latestSession.current = identity.session
  const mounted = useRef(false)
  const readAbort = useRef<AbortController | null>(null)
  const mutationAbort = useRef<AbortController | null>(null)
  const gate = useRef(createTenantReadGate())
  const busy = useRef(false)
  const [items, setItems] = useState<TenantDirectoryRow[]>([])
  const latestItems = useRef(items)
  latestItems.current = items
  const [loading, setLoading] = useState(!!scope)
  const [confirmed, setConfirmed] = useState(false)
  const [total, setTotal] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [mutationError, setMutationError] = useState<string | null>(null)
  const [mutating, setMutating] = useState(false)
  const [blocked, setBlocked] = useState(true)

  const refresh = useCallback(async () => {
    const ownScope = latestScope.current
    const accessToken = latestSession.current?.access_token
    if (!mounted.current || !ownScope || !accessToken || busy.current || tenantScopeKey(ownScope) !== scopeKey) return
    readAbort.current?.abort()
    const controller = new AbortController()
    readAbort.current = controller
    const ownsRequest = gate.current.begin()
    const isCurrent = () => mounted.current && ownsRequest() && tenantScopeKey(latestScope.current) === scopeKey
    setLoading(true)
    try {
      const next = await readTenantDirectory({
        scope: ownScope, details, isCurrent, onTimeout: () => controller.abort(),
        execute: request => supabase.from('tenants').select(columns(request.details), { count: 'exact' })
          .order('created_at', { ascending: !details }).retry(false)
          .setHeader('Authorization', `Bearer ${accessToken}`).abortSignal(controller.signal),
      })
      if (!isCurrent()) return
      setItems(next.items)
      setTotal(next.total)
      setConfirmed(true)
      setLoadError(null)
    } catch (failure) {
      if (isCurrent()) setLoadError(failure instanceof TenantReadFailure ? failure.message : new TenantReadFailure('unavailable').message)
    } finally { if (isCurrent()) setLoading(false) }
  }, [details, scopeKey])

  const syncPending = useCallback(() => {
    if (!mounted.current) return
    try {
      if (!navigator.locks || typeof crypto === 'undefined' || typeof crypto.randomUUID !== 'function') throw new Error('Reservation unavailable')
      setBlocked(Boolean(readPendingTenantMutation(window.localStorage)))
    } catch { setBlocked(true) }
  }, [])

  // Layout cleanup runs during unmount/identity replacement, before passive
  // continuations can send a query waiting inside the SDK's asynchronous auth.
  useLayoutEffect(() => () => {
    mounted.current = false
    gate.current.cancel()
    readAbort.current?.abort()
    mutationAbort.current?.abort()
  }, [scopeKey])

  useEffect(() => {
    mounted.current = true
    const requests = gate.current
    syncPending()
    void refresh()
    const changed = () => { syncPending(); if (!busy.current) void refresh() }
    const storageChanged = (event: StorageEvent) => { if (event.key === null || event.key === TENANT_MUTATION_KEY) changed() }
    window.addEventListener(CHANGED, changed)
    window.addEventListener('storage', storageChanged)
    return () => {
      mounted.current = false
      requests.cancel()
      window.removeEventListener(CHANGED, changed)
      window.removeEventListener('storage', storageChanged)
    }
  }, [refresh, syncPending])

  const mutate = async (kind: TenantMutationRequest['kind'], before?: TenantDirectoryRow, values?: TenantValues): Promise<boolean> => {
    const ownScope = latestScope.current
    const accessToken = latestSession.current?.access_token
    const isCurrent = () => mounted.current && tenantScopeKey(latestScope.current) === scopeKey
    if (!ownScope || !accessToken || !isCurrent() || busy.current) return false
    if (kind !== 'create' && (!before || !latestItems.current.some(row => row.id === before.id))) {
      setMutationError(new TenantMutationFailure('rejected', true).message)
      return false
    }
    busy.current = true
    gate.current.cancel()
    readAbort.current?.abort()
    const controller = new AbortController()
    mutationAbort.current = controller
    setLoading(false)
    setMutating(true)
    setMutationError(null)
    let dispatchAttempted = false
    try {
      const targetId = kind === 'create' ? crypto.randomUUID() : before!.id
      const request: TenantMutationRequest = { ...ownScope, kind, targetId, details,
        ...(values ? { values: { ...values } } : {}), ...(before ? { before: { ...before } } : {}) }
      const row = await withTenantReservation({
        ...request, requestId: crypto.randomUUID(), storage: window.localStorage, locks: navigator.locks,
        work: () => mutateTenant({ ...request, isCurrent, onTimeout: () => controller.abort(),
          execute: operation => {
            dispatchAttempted = true
            const table = supabase.from('tenants')
            if (operation.kind === 'create') return table.insert({ id: operation.targetId, ...operation.values }).select(columns(details)).retry(false)
              .setHeader('Authorization', `Bearer ${accessToken}`).abortSignal(controller.signal)
            let query = operation.kind === 'delete' ? table.delete() : table.update(operation.values!)
            query = query.eq('id', operation.targetId)
            // Compare the observed snapshot. A competing writer cannot silently
            // overwrite it: zero affected rows is never a confirmed mutation.
            for (const [field, value] of Object.entries(operation.before!)) {
              if (field === 'id') continue
              query = value === null ? query.is(field, null) : query.eq(field, value)
            }
            return query.select(columns(details)).retry(false)
              .setHeader('Authorization', `Bearer ${accessToken}`).abortSignal(controller.signal)
          },
        }),
      })
      if (!isCurrent()) return false
      setItems(previous => kind === 'create' ? [...previous, row] : kind === 'delete' ? previous.filter(item => item.id !== row.id) : previous.map(item => item.id === row.id ? row : item))
      setTotal(previous => previous === null ? null : previous + (kind === 'create' ? 1 : kind === 'delete' ? -1 : 0))
      // Mutations cannot establish that the full directory was loaded.
      return true
    } catch (failure) {
      if (isCurrent()) setMutationError(failure instanceof TenantMutationFailure ? failure.message : new TenantMutationFailure(dispatchAttempted ? 'uncertain' : 'busy', !dispatchAttempted).message)
      return false
    } finally {
      busy.current = false
      if (isCurrent()) { setMutating(false); syncPending() }
      // Other mounted pages refresh only on settlement; uncertain markers persist.
      window.dispatchEvent(new Event(CHANGED))
    }
  }

  const loadNotice = confirmed && total === null
    ? 'Total não confirmado. Indicadores e ações desta tela consideram somente os registros carregados.'
    : total !== null && total > items.length ? `Lista parcial: ${items.length} de ${total} empresas visíveis foram carregadas. Indicadores e ações desta tela consideram somente os registros carregados.` : null
  return { items, loading, confirmed, loadError, loadNotice, mutationError, mutating, blocked, refresh, mutate, hasIdentity: !!scope }
}
