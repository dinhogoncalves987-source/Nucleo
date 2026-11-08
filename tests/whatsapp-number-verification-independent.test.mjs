// Independent synthetic-only contract review. No sockets, real numbers, services or credentials.
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { createRequire, Module } from 'node:module'
import core from '../shared/whatsapp-number-verification.cjs'

globalThis.fetch = async () => { assert.fail('Independent review prohibits all network') }
const root = fileURLToPath(new URL('../', import.meta.url))
const hash = relative => createHash('sha256').update(readFileSync(path.join(root, relative))).digest('hex')
const reviewed = ['shared/whatsapp-number-verification.cjs', 'shared/whatsapp-number-verification.d.cts']
const sourceHashes = Object.fromEntries(reviewed.map(file => [file, hash(file)]))
// This is a current-code contract test, not an immutable snapshot of a past phase.
// Keep the public product path inventory versioned, and detect any product mutation
// during the suite. Historical evidence and workstation caches are not CI inputs.
const protectedPaths = JSON.parse(readFileSync(new URL('./fixtures/whatsapp-protected-product-paths.json', import.meta.url), 'utf8'))
assert.equal(new Set(protectedPaths).size, protectedPaths.length, 'Protected paths must be unique')
for (const file of protectedPaths) assert.match(file, /^(?:api|backend|server-handlers|shared|src|supabase)\/[\w./[\]-]+$|^package(?:-lock)?\.json$/)
const protectedBefore = protectedPaths.map(file => ({ path: file, sha256: hash(file) }))
const BASE = Date.parse('2026-11-08T12:00:00.000Z')
const iso = millis => new Date(millis).toISOString()
const IDs = {
  actor: '11111111-1111-4111-8111-111111111111', actor2: '22222222-2222-4222-8222-222222222222',
  tenant: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', tenant2: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  session: '33333333-3333-4333-8333-333333333333', session2: '44444444-4444-4444-8444-444444444444',
  channel: '55555555-5555-4555-8555-555555555555', channel2: '66666666-6666-4666-8666-666666666666',
  transport: '77777777-7777-4777-8777-777777777777', transport2: '88888888-8888-4888-8888-888888888888'
}
const PHONE = '+5541987654321', PHONE2 = '+5541987654322'
const identity = extra => ({ userId: IDs.actor, tenantId: IDs.tenant, sessionId: IDs.session, appRole: 'operator', expiresAt: iso(BASE + 120000), isAnonymous: false, ...extra })
const request = extra => ({ request_id: randomUUID(), expected_tenant_id: IDs.tenant, expected_actor_id: IDs.actor, expected_session_id: IDs.session, expected_channel_id: IDs.channel, phone: PHONE, authorize_number_query: true, ...extra })
const grant = (q, extra) => { const { appRole, ...scope } = q; void appRole; return { ...scope, transportSessionId: IDs.transport, transportEpoch: 1, expiresAt: iso(BASE + 60000), allowed: true, connected: true, ownershipVerified: true, ...extra } }
const provider = (phone = PHONE, exists = true) => [{ exists, jid: phone.slice(1) + '@s.whatsapp.net' }]
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const turn = () => new Promise(resolve => setImmediate(resolve))
function fixture(options = {}) {
  const f = { authorization: [], lookup: [], logs: [], bindings: 0, binding: { tenantId: IDs.tenant, channelId: IDs.channel, transportSessionId: IDs.transport, transportEpoch: 1, connected: true } }
  f.adapter = (options.factory || core.createWhatsappNumberVerification)({
    enabled: true, mode: 'synthetic', now: () => new Date(BASE), timeoutMs: 1000,
    authorizeQuery: async (q, o) => { f.authorization.push({ q, o }); return options.authorize ? options.authorize(q, o, f.authorization.length) : grant(q) },
    transport: { mode: 'synthetic', getBinding: () => { f.bindings++; return options.binding ? options.binding(f.bindings) : f.binding }, onWhatsApp: (...args) => { f.lookup.push(args); return options.lookup ? options.lookup(...args) : provider('+' + args[0]) } },
    ...options.config
  })
  f.send = (body = request(), auth = identity()) => f.adapter.verify({ body, auth })
  return f
}
async function rejected(operation, code, status) {
  let caught
  try { await operation } catch (error) { caught = error }
  assert.ok(caught instanceof core.WhatsappVerificationError, 'Expected a sanitized verification error')
  if (code) assert.equal(caught.code, code)
  if (status) assert.equal(caught.status, status)
  assert.equal(caught.message, caught.code)
  assert.ok(!JSON.stringify(caught).includes('PRIVATE_SENTINEL'), 'Raw callback details must not escape')
  return caught
}
function guarded(result) {
  assert.equal(result.synthetic, true)
  assert.deepEqual(result.state, { whatsapp: 'unknown', activity: 'unknown', number_ownership: 'unverified', consent: 'not_established', contact_permission: 'not_established' })
  for (const key of ['canContact', 'canSend', 'canEnqueue', 'canMarkLeadVerified']) assert.equal(result[key], false)
  assert.equal(result.source.kind, 'synthetic_transport_fixture')
  assert.equal(result.source.origin, 'existing_gateway_onWhatsApp_contract')
  assert.equal(result.source.method, 'onWhatsApp')
  assert.equal(result.source.source_observed_at, null)
  assert.equal(result.source.received_at, iso(BASE))
  assert.ok(!('jid' in result) && !('raw' in result) && !('transportSessionId' in result))
  assert.ok(!JSON.stringify(result).includes('PRIVATE_SENTINEL'))
  for (const object of [result, result.source, result.state, result.limitations]) assert.ok(Object.isFrozen(object))
}

