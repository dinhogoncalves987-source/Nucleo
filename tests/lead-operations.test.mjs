import test from 'node:test'
import assert from 'node:assert/strict'
import { mutateLeadRecords, MutationFailure, LEAD_CONTACT_AVAILABLE, LEAD_CONTACT_BLOCK_REASON, pendingLeadMutationKey, readPendingLeadMutation, withLeadMutationReservation } from '../src/lib/lead-operations.ts'

const rows = () => [{ id: 'legacy-1', tenant_id: 'company-A', status: 'qualified' }]
const options = (extra = {}) => ({ kind: 'status', tenantId: 'company-A', ids: ['legacy-1'], status: 'qualified', isCurrent: () => true, execute: async () => ({ data: rows(), error: null }), ...extra })
const fails = outcome => error => error instanceof MutationFailure && error.outcome === outcome && !error.message.includes('SECRET')

test('invalid identity, ids, duplicates, limit, kind and status never dispatch', async () => {
  let calls = 0
  for (const extra of [{ tenantId: '' }, { tenantId: ' ' }, { ids: [] }, { ids: [''] }, { ids: [' '] }, { ids: [null] }, { ids: ['x', 'x'] }, { ids: Array.from({ length: 1001 }, (_, i) => String(i)) }, { kind: 'insert' }, { status: 'SECRET' }, { status: undefined }, { kind: 'delete' }]) {
    await assert.rejects(mutateLeadRecords(options({ ...extra, execute: async () => { calls++; return {} } })), fails('rejected'))
  }
  assert.equal(calls, 0)
})
test('legacy ids and exact tenant/ids/status are sent once and confirmed', async () => {
  let calls = 0
  const result = await mutateLeadRecords(options({ execute: async request => {
    calls++
    assert.deepEqual(request, { kind: 'status', tenantId: 'company-A', ids: ['legacy-1'], status: 'qualified' })
    return { data: rows(), error: null }
  } }))
  assert.deepEqual(result, { ids: ['legacy-1'], status: 'qualified' })
  assert.equal(calls, 1)
})
test('delete accepts exact unordered rows but requires tenant on each', async () => {
  const result = await mutateLeadRecords(options({ kind: 'delete', status: undefined, ids: ['a', 'b'], execute: async request => {
    assert.equal('status' in request, false)
    return { data: [{ id: 'b', tenant_id: 'company-A' }, { id: 'a', tenant_id: 'company-A' }], error: null }
  } }))
  assert.deepEqual(result, { ids: ['a', 'b'] })
})
test('no rows, partial, duplicate, foreign or contradictory rows never succeed', async () => {
  for (const data of [null, undefined, {}, [], [...rows(), ...rows()], [{ id: 'foreign', tenant_id: 'company-A', status: 'qualified' }], [{ ...rows()[0], tenant_id: 'other' }], [{ ...rows()[0], status: 'new' }], [{ id: 'legacy-1', status: 'qualified' }], [null]]) {
    await assert.rejects(mutateLeadRecords(options({ execute: async () => ({ data, error: null }) })), fails('uncertain'))
  }
  for (const data of [[rows()[0]], [rows()[0], rows()[0]]]) await assert.rejects(mutateLeadRecords(options({ ids: ['legacy-1', 'legacy-2'], execute: async () => ({ data, error: null }) })), fails('uncertain'))
})
test('known database rejection is sanitized; unknown errors remain uncertain', async () => {
  for (const [code, outcome] of [['42501', 'rejected'], ['23505', 'rejected'], ['22023', 'rejected'], ['P0001', 'rejected'], ['PGRST202', 'rejected'], ['503', 'uncertain'], ['08P01', 'uncertain'], ['42SECRET', 'uncertain']]) {
    await assert.rejects(mutateLeadRecords(options({ execute: async () => ({ data: rows(), error: { code, message: 'SECRET' } }) })), fails(outcome))
  }
  for (const result of [null, {}, { data: rows() }, { data: rows(), error: false }]) await assert.rejects(mutateLeadRecords(options({ execute: async () => result })), fails('uncertain'))
})
test('throws and promise rejection are sanitized without retries', async () => {
  for (const execute of [() => { throw new Error('SECRET') }, () => Promise.reject(new Error('SECRET'))]) {
    let calls = 0
    await assert.rejects(mutateLeadRecords(options({ execute: request => { calls++; return execute(request) } })), fails('uncertain'))
    assert.equal(calls, 1)
  }
})
test('stale context before dispatch, at dispatch, after response or throw never applies success', async () => {
  let calls = 0
  for (const isCurrent of [() => false, () => { throw Error('SECRET') }, (() => { let checks = 0; return () => ++checks === 1 })()]) {
    await assert.rejects(mutateLeadRecords(options({ isCurrent, execute: async () => { calls++; return { data: rows(), error: null } } })), fails('stale'))
  }
  assert.equal(calls, 0)
  for (const throws of [false, true]) {
    let active = true
    await assert.rejects(mutateLeadRecords(options({ isCurrent: () => active, execute: async () => { active = false; if (throws) throw Error('SECRET'); return { data: rows(), error: null } } })), fails('stale'))
  }
})
test('caller and executor cannot mutate expected id snapshot', async () => {
  const ids = ['legacy-1']
  const operation = mutateLeadRecords(options({ ids, execute: async request => { request.ids[0] = 'other'; return { data: rows(), error: null } } }))
  ids[0] = 'changed'
  assert.deepEqual(await operation, { ids: ['legacy-1'], status: 'qualified' })
})
test('45 second deadline stays uncertain despite a late response, with no retries', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0, release
  const operation = mutateLeadRecords(options({ execute: () => { calls++; return new Promise(resolve => { release = resolve }) } }))
  const rejected = assert.rejects(operation, fails('uncertain'))
  await Promise.resolve()
  t.mock.timers.tick(45_001)
  await rejected
  assert.equal(calls, 1)
  release({ data: rows(), error: null })
  await Promise.resolve()
  assert.equal(calls, 1)
})
test('contact gate remains closed regardless of source/validation/client flags', () => {
  for (const metadata of [{}, { origin: 'imported', validation_status: 'valid' }, { source: 'approved', contact_permission: 'granted', channel_authorized: true }]) {
    const available = LEAD_CONTACT_AVAILABLE && Boolean(metadata)
    assert.equal(available, false)
  }
  assert.match(LEAD_CONTACT_BLOCK_REASON, /permissao verificavel/)
  assert.match(LEAD_CONTACT_BLOCK_REASON, /canal autorizado/)
})

