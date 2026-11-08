import test from 'node:test'
import assert from 'node:assert/strict'
import { mutateTenant, TenantMutationFailure, TENANT_MUTATION_KEY, readPendingTenantMutation, withTenantReservation } from '../src/lib/tenant-operations.ts'

const scope = { tenantId: 'origin-tenant', actorId: 'actor-a' }
const row = { id: 'target-other-tenant', name: 'Empresa fictícia', created_at: '2026-11-08T00:00:00Z', phone: null, address: null, segment: 'salao', status: 'pendente' }
const id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const request = extra => ({ ...scope, kind: 'update', targetId: row.id, details: true, before: row, values: { status: 'ativo' }, ...extra })
const options = extra => ({ ...request(), isCurrent: () => true, execute: async () => ({ data: [{ ...row, status: 'ativo' }], error: null }), ...extra })
const fails = (outcome, settled) => error => error instanceof TenantMutationFailure && error.outcome === outcome &&
  (settled === undefined || error.settled === settled) && !/SECRET|private-token|fix_rls|service_role/.test(error.message)
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
const storage = () => { const entries = new Map(); return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key) } }
const freeLocks = { request: async (_name, _options, callback) => callback({ name: TENANT_MUTATION_KEY }) }
const reservation = extra => ({ ...scope, targetId: row.id, kind: 'update', requestId: 'request-a', storage: storage(), locks: freeLocks, work: () => mutateTenant(options()), ...extra })

test('invalid scope, target, kind, payload and snapshot never dispatch', async () => {
  let calls = 0
  for (const extra of [
    { tenantId: '' }, { actorId: '' }, { targetId: '' }, { targetId: 'different' }, { kind: 'upsert' }, { values: {} },
    { values: { role: 'superadmin' } }, { values: { id: 'foreign' } }, { values: { status: 'SECRET' } }, { before: undefined },
    { values: { name: ' ' } }, { kind: 'delete' }, { kind: 'create', before: undefined, targetId: 'not-uuid', values: { name: 'Name' } },
  ]) await assert.rejects(mutateTenant(options({ ...extra, execute: () => { calls++ } })), fails('rejected', true))
  assert.equal(calls, 0)
})

test('update/delete validate exact target and snapshot without requiring origin tenant equality', async () => {
  assert.deepEqual(await mutateTenant(options()), { ...row, status: 'ativo' })
  assert.deepEqual(await mutateTenant(options({ kind: 'delete', values: undefined, execute: async () => ({ data: [row], error: null }) })), row)
})

test('insert accepts only the exact UUID and submitted values; no user provisioning', async () => {
  const create = { ...scope, targetId: id, kind: 'create', details: false, before: undefined, values: { name: 'New fictitious company' } }
  const created = { id, name: create.values.name, created_at: row.created_at }
  let calls = 0
  assert.deepEqual(await mutateTenant(options({ ...create, execute: async value => {
    calls++; const expected = { ...create }; delete expected.before; assert.deepEqual(value, expected); return { data: [created], error: null }
  } })), created)
  assert.equal(calls, 1)
  for (const bad of [{ ...created, id: row.id }, { ...created, name: 'Other' }]) {
    await assert.rejects(mutateTenant(options({ ...create, execute: async () => ({ data: [bad], error: null }) })), fails('uncertain', false))
  }
})

test('zero, partial, duplicate, foreign and contradictory receipts are never successes', async () => {
  const good = { ...row, status: 'ativo' }
  for (const data of [[], null, {}, [null], [good, good], [{ id: row.id }], [{ ...good, id: 'foreign' }], [row], [{ ...good, phone: 'changed' }]]) {
    await assert.rejects(mutateTenant(options({ execute: async () => ({ data, error: null }) })), fails('uncertain', false))
  }
  for (const response of [null, {}, { data: [good] }, { data: [good], error: false }]) {
    await assert.rejects(mutateTenant(options({ execute: async () => response })), fails('uncertain', false))
  }
})

test('only reliable rejection codes settle; backend messages never grant clearance', async () => {
  for (const code of ['42501', '23503', '23505', '22023', 'P0001', 'PGRST202']) {
    await assert.rejects(mutateTenant(options({ execute: async () => ({ data: null, error: { code, message: 'SECRET private-token' } }) })), fails('rejected', true))
  }
  for (const error of [{}, { code: '503' }, { message: 'new row violates row-level security SECRET' }, { code: '08P01' }]) {
    await assert.rejects(mutateTenant(options({ execute: async () => ({ data: null, error }) })), fails('uncertain', false))
  }
  await assert.rejects(mutateTenant(options({ execute: () => { throw Error('SECRET') } })), fails('uncertain', false))
})

test('scope changes before dispatch or after exact receipt are stale and settled appropriately', async () => {
  let calls = 0
  await assert.rejects(mutateTenant(options({ isCurrent: () => false, execute: () => { calls++ } })), fails('stale', true))
  assert.equal(calls, 0)
  let active = true
  await assert.rejects(mutateTenant(options({ isCurrent: () => active, execute: async () => { active = false; return { data: [{ ...row, status: 'ativo' }], error: null } } })), fails('stale', true))
  active = true
  await assert.rejects(mutateTenant(options({ isCurrent: () => active, execute: async () => { active = false; throw Error('SECRET') } })), fails('stale', false))
})