test('independent: factory exports only the preparatory surface; default and real modes fail closed', async t => {
  assert.deepEqual(Object.keys(core).sort(), ['WhatsappVerificationError', 'createWhatsappNumberVerification'])
  const cases = [{}, { enabled: true }, { enabled: true, mode: 'production' }, { enabled: true, mode: 'real' }, { enabled: 'true', mode: 'synthetic' }, { enabled: true, mode: 'synthetic' }]
  for (const [i, config] of cases.entries()) await t.test('disabled configuration ' + i, async () => {
    let called = 0
    const f = core.createWhatsappNumberVerification({ ...config, authorizeQuery: config.mode === 'synthetic' && config.enabled === true ? undefined : () => { called++; }, transport: { mode: 'synthetic', onWhatsApp: () => { called++ } } })
    const caps = f.capabilities()
    assert.equal(caps.enabled, false); assert.equal(caps.production_ready, false)
    assert.equal(caps.mode, 'synthetic_only'); assert.equal(caps.requires_query_authorization, true)
    await rejected(f.verify({ auth: identity(), body: request() }), caps.reason, 503)
    assert.equal(called, 0)
  })
  for (const mode of ['real', 'production', undefined]) {
    let called = 0
    const f = core.createWhatsappNumberVerification({ enabled: true, mode: 'synthetic', authorizeQuery: () => { called++ }, transport: { mode, onWhatsApp: () => { called++ } } })
    await rejected(f.verify({ auth: identity(), body: request() }), 'synthetic_dependencies_required', 503)
    assert.equal(called, 0)
  }
})

test('independent: configuration bounds cannot silently weaken the deadline', () => {
  for (const timeoutMs of [0, -1, 8001, 1.5, NaN, Infinity, '1', null]) assert.throws(() => core.createWhatsappNumberVerification({ timeoutMs }), /verification_configuration_invalid/)
  assert.throws(() => core.createWhatsappNumberVerification({ now: 1 }), /verification_configuration_invalid/)
})