function memoryStorage() {
  const map = new Map()
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: key => map.delete(key) }
}
const freeLocks = { request: async (_key, _options, callback) => callback({ name: 'lock' }) }
const reservation = (extra = {}) => ({ kind: 'delete', tenantId: 'company-A', userId: 'user-A', requestId: 'request-A', ids: ['legacy-1'], storage: memoryStorage(), locks: freeLocks, work: async () => 42, ...extra })
test('reservation persists before work, has only ids/metadata and clears confirmed result', async () => {
  const storage = memoryStorage(), key = pendingLeadMutationKey('company-A')
  let calls = 0
  assert.equal(await withLeadMutationReservation(reservation({ storage, locks: { request: async (k, settings, callback) => {
    assert.equal(k, key); assert.deepEqual(settings, { mode: 'exclusive', ifAvailable: true }); return callback({ name: k })
  } }, work: async () => {
    calls++
    const marker = readPendingLeadMutation(storage, key, 'company-A')
    assert.deepEqual(Object.keys(marker).sort(), ['createdAt', 'ids', 'kind', 'requestId', 'tenantId', 'userId'])
    assert.equal(marker.userId, 'user-A'); assert.deepEqual(marker.ids, ['legacy-1'])
    assert.equal(new Date(marker.createdAt).toISOString(), marker.createdAt)
    return 42
  } })), 42)
  assert.equal(calls, 1); assert.equal(storage.getItem(key), null)
})
test('uncertainty survives reopening and switching users; no overwrite or second dispatch', async () => {
  const storage = memoryStorage(), key = pendingLeadMutationKey('company-A')
  await assert.rejects(withLeadMutationReservation(reservation({ storage, work: async () => { throw new MutationFailure('pending', 'uncertain') } })), fails('uncertain'))
  const original = storage.getItem(key)
  assert.ok(readPendingLeadMutation(storage, key, 'company-A'))
  let calls = 0
  for (const userId of ['user-A', 'user-B']) await assert.rejects(withLeadMutationReservation(reservation({ storage, userId, requestId: 'request-B', work: async () => { calls++ } })), fails('rejected'))
  assert.equal(calls, 0); assert.equal(storage.getItem(key), original)
})
test('missing/contended/failed lock cannot persist or dispatch', async () => {
  for (const locks of [undefined, { request: async (_k, _o, cb) => cb(null) }, { request: async () => { throw Error('SECRET') } }]) {
    const storage = memoryStorage(); let calls = 0
    await assert.rejects(withLeadMutationReservation(reservation({ storage, locks, work: async () => { calls++ } })), fails('rejected'))
    assert.equal(calls, 0); assert.equal(storage.getItem(pendingLeadMutationKey('company-A')), null)
  }
})
test('concurrent contender cannot enter while first work is pending', async () => {
  let held = false, release, calls = 0
  const locks = { request: async (_k, _o, callback) => {
    if (held) return callback(null)
    held = true
    try { return await callback({ name: 'lock' }) } finally { held = false }
  } }
  const storage = memoryStorage()
  const first = withLeadMutationReservation(reservation({ storage, locks, work: () => { calls++; return new Promise(resolve => { release = resolve }) } }))
  await assert.rejects(withLeadMutationReservation(reservation({ storage, locks, work: async () => { calls++ } })), fails('rejected'))
  assert.equal(calls, 1); release(42); assert.equal(await first, 42)
})
test('storage read/write/readback and malformed marker errors block work without deletion', async () => {
  const key = pendingLeadMutationKey('company-A')
  for (const storage of [
    { getItem: () => { throw Error('SECRET') }, setItem: () => {}, removeItem: () => assert.fail('must not delete') },
    { getItem: () => null, setItem: () => { throw Error('SECRET') }, removeItem: () => assert.fail('must not delete') },
    { getItem: () => null, setItem: () => {}, removeItem: () => assert.fail('must not delete') },
  ]) {
    await assert.rejects(withLeadMutationReservation(reservation({ storage, work: async () => assert.fail('no dispatch') })), fails('rejected'))
  }
  for (const raw of ['{bad', '{}', 'null', JSON.stringify({ requestId: 'r', tenantId: 'company-A', userId: 'u', kind: 'delete', ids: ['x'], createdAt: 'bad' }), JSON.stringify({ requestId: 'r', tenantId: 'company-B', userId: 'u', kind: 'delete', ids: ['x'], createdAt: new Date().toISOString() })]) {
    const storage = memoryStorage(); storage.setItem(key, raw)
    assert.throws(() => readPendingLeadMutation(storage, key, 'company-A'), fails('rejected'))
    await assert.rejects(withLeadMutationReservation(reservation({ storage, work: async () => assert.fail('no dispatch') })), fails('rejected'))
    assert.equal(storage.getItem(key), raw)
  }
})
test('reservation metadata rejects before lock or work', async () => {
  for (const extra of [{ userId: '' }, { requestId: '' }, { tenantId: '' }, { ids: ['x', 'x'] }, { kind: 'status' }]) {
    await assert.rejects(withLeadMutationReservation(reservation({ ...extra, locks: { request: () => assert.fail('no lock') } })), fails('rejected'))
  }
})
test('settled failures clear only their own marker; unknown failures retain it', async () => {
  const key = pendingLeadMutationKey('company-A')
  for (const error of [new MutationFailure('known', 'rejected', true), new MutationFailure('stale', 'stale', true), new MutationFailure('pending', 'uncertain'), new MutationFailure('stale', 'stale'), Error('unknown')]) {
    const storage = memoryStorage()
    await assert.rejects(withLeadMutationReservation(reservation({ storage, work: async () => { throw error } })), e => e === error)
    assert.equal(storage.getItem(key) === null, error.settled === true)
  }
  const storage = memoryStorage()
  assert.equal(await withLeadMutationReservation(reservation({ storage, work: async () => {
    const marker = readPendingLeadMutation(storage, key, 'company-A')
    storage.setItem(key, JSON.stringify({ ...marker, requestId: 'another' }))
    return 42
  } })), 42)
  assert.equal(readPendingLeadMutation(storage, key, 'company-A').requestId, 'another')
})
test('cleanup failure preserves successful result and durable block', async () => {
  const base = memoryStorage(), storage = { ...base, removeItem: () => { throw Error('SECRET') } }
  assert.equal(await withLeadMutationReservation(reservation({ storage })), 42)
  assert.ok(readPendingLeadMutation(storage, pendingLeadMutationKey('company-A'), 'company-A'))
  await assert.rejects(withLeadMutationReservation(reservation({ storage, work: async () => assert.fail('no dispatch') })), fails('rejected'))
})
test('settled tracks proof, not merely stale context', async () => {
  assert.equal(new MutationFailure('default', 'rejected').settled, false)
  await assert.rejects(mutateLeadRecords(options({ ids: [] })), e => e.settled === true)
  await assert.rejects(mutateLeadRecords(options({ isCurrent: () => false })), e => e.outcome === 'stale' && e.settled === true)
  for (const [response, settled] of [[{ data: rows(), error: null }, true], [{ data: null, error: { code: '42501' } }, true], [{ data: [], error: null }, false], [{ data: [{ ...rows()[0], tenant_id: 'foreign' }], error: null }, false], [{ data: null, error: { code: '503' } }, false]]) {
    let active = true
    await assert.rejects(mutateLeadRecords(options({ isCurrent: () => active, execute: async () => { active = false; return response } })), e => e.outcome === 'stale' && e.settled === settled)
  }
  let active = true
  await assert.rejects(mutateLeadRecords(options({ isCurrent: () => active, execute: async () => { active = false; throw Error('SECRET') } })), e => e.outcome === 'stale' && e.settled === false)
})
test('deadline retains marker after late success across a reopened reservation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const storage = memoryStorage(); let release
  const operation = withLeadMutationReservation(reservation({ storage, work: () => mutateLeadRecords(options({ execute: () => new Promise(resolve => { release = resolve }) })) }))
  const rejected = assert.rejects(operation, e => e.outcome === 'uncertain' && e.settled === false)
  await Promise.resolve(); t.mock.timers.tick(45_001); await rejected
  release({ data: rows(), error: null }); await Promise.resolve()
  assert.ok(readPendingLeadMutation(storage, pendingLeadMutationKey('company-A'), 'company-A'))
  await assert.rejects(withLeadMutationReservation(reservation({ storage, work: async () => assert.fail('must not retry') })), fails('rejected'))
})