test('45-second deadline retains uncertainty and ignores late success, without retry', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const pending = deferred(); let calls = 0
  const operation = mutateTenant(options({ execute: () => { calls++; return pending.promise } }))
  const rejection = assert.rejects(operation, fails('uncertain', false))
  await Promise.resolve(); t.mock.timers.tick(45_001); await rejection
  pending.resolve({ data: [{ ...row, status: 'ativo' }], error: null })
  await Promise.resolve(); assert.equal(calls, 1)
})

test('confirmed success/rejection clear only their own marker; uncertainty persists after reload/actor change', async () => {
  for (const work of [() => mutateTenant(options()), () => mutateTenant(options({ execute: async () => ({ data: null, error: { code: '42501' } }) }))]) {
    const store = storage()
    await withTenantReservation(reservation({ storage: store, work })).catch(error => { assert.equal(error.settled, true) })
    assert.equal(readPendingTenantMutation(store), null)
  }
  const store = storage()
  await assert.rejects(withTenantReservation(reservation({ storage: store, work: () => mutateTenant(options({ execute: async () => ({ data: [], error: null }) })) })), fails('uncertain'))
  const pending = readPendingTenantMutation(store)
  assert.deepEqual(Object.keys(pending).sort(), ['actorId', 'createdAt', 'kind', 'requestId', 'targetId', 'tenantId'])
  let calls = 0
  for (const actorId of ['actor-a', 'actor-b']) await assert.rejects(withTenantReservation(reservation({ storage: store, actorId, requestId: 'new-request', work: async () => { calls++ } })), fails('busy'))
  assert.equal(calls, 0)
  assert.deepEqual(readPendingTenantMutation(store), pending)
})

test('missing locks, active other tab, blocked/corrupt storage fail before dispatch', async () => {
  let calls = 0
  for (const extra of [
    { locks: undefined }, { locks: { request: async (_name, _options, callback) => callback(null) } },
    { storage: { getItem() { throw Error('blocked') } } },
    { storage: { getItem: () => '{corrupt', setItem() {}, removeItem() {} } },
    { storage: { getItem: () => null, setItem() { throw Error('quota') }, removeItem() {} } },
  ]) await assert.rejects(withTenantReservation(reservation({ ...extra, work: async () => { calls++ } })), fails('busy', true))
  assert.equal(calls, 0)
})

test('concurrent page/tab attempts reserve globally before dispatch and reject the second', async () => {
  const store = storage(), pending = deferred()
  let occupied = false, calls = 0
  const locks = { request: async (_name, _options, callback) => {
    if (occupied) return callback(null)
    occupied = true
    try { return await callback({ name: TENANT_MUTATION_KEY }) } finally { occupied = false }
  } }
  const first = withTenantReservation(reservation({ storage: store, locks, work: async () => { calls++; return pending.promise } }))
  await assert.rejects(withTenantReservation(reservation({ storage: store, locks, actorId: 'actor-b', targetId: 'different-target', requestId: 'second', work: async () => { calls++ } })), fails('busy', true))
  assert.equal(calls, 1)
  pending.resolve('confirmed'); assert.equal(await first, 'confirmed')
  assert.equal(readPendingTenantMutation(store), null)
})

test('stale unsettled work cannot clear marker and a substituted marker is never removed', async () => {
  const store = storage()
  await assert.rejects(withTenantReservation(reservation({ storage: store, work: async () => { throw new TenantMutationFailure('stale', false) } })), fails('stale', false))
  assert.ok(readPendingTenantMutation(store))
  const otherStore = storage()
  await withTenantReservation(reservation({ storage: otherStore, work: async () => {
    const marker = readPendingTenantMutation(otherStore)
    otherStore.setItem(TENANT_MUTATION_KEY, JSON.stringify({ ...marker, requestId: 'other-request', actorId: 'other-actor' }))
    return true
  } }))
  assert.equal(readPendingTenantMutation(otherStore).requestId, 'other-request')
})

test('contradictory error/status/count envelopes retain uncertainty and the durable marker', async () => {
  const exact = { ...row, status: 'ativo' }
  for (const response of [
    { data: [exact], error: { code: '42501' } }, { data: [], error: { code: '42501' } },
    { data: null, error: { code: '23503' }, count: 1 }, { data: null, error: { code: '42501' }, status: 200 },
    { data: [exact], error: null, count: 0 }, { data: [exact], error: null, count: 2 }, { data: [exact], error: null, status: 400 },
  ]) {
    const store = storage()
    await assert.rejects(withTenantReservation(reservation({ storage: store, work: () => mutateTenant(options({ execute: async () => response })) })), fails('uncertain', false))
    assert.ok(readPendingTenantMutation(store))
  }
})