test('independent: trusted identity must be complete, nonanonymous and current before any callback', async t => {
  const invalid = [null, {}, [], identity({ isAnonymous: true }), identity({ isAnonymous: undefined }), identity({ userId: '' }), identity({ userId: IDs.actor.toUpperCase() }), identity({ tenantId: '' }), identity({ sessionId: '' }), identity({ appRole: 'viewer' }), identity({ expiresAt: iso(BASE) }), identity({ expiresAt: '2026-02-30T12:00:00.000Z' }), identity({ expiresAt: '2026-11-08T12:00:01Z' }), identity({ extra: true })]
  // The actor fixture has numeric digits only; uppercase must use a genuinely alphabetic UUID.
  invalid[6] = identity({ userId: IDs.tenant.toUpperCase() })
  for (const [i, auth] of invalid.entries()) await t.test('identity ' + i, async () => {
    const f = fixture(); await rejected(f.send(request(), auth))
    assert.equal(f.authorization.length, 0); assert.equal(f.lookup.length, 0)
  })
  for (const appRole of ['superadmin', 'manager', 'operator']) {
    const f = fixture(); guarded(await f.send(request(), identity({ appRole })))
  }
})

test('independent: request must bind explicit actor, tenant, session, channel and one canonical phone', async t => {
  const bad = [null, [], {}, request({ expected_tenant_id: IDs.tenant2 }), request({ expected_actor_id: IDs.actor2 }), request({ expected_session_id: IDs.session2 }), request({ expected_channel_id: '' }), request({ request_id: 'request' }), request({ authorize_number_query: false }), request({ authorize_number_query: 1 }), request({ phone: undefined }), request({ tenant_id: IDs.tenant })]
  for (const [i, body] of bad.entries()) await t.test('scope ' + i, async () => {
    const f = fixture(); await rejected(f.send(body))
    assert.equal(f.authorization.length, 0); assert.equal(f.lookup.length, 0)
  })
  const phones = ['41987654321', '5541987654321', '+55 (41) 98765-4321', PHONE + ' ', ' ' + PHONE, PHONE + '\n', PHONE + ';ext=1', PHONE + '@s.whatsapp.net', '+5510987654321', '+5523987654321', '+5541887654321', '+5541999999999', '+141987654321', null, 5541987654321]
  for (const [i, phone] of phones.entries()) await t.test('noncanonical phone ' + i, async () => {
    const f = fixture(); await rejected(f.send(request({ phone })), 'invalid_phone', 400)
    assert.equal(f.authorization.length, 0); assert.equal(f.lookup.length, 0)
  })
})

test('independent: input properties are snapshotted without executing accessors', async () => {
  for (const target of ['auth', 'body']) {
    let reads = 0
    const input = { auth: identity(), body: request() }
    Object.defineProperty(input[target], target === 'auth' ? 'userId' : 'phone', { get() { reads++; return PHONE }, enumerable: true })
    const f = fixture(); await rejected(f.adapter.verify(input))
    assert.equal(reads, 0); assert.equal(f.authorization.length, 0); assert.equal(f.lookup.length, 0)
  }
})

test('independent: callback receives a detached frozen scope, and Baileys gets exactly one string argument', async () => {
  const wait = defer(), seen = defer(), body = request(), auth = identity()
  const f = fixture({ authorize: async (q, o, n) => { assert.ok(Object.isFrozen(q)); assert.ok(o.signal instanceof AbortSignal); if (n === 1) { seen.resolve(); await wait.promise } return grant(q) } })
  const resultPromise = f.send(body, auth); await seen.promise
  body.phone = PHONE2; body.request_id = randomUUID(); body.expected_actor_id = IDs.actor2
  auth.userId = IDs.actor2; auth.tenantId = IDs.tenant2
  wait.resolve(); const result = await resultPromise
  assert.equal(result.phone, PHONE); assert.equal(result.actor_id, IDs.actor); assert.equal(result.tenant_id, IDs.tenant)
  assert.deepEqual(f.lookup, [[PHONE.slice(1)]])
  assert.equal(f.authorization.length, 2); assert.deepEqual(f.authorization[0].q, f.authorization[1].q)
  guarded(result)
})

