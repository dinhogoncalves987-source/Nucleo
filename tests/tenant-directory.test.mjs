import test from 'node:test'
import assert from 'node:assert/strict'
import { readTenantDirectory, tenantScope, tenantScopeKey, createTenantReadGate, TenantReadFailure } from '../src/lib/tenant-directory.ts'

const scope = { tenantId: 'tenant-a', actorId: 'actor-a' }
const row = { id: 'tenant-a', name: 'Empresa fictícia', created_at: '2026-11-08T00:00:00Z' }
const details = { ...row, phone: null, address: null, segment: 'salao', status: 'pendente' }
const result = (data = [row], count = 1, error = null) => ({ data, count, error })
const options = extra => ({ scope, details: false, isCurrent: () => true, execute: async () => result(), ...extra })
const fails = kind => error => error instanceof TenantReadFailure && error.kind === kind && !/SECRET|private-token|fix_rls|service_role/.test(error.message)
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('scope requires current authenticated profile, tenant and matching actor, not frontend role', () => {
  const identity = { tenant: { id: 'tenant-a' }, user: { id: 'actor-a', tenant_id: 'tenant-a', role: 'superadmin' }, session: { user: { id: 'actor-a' }, access_token: 'synthetic-fixture' }, isAuthenticated: true, loading: false }
  assert.deepEqual(tenantScope(identity), scope)
  for (const extra of [
    { loading: true }, { isAuthenticated: false }, { tenant: null }, { user: null }, { session: null },
    { session: { user: { id: 'actor-b' } } }, { user: { id: 'actor-a', tenant_id: 'tenant-b', role: 'superadmin' } },
    { tenant: { id: '' } }, { user: { id: '', tenant_id: 'tenant-a' }, session: { user: { id: '' } } },
  ]) assert.equal(tenantScope({ ...identity, ...extra }), null)
  assert.notEqual(tenantScopeKey(scope), tenantScopeKey({ ...scope, actorId: 'actor-b' }))
  assert.notEqual(tenantScopeKey(scope), tenantScopeKey({ ...scope, tenantId: 'tenant-b' }))
  assert.notEqual(tenantScopeKey({ tenantId: 'a:b', actorId: 'c' }), tenantScopeKey({ tenantId: 'a', actorId: 'b:c' }))
})

test('invalid identities and stale generation never dispatch', async () => {
  let calls = 0
  for (const bad of [null, { tenantId: '', actorId: 'a' }, { tenantId: 'a', actorId: '' }, { tenantId: 'a', actorId: ' ' }]) {
    await assert.rejects(readTenantDirectory(options({ scope: bad, execute: () => { calls++ } })), fails('denied'))
  }
  for (const isCurrent of [() => false, () => { throw Error('SECRET') }]) {
    await assert.rejects(readTenantDirectory(options({ isCurrent, execute: () => { calls++ } })), fails('stale'))
  }
  assert.equal(calls, 0)
})

test('confirmed directory row is projected with exact identity, count and nullable details', async () => {
  let calls = 0
  const rows = await readTenantDirectory(options({ execute: async request => {
    calls++
    assert.deepEqual(request, { ...scope, details: false })
    request.tenantId = 'changed'
    return result([{ ...row, ignored: 'SECRET' }])
  } }))
  assert.deepEqual(rows, { items: [row], total: 1 })
  assert.equal(calls, 1)
  assert.deepEqual(await readTenantDirectory(options({ details: true, execute: async () => result([details]) })), { items: [details], total: 1 })
  const nullable = { ...details, segment: null, status: null }
  assert.deepEqual(await readTenantDirectory(options({ details: true, execute: async () => result([nullable]) })), { items: [nullable], total: 1 })
})