test('independent: grant ownership and exact scope are mandatory before dispatch', async t => {
  const changes = [{ requestId: randomUUID() }, { phone: PHONE2 }, { tenantId: IDs.tenant2 }, { actorId: IDs.actor2 }, { authSessionId: IDs.session2 }, { channelId: IDs.channel2 }, { allowed: false }, { connected: false }, { ownershipVerified: false }, { transportSessionId: '' }, { transportEpoch: 0 }, { transportEpoch: 1.5 }, { expiresAt: iso(BASE) }, { appRole: 'operator' }]
  for (const [i, patch] of changes.entries()) await t.test('grant ' + i, async () => {
    const f = fixture({ authorize: q => grant(q, patch) }); await rejected(f.send())
    assert.equal(f.authorization.length, 1); assert.equal(f.lookup.length, 0)
  })
  let getterCalls = 0
  const f = fixture({ authorize: q => { const g = grant(q); Object.defineProperty(g, 'phone', { get() { getterCalls++; return PHONE } }); return g } })
  await rejected(f.send(), 'query_authorization_invalid', 403); assert.equal(f.lookup.length, 0); assert.equal(getterCalls, 0)
})

test('independent: granted and denied observations remain synthetic unknown state with no contact permission', async () => {
  for (const [raw, expected] of [[provider(), 'registered_reported'], [provider(PHONE, false), 'not_registered_reported'], [[], 'unknown']]) {
    const f = fixture({ lookup: () => raw }); const result = await f.send()
    assert.equal(result.observation, expected); guarded(result)
    assert.equal(f.lookup.length, 1); assert.equal(f.authorization.length, 2)
    assert.throws(() => { result.state.contact_permission = 'approved' }, TypeError)
    assert.throws(() => { result.source.received_at = '2030-01-01' }, TypeError)
    assert.throws(() => result.limitations.push('approved'), TypeError)
  }
  const landline = '+554133334444', f = fixture()
  const result = await f.send(request({ phone: landline }))
  assert.equal(result.phone, landline); assert.deepEqual(f.lookup, [[landline.slice(1)]]); guarded(result)
})

test('independent: malformed, ambiguous and mismatched responses are errors, never negative presence', async t => {
  const bad = [undefined, null, {}, false, '', { data: provider() }, [undefined], [{}], [{ exists: true }], [{ jid: PHONE.slice(1) + '@s.whatsapp.net' }], [{ exists: 'false', jid: PHONE.slice(1) + '@s.whatsapp.net' }], provider(PHONE2), [{ exists: true, jid: '554187654321@s.whatsapp.net' }], [{ exists: true, jid: PHONE.slice(1) + '@lid' }], [...provider(), ...provider()], [...provider(), ...provider(PHONE, false)], [{ ...provider()[0], name: 'PRIVATE_SENTINEL' }], [{ ...provider()[0], lid: 'PRIVATE_SENTINEL' }], Object.assign([], { extra: 'PRIVATE_SENTINEL' }), new Array(1)]
  for (const [i, raw] of bad.entries()) await t.test('response ' + i, async () => {
    const f = fixture({ lookup: () => raw }); const body = request()
    await rejected(f.send(body), 'verification_response_invalid', 502)
    assert.equal(f.lookup.length, 1); assert.equal(f.authorization.length, 1)
    await rejected(f.send(body), 'verification_request_replayed', 409)
    await rejected(f.send(request()), 'number_query_already_attempted', 409)
    assert.equal(f.lookup.length, 1)
  })
})

test('independent: ordinary authorization/transport failures are sanitized and leave tombstones', async () => {
  for (const stage of ['authorization', 'lookup', 'revalidation']) {
    const f = fixture({
      authorize: (q, o, n) => { if (stage === 'authorization' || (stage === 'revalidation' && n === 2)) throw new Error('PRIVATE_SENTINEL token=not-a-real-secret'); return grant(q) },
      lookup: () => { if (stage === 'lookup') throw new Error('PRIVATE_SENTINEL raw-jid'); return provider() }
    })
    const body = request()
    await rejected(f.send(body), stage === 'lookup' ? 'verification_transport_failed' : 'verification_authorization_unavailable', stage === 'lookup' ? 502 : 503)
    await rejected(f.send(body), 'verification_request_replayed', 409)
    const calls = f.lookup.length
    await rejected(f.send(request()), 'number_query_already_attempted', 409)
    assert.equal(f.lookup.length, calls)
  }
})

test('independent: every grant field is rechecked after response, including transport ABA epoch', async t => {
  const changes = [{ requestId: randomUUID() }, { phone: PHONE2 }, { tenantId: IDs.tenant2 }, { actorId: IDs.actor2 }, { authSessionId: IDs.session2 }, { channelId: IDs.channel2 }, { allowed: false }, { connected: false }, { ownershipVerified: false }, { transportSessionId: IDs.transport2 }, { transportEpoch: 3 }, { expiresAt: iso(BASE + 50000) }, { expiresAt: iso(BASE) }]
  for (const [i, patch] of changes.entries()) await t.test('revocation or rebinding ' + i, async () => {
    const f = fixture({ authorize: (q, o, n) => grant(q, n === 2 ? patch : {}) })
    await rejected(f.send()); assert.equal(f.lookup.length, 1); assert.equal(f.authorization.length, 2)
  })
})

test('independent: mutable grants cannot rewrite the first authorization snapshot', async () => {
  let shared
  const f = fixture({ authorize: (q, o, n) => { if (n === 1) { shared = grant(q); return shared } return grant(q, { transportEpoch: 2 }) }, lookup: () => { shared.transportEpoch = 2; return provider() } })
  await rejected(f.send(), 'authorization_changed', 409); assert.equal(f.lookup.length, 1)
})

test('independent: auth expiry before dispatch and after response never returns a successful receipt', async () => {
  let calls = 0
  const f = fixture({ config: { now: () => new Date(++calls >= 3 ? BASE + 120001 : BASE) } })
  await rejected(f.send(), 'authentication_required', 401); assert.equal(f.lookup.length, 0)
  const late = fixture({ lookup: () => { calls = 100; return provider() }, config: { now: () => new Date(calls === 100 ? BASE + 120001 : BASE) } })
  calls = 0
  await rejected(late.send()); assert.equal(late.lookup.length, 1)
})

test('independent: grant expiry between initial validation and dispatch blocks the actual query', async () => {
  let clockCalls = 0
  const f = fixture({
    authorize: q => grant(q, { expiresAt: iso(BASE + 500) }),
    config: { now: () => new Date(++clockCalls >= 3 ? BASE + 1000 : BASE) }
  })
  await rejected(f.send(), 'transport_binding_invalid', 403)
  assert.equal(f.lookup.length, 0, 'An expired grant must not reach onWhatsApp')
})

test('independent: same request and same tenant-number cannot be replayed through actor/session/channel changes', async () => {
  const f = fixture(), body = request()
  const receipt = await f.send(body)
  await rejected(f.send(body), 'verification_request_replayed', 409)
  await rejected(f.send({ ...body, phone: PHONE2 }), 'verification_request_conflict', 409)
  for (const change of [
    { body: request({ expected_actor_id: IDs.actor2 }), auth: identity({ userId: IDs.actor2 }) },
    { body: request({ expected_session_id: IDs.session2 }), auth: identity({ sessionId: IDs.session2 }) },
    { body: request({ expected_channel_id: IDs.channel2 }), auth: identity() }
  ]) await rejected(f.send(change.body, change.auth), 'number_query_already_attempted', 409)
  assert.equal(f.lookup.length, 1)
  assert.equal(receipt.actor_id, IDs.actor)
  f.binding.tenantId = IDs.tenant2
  const other = await f.send(request({ expected_tenant_id: IDs.tenant2 }), identity({ tenantId: IDs.tenant2 }))
  assert.equal(other.tenant_id, IDs.tenant2); assert.equal(f.lookup.length, 2)
})