test('impossible counts, duplicate and malformed read receipts never succeed', async () => {
  for (const response of [
    null, {}, result([], -1), result([row], 0), result([row], '1'), result([row, row], 2),
    result(null), result([null]), result([{ ...row, name: null }]),
    result([{ ...row, created_at: 'invalid' }]), result([{ id: row.id }]), { data: [row], count: 1 },
  ]) await assert.rejects(readTenantDirectory(options({ execute: async () => response })), fails('unavailable'))
  for (const bad of [{ ...row }, { ...details, phone: 4 }, { ...details, segment: 'SECRET' }, { ...details, status: 'SECRET' }]) {
    await assert.rejects(readTenantDirectory(options({ details: true, execute: async () => result([bad]) })), fails('unavailable'))
  }
})

test('RLS, FK, schema, transport and contradictory errors stay sanitized with no retry', async () => {
  for (const [code, kind] of [['42501', 'denied'], ['23503', 'unavailable'], ['23505', 'unavailable'], ['42703', 'unavailable'], ['PGRST202', 'unavailable'], ['503', 'unavailable']]) {
    let calls = 0
    await assert.rejects(readTenantDirectory(options({ execute: async () => {
      calls++
      return result([row], 1, { code, message: 'SECRET private-token', hint: 'fix_rls service_role' })
    } })), fails(kind))
    assert.equal(calls, 1)
  }
  for (const execute of [() => { throw Error('SECRET') }, () => Promise.reject(Error('SECRET')), () => Promise.resolve(result([row], 1, {}))]) {
    await assert.rejects(readTenantDirectory(options({ execute })), fails('unavailable'))
  }
})

test('45 second deadline ignores late reply and never retries', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const pending = deferred()
  let calls = 0
  const operation = readTenantDirectory(options({ execute: () => { calls++; return pending.promise } }))
  const rejected = assert.rejects(operation, fails('unavailable'))
  await Promise.resolve()
  t.mock.timers.tick(45_001)
  await rejected
  pending.resolve(result())
  await Promise.resolve()
  assert.equal(calls, 1)
})

test('superseded refresh, unmount, logout and identity change invalidate late callbacks', async () => {
  for (const change of ['refresh', 'unmount', 'logout', 'tenant', 'actor']) {
    const gate = createTenantReadGate()
    const request = gate.begin()
    let currentKey = tenantScopeKey(scope)
    const pending = deferred()
    const operation = readTenantDirectory(options({ isCurrent: () => request() && currentKey === tenantScopeKey(scope), execute: () => pending.promise }))
    await Promise.resolve()
    if (change === 'refresh') gate.begin()
    else if (change === 'unmount') gate.cancel()
    else if (change === 'logout') currentKey = tenantScopeKey(null)
    else currentKey = tenantScopeKey({ ...scope, [change === 'tenant' ? 'tenantId' : 'actorId']: 'other' })
    pending.resolve(result())
    await assert.rejects(operation, fails('stale'))
  }
})

test('administrative directory preserves server-authorized foreign rows without granting mutation', async () => {
  const rows = [{ ...row, id: 'tenant-b' }]
  assert.deepEqual(await readTenantDirectory(options({ execute: async () => result(rows) })), { items: rows, total: 1 })
  assert.deepEqual(await readTenantDirectory(options({ execute: async () => result([], 0) })), { items: [], total: 0 })
})

test('normal PostgREST partial pages preserve validated rows and exact total; created_at may be null', async () => {
  const nullable = { ...row, created_at: null }
  assert.deepEqual(await readTenantDirectory(options({ execute: async () => result([nullable], 1001) })), { items: [nullable], total: 1001 })
})

test('legacy empty or whitespace names are readable and preserved literally for later CAS', async () => {
  for (const name of ['', '   ', '  Nome com espaços  ']) {
    const legacy = { ...row, name }
    assert.deepEqual(await readTenantDirectory(options({ execute: async () => result([legacy]) })), { items: [legacy], total: 1 })
  }
})

test('missing total preserves validated rows with unknown total instead of inventing completeness', async () => {
  for (const count of [null, undefined]) {
    assert.deepEqual(await readTenantDirectory(options({ execute: async () => ({ data: [row], error: null, count }) })), { items: [row], total: null })
  }
  assert.deepEqual(await readTenantDirectory(options({ execute: async () => ({ data: [row], error: null }) })), { items: [row], total: null })
})