test('independent: reservations happen before async authorization; concurrent and divergent repeats cannot dispatch', async () => {
  const wait = defer(), seen = defer()
  const f = fixture({ authorize: async (q, o, n) => { if (n === 1) { seen.resolve(); await wait.promise } return grant(q) } })
  const body = request(), pending = f.send(body); await seen.promise
  await rejected(f.send(body), 'verification_request_replayed', 409)
  await rejected(f.send({ ...body, phone: PHONE2 }), 'verification_request_conflict', 409)
  await rejected(f.send(request()), 'number_query_already_attempted', 409)
  await rejected(f.send(request({ phone: PHONE2 })), 'verification_busy', 409)
  assert.equal(f.lookup.length, 0)
  wait.resolve(); guarded(await pending); assert.equal(f.lookup.length, 1)
  guarded(await f.send(request({ phone: PHONE2 }))); assert.equal(f.lookup.length, 2)
})

test('independent: authorization timeout performs no lookup and ignores late authorization', async () => {
  const wait = defer(), seen = defer()
  const f = fixture({ authorize: async q => { seen.resolve(); await wait.promise; return grant(q) }, config: { timeoutMs: 15 } })
  const body = request(), pending = f.send(body); await seen.promise
  await rejected(pending, 'verification_timeout', 504)
  assert.equal(f.lookup.length, 0); assert.equal(f.authorization[0].o.signal.aborted, true)
  wait.resolve(); await turn(); await turn()
  assert.equal(f.lookup.length, 0)
  await rejected(f.send(body), 'verification_request_replayed', 409)
  await rejected(f.send(request()), 'number_query_already_attempted', 409)
})

test('independent: lookup timeout cannot cancel Baileys and suppresses all queries while lookup remains in flight', async () => {
  const wait = defer(), seen = defer()
  const f = fixture({ lookup: () => { seen.resolve(); return wait.promise }, config: { timeoutMs: 15 } })
  const body = request(), pending = f.send(body); await seen.promise
  const start = Date.now()
  await rejected(pending, 'verification_timeout', 504)
  assert.ok(Date.now() - start >= 8, 'Real timer must fire rather than resolve synchronously')
  await rejected(f.send(body), 'verification_request_replayed', 409)
  await rejected(f.send(request()), 'number_query_already_attempted', 409)
  await rejected(f.send(request({ phone: PHONE2 })), 'verification_busy', 409)
  assert.equal(f.lookup.length, 1); assert.equal(f.authorization.length, 1)
  wait.resolve(provider()); await turn(); await turn()
  assert.equal(f.authorization.length, 1, 'Late lookup must not reach revalidation or return a late receipt')
  await rejected(f.send(request()), 'number_query_already_attempted', 409)
  await rejected(f.send(request({ phone: PHONE2 })), 'verification_response_invalid', 502)
  assert.equal(f.lookup.length, 2)
})

test('independent: post-query authorization timeout discards otherwise valid observation', async () => {
  const wait = defer()
  const f = fixture({ authorize: async (q, o, n) => { if (n === 2) await wait.promise; return grant(q) }, config: { timeoutMs: 15 } })
  const body = request()
  await rejected(f.send(body), 'verification_timeout', 504)
  assert.equal(f.lookup.length, 1)
  wait.resolve(); await turn()
  await rejected(f.send(body), 'verification_request_replayed', 409)
  await rejected(f.send(request()), 'number_query_already_attempted', 409)
})

test('independent: the bounded ledger does not evict old attempts when it reaches capacity', async () => {
  const f = fixture()
  const first = request({ phone: '+5541999000001' })
  await f.send(first)
  for (let i = 2; i <= 128; i++) await f.send(request({ phone: '+5541' + (999000000 + i) }))
  assert.equal(f.lookup.length, 128)
  await rejected(f.send(request({ phone: '+5541999000129' })), 'verification_capacity_reached', 429)
  await rejected(f.send(first), 'verification_request_replayed', 409)
  await rejected(f.send(request({ phone: first.phone })), 'number_query_already_attempted', 409)
  assert.equal(f.lookup.length, 128)
})

test('independent: invalid or backwards clocks fail closed without inventing a received timestamp', async () => {
  for (const now of [() => '2026-11-08', () => new Date(NaN), () => new Date(-1), () => { throw new Error('PRIVATE_SENTINEL') }]) {
    const f = fixture({ config: { now } }); await rejected(f.send(), 'verification_clock_invalid', 503); assert.equal(f.lookup.length, 0)
  }
  let count = 0
  const f = fixture({ config: { now: () => new Date(++count === 1 ? BASE : BASE - 1) } })
  await rejected(f.send(), 'verification_clock_invalid', 503); assert.equal(f.lookup.length, 0)
})


test('independent: self-attested ownership cannot substitute for a matching transport binding', async t => {
  const binding = extra => ({ tenantId: IDs.tenant, channelId: IDs.channel, transportSessionId: IDs.transport, transportEpoch: 1, connected: true, ...extra })
  for (const [i, patch] of [{ tenantId: IDs.tenant2 }, { channelId: IDs.channel2 }, { transportSessionId: IDs.transport2 }, { transportEpoch: 3 }, { connected: false }].entries()) {
    await t.test('binding mismatch ' + i, async () => {
      const f = fixture({ binding: () => binding(patch) })
      await rejected(f.send(), 'transport_binding_mismatch', 403)
      assert.equal(f.lookup.length, 0); assert.equal(f.authorization.length, 1)
    })
    await t.test('binding changed after response ' + i, async () => {
      const f = fixture({ binding: n => binding(n === 2 ? patch : {}) })
      await rejected(f.send(), 'transport_binding_mismatch', 403)
      assert.equal(f.lookup.length, 1); assert.equal(f.authorization.length, 2)
    })
  }
  for (const raw of [null, {}, { ...binding(), extra: true }, Promise.resolve(binding())]) {
    const f = fixture({ binding: () => raw })
    await rejected(f.send(), 'transport_binding_invalid', 403); assert.equal(f.lookup.length, 0)
  }
  const unavailable = fixture({ binding: () => { throw new Error('PRIVATE_SENTINEL') } })
  await rejected(unavailable.send(), 'transport_binding_unavailable', 503); assert.equal(unavailable.lookup.length, 0)
})

test('independent: typed callback errors do not gain internal trust or leak arbitrary provider content', async () => {
  for (const stage of ['authorization', 'lookup', 'revalidation']) {
    const f = fixture({
      authorize: (q, o, n) => { if (stage === 'authorization' || (stage === 'revalidation' && n === 2)) throw new core.WhatsappVerificationError(599, 'PRIVATE_SENTINEL'); return grant(q) },
      lookup: () => { if (stage === 'lookup') throw new core.WhatsappVerificationError(599, 'PRIVATE_SENTINEL'); return provider() }
    })
    await rejected(f.send(), stage === 'lookup' ? 'verification_transport_failed' : 'verification_authorization_unavailable')
  }
})

test('independent: array accessors are not invoked while validating the transport response', async () => {
  let invoked = 0
  const raw = [null]
  Object.defineProperty(raw, '0', { enumerable: true, get() { invoked++; return provider()[0] } })
  const f = fixture({ lookup: () => raw })
  await rejected(f.send(), 'verification_response_invalid', 502)
  assert.equal(invoked, 0)
})

test('independent: current consumers do not import the preparatory module and product files stay unchanged during this run', () => {
  assert.equal(protectedBefore.length, 154)
  for (const entry of protectedBefore) {
    assert.equal(hash(entry.path), entry.sha256, 'Protected source changed: ' + entry.path)
    if (/\.(?:ts|tsx|js|cjs|mjs)$/.test(entry.path)) assert.ok(!readFileSync(path.join(root, entry.path), 'utf8').includes('whatsapp-number-verification'), 'Existing consumer imports preparatory module: ' + entry.path)
  }
  assert.ok(protectedBefore.some(file => file.path === 'src/pages/Leads.tsx'))
  assert.ok(protectedBefore.some(file => file.path === 'backend/src/chips.ts'))
  assert.ok(protectedBefore.some(file => file.path === 'backend/src/conversation-app.cjs'))
})

after(() => {
  for (const file of reviewed) assert.equal(hash(file), sourceHashes[file], 'Reviewed source changed during independent run: ' + file)
  for (const entry of protectedBefore) assert.equal(hash(entry.path), entry.sha256, 'Protected source changed during independent run: ' + entry.path)
})

test('independent: in-memory negative controls demonstrate that decisive guards are actually exercised', async t => {
  const source = readFileSync(path.join(root, reviewed[0]), 'utf8')
  const compile = (before, replacement) => {
    assert.equal(source.split(before).length, 2, 'Mutation target must occur exactly once')
    const module = new Module(path.join(root, 'tests/whatsapp-verification-in-memory-control.cjs'))
    module.require = name => { assert.equal(name, 'node:crypto'); return createRequire(import.meta.url)(name) }
    module._compile(source.replace(before, replacement), module.id)
    return module.exports
  }
  await t.test('removing pre-dispatch binding allows one forbidden lookup', async () => {
    const mutant = compile('requireBinding(first);', '// negative control: first binding check removed')
    const f = fixture({ factory: mutant.createWhatsappNumberVerification, binding: () => ({ tenantId: IDs.tenant2, channelId: IDs.channel, transportSessionId: IDs.transport, transportEpoch: 1, connected: true }) })
    const error = await f.send().catch(e => e)
    assert.equal(error.code, 'transport_binding_mismatch'); assert.equal(f.lookup.length, 1)
    assert.throws(() => assert.equal(f.lookup.length, 0), /1 !== 0/)
  })
  await t.test('removing grant freshness allows expired dispatch', async () => {
    const mutant = compile("if (timestamp(first.expiresAt) <= dispatchTime) fail(403, 'transport_binding_invalid');", '// negative control: grant freshness check removed')
    let calls = 0
    const f = fixture({ factory: mutant.createWhatsappNumberVerification, authorize: q => grant(q, { expiresAt: iso(BASE + 500) }), config: { now: () => new Date(++calls >= 3 ? BASE + 1000 : BASE) } })
    const error = await f.send().catch(e => e)
    assert.equal(error.code, 'transport_binding_invalid'); assert.equal(f.lookup.length, 1)
    assert.throws(() => assert.equal(f.lookup.length, 0), /1 !== 0/)
  })
  await t.test('trusting public error class leaks an injected error', async () => {
    const mutant = compile('if (internalErrors.has(error)) throw error;', 'if (error instanceof WhatsappVerificationError) throw error;')
    const f = fixture({ factory: mutant.createWhatsappNumberVerification, authorize: () => { throw new mutant.WhatsappVerificationError(599, 'PRIVATE_SENTINEL') } })
    const error = await f.send().catch(e => e)
    assert.equal(error.code, 'PRIVATE_SENTINEL')
    assert.throws(() => assert.ok(!JSON.stringify(error).includes('PRIVATE_SENTINEL')), /false == true|falsy/)
  })
  await t.test('interpreting an empty list as absence changes the accepted semantics', async () => {
    const mutant = compile("if (raw.length === 0) return 'unknown';", "if (raw.length === 0) return 'not_registered_reported';")
    const f = fixture({ factory: mutant.createWhatsappNumberVerification, lookup: () => [] })
    const result = await f.send()
    assert.equal(result.observation, 'not_registered_reported')
    assert.throws(() => assert.equal(result.observation, 'unknown'), /not_registered_reported/)
  })
})
