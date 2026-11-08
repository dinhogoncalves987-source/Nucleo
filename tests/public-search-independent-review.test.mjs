// Independent adversarial review. Synthetic fixtures only, no network or app startup.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, Module } from 'node:module'
import { randomUUID, createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import core from '../shared/public-search.cjs'
import bridge from '../backend/src/public-search-bridge.cjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const reviewFiles = ['shared/public-search.cjs', 'shared/public-search.d.cts', 'backend/src/public-search-bridge.cjs', 'backend/src/auth/jwt-auth.ts', 'backend/src/auth/tenant-context.ts', 'backend/src/search.ts', 'src/lib/public-search-client.ts', 'src/components/PublicLeadSearchPanel.tsx']
const hash = filename => createHash('sha256').update(readFileSync(path.join(root, filename))).digest('hex')
const reviewHashes = new Map(reviewFiles.map(filename => [filename, hash(filename)]))
// Existing packages only; never installs dependencies.
const originalBase = path.resolve(process.env.NUCLEO_TEST_DEPS_ROOT || root)
for (const lock of ['package-lock.json', 'backend/package-lock.json']) {
  assert.deepEqual(readFileSync(path.join(root, lock)), readFileSync(path.join(originalBase, lock)), 'Dependency lock must be identical: ' + lock)
}
const deps = createRequire(path.join(originalBase, 'backend/package.json'))
const ts = deps('typescript')
const express = deps('express')
const allowedSources = new Set(['backend/src/search.ts', 'backend/src/public-search.ts', 'backend/src/auth/jwt-auth.ts', 'backend/src/auth/tenant-context.ts', 'src/lib/public-search-client.ts'].map(name => path.resolve(root, name)))
const cache = new Map()
function load(filename) {
  filename = path.resolve(filename)
  assert.ok(allowedSources.has(filename), 'Unapproved source module: ' + filename)
  if (cache.has(filename)) return cache.get(filename).exports
  const m = new Module(filename); m.filename = filename; cache.set(filename, m)
  m.require = name => {
    if (name === '../../shared/public-search.cjs') return core
    if (name.startsWith('.')) return load(path.resolve(path.dirname(filename), name + '.ts'))
    assert.ok(['express', 'axios'].includes(name), 'Unapproved dependency: ' + name)
    return deps(name)
  }
  m._compile(ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename)
  return m.exports
}
const { createSearchRouter } = load(path.join(root, 'backend/src/search.ts'))
const { createSupabaseJwtAuth } = load(path.join(root, 'backend/src/auth/jwt-auth.ts'))
const { createTenantContext } = load(path.join(root, 'backend/src/auth/tenant-context.ts'))
const client = load(path.join(root, 'src/lib/public-search-client.ts'))
const appFile = path.join(root, 'backend/src/conversation-app.cjs')
const appModule = new Module(appFile)
appModule.require = name => ['express', 'cors'].includes(name) ? deps(name) : createRequire(appFile)(name)
appModule._compile(readFileSync(appFile, 'utf8'), appFile)
const { createConversationApp } = appModule.exports
globalThis.fetch = async () => { throw Error('Real fetch is prohibited by independent review') }

const userA = '11111111-1111-4111-8111-111111111111'
const userB = '22222222-2222-4222-8222-222222222222'
const tenantA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const tenantB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const auth = { userId: userA, tenantId: tenantA, appRole: 'operator' }
const date = () => new Date('2026-11-08T12:00:00Z')
const emptyDdg = { Heading: '', AbstractText: '', AbstractURL: '', Type: '', RelatedTopics: [], Results: [] }
const source = { Heading: 'Synthetic source', AbstractText: 'Public fixture (41) 3333-4444', AbstractURL: 'https://source.org/review' }
const environment = provider => ({ PUBLIC_SEARCH_ENABLED: 'true', PUBLIC_SEARCH_PROVIDER: provider, PUBLIC_SEARCH_DDG_COMMERCIAL_APPROVED: 'true', PUBLIC_SEARCH_GOOGLE_LEGACY_CUSTOMER: 'true', PUBLIC_SEARCH_GOOGLE_BUDGET_APPROVED: 'true', GOOGLE_API_KEY: 'synthetic', GOOGLE_SEARCH_ENGINE_ID: 'synthetic', SUPABASE_URL: 'https://auth.synthetic.invalid', SUPABASE_SERVICE_KEY: 'synthetic' })
const body = (provider = 'duckduckgo_instant_answer', extra = {}) => ({ query: 'Public synthetic search', expected_tenant_id: tenantA, expected_provider: provider, authorize_public_query: true, request_id: randomUUID(), ...extra })
function fixture({ provider = 'duckduckgo_instant_answer', data = source, transport, ledger = core.createSearchLedger() } = {}) {
  const f = { calls: 0, env: environment(provider), body: body(provider) }
  f.handlers = core.createSearchHandlers({ env: f.env, ledger, now: date, transport: async (...args) => { f.calls++; return transport ? transport(...args) : { data } } })
  f.send = async (input = f.body, identity = auth) => {
    let status = 200, output; const headers = {}
    const res = { status(n) { status = n; return this }, json(value) { output = value }, setHeader(k, v) { headers[k] = v } }
    await f.handlers.search({ body: input, auth: identity }, res)
    return { status, body: output, headers }
  }
  return f
}
function syntheticRequest(app, { method = 'POST', token = 'valid', data = body(), route = '/api/search', rawHeaders } = {}) {
  return new Promise((resolve, reject) => {
    const req = new Readable({ read() { this.push(null) } })
    Object.assign(req, { method, url: route, originalUrl: route, headers: token ? { authorization: 'Bearer ' + token } : {}, rawHeaders: rawHeaders || (token ? ['Authorization', 'Bearer ' + token] : []), body: data, _body: true, httpVersion: '1.1' })
    const res = new ServerResponse(req)
    res.end = chunk => { resolve({ status: res.statusCode, body: chunk ? JSON.parse(String(chunk)) : null, headers: res.getHeaders() }); return res }
    app.handle(req, res, reject)
  })
}
function authFixture() {
  const counts = { verify: 0, profile: 0, provider: 0 }
  const users = { valid: userA, other: userB, foreign: userA, anonymous: userA, viewer: userA, tenantless: userA }
  let activeToken
  const getProfile = () => ({ data: activeToken === 'tenantless' ? null : { tenant_id: activeToken === 'foreign' ? tenantB : tenantA, role: activeToken === 'viewer' ? 'viewer' : 'operator' }, error: null })
  const profiles = { from(table) { assert.equal(table, 'profiles'); return { select(fields) { assert.equal(fields, 'tenant_id, role'); return { eq(column, id) { assert.equal(column, 'id'); assert.ok([userA, userB].includes(id)); return { async single() { counts.profile++; return getProfile() } } } } } } } }
  const verifier = async token => { activeToken = token; counts.verify++; return token in users ? { ok: true, claims: { sub: users[token], role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 60, is_anonymous: token === 'anonymous' } } : { ok: false, reason: 'invalid' } }
  const createClient = () => ({ ...profiles, auth: { async getUser(token) { activeToken = token; counts.verify++; return token in users ? { data: { user: { id: users[token], is_anonymous: token === 'anonymous' } } } : { data: {}, error: {} } } } })
  return { counts, profiles, verifier, createClient }
}

test('independent: malformed schemas fail at handler, not successful empty results', async t => {
  const malformed = {
    duckduckgo_instant_answer: [null, [], {}, { status: 'ok' }, { Heading: 4 }, { RelatedTopics: {} }, { RelatedTopics: [null] }, { RelatedTopics: [{ Text: '', FirstURL: '' }] }, { RelatedTopics: [{ Topics: [] }] }, { RelatedTopics: [{ Topics: [{ Topics: [] }] }] }, { ...emptyDdg, Heading: 'Source', AbstractText: 'Text', Type: 'A' }, { ...emptyDdg, RelatedTopics: [{ Text: 'X' }] }, { ...emptyDdg, Results: [{ FirstURL: 'https://source.org/' }] }],
    google_cse: [null, [], {}, { items: [] }, { items: {} }, { items: [null] }, { items: [{ title: '', link: 'https://source.org/' }] }, { items: [{ title: 'X', link: '' }] }, { items: [{ title: 'X', link: 'https://source.org/', snippet: {} }] }, { searchInformation: { totalResults: 0 } }, { searchInformation: { totalResults: '3' } }, { searchInformation: { totalResults: '0' }, items: [{ title: 'X', link: 'https://source.org/' }] }]
  }
  for (const [provider, cases] of Object.entries(malformed)) for (const [i, data] of cases.entries()) await t.test(provider + ' malformed ' + i, async () => {
    const f = fixture({ provider, data }), result = await f.send()
    assert.equal(result.status, 502, JSON.stringify(data)); assert.deepEqual(result.body, { error: 'provider_response_invalid' }); assert.equal(f.calls, 1)
    assert.equal((await f.send()).body.error, 'request_outcome_uncertain'); assert.equal(f.calls, 1)
  })
})

test('independent: legitimate empties and conservative URL filtering are distinguished', async () => {
  for (const [provider, data] of [['duckduckgo_instant_answer', emptyDdg], ['google_cse', { searchInformation: { totalResults: '0' } }], ['google_cse', { searchInformation: { totalResults: '0' }, items: [] }]]) {
    const f = fixture({ provider, data }), r = await f.send(); assert.equal(r.status, 200); assert.deepEqual(r.body.results, [])
  }
  for (const [provider, data] of [['duckduckgo_instant_answer', { ...source, AbstractURL: 'http://127.0.0.1/' }], ['google_cse', { items: [{ title: 'Non-public URL fixture', link: 'http://127.0.0.1/' }] }]]) {
    const f = fixture({ provider, data }), r = await f.send(); assert.equal(r.status, 200); assert.deepEqual(r.body.results, []); assert.equal(f.calls, 1)
  }
})

test('independent: DDG Results and RelatedTopics are both represented without duplicate URLs', async () => {
  const f = fixture({ data: { ...emptyDdg, Type: 'E', Results: [{ Text: 'Real result fixture', FirstURL: 'https://source.org/result' }], RelatedTopics: [{ Text: 'Related fixture', FirstURL: 'https://source.org/related' }, { Text: 'Duplicate fixture', FirstURL: 'https://source.org/result' }] } })
  const r = await f.send(); assert.equal(r.status, 200); assert.deepEqual(new Set(r.body.results.map(row => row.url)), new Set(['https://source.org/result', 'https://source.org/related']))
  const onlyResults = fixture({ data: { ...emptyDdg, Type: 'E', Results: [{ Text: 'Real result fixture', FirstURL: 'https://source.org/result' }] } })
  assert.equal((await onlyResults.send()).body.results.length, 1)
})

test('independent: sequential replay, normalized query, divergent payload, immutable cached result', async () => {
  const f = fixture(), first = await f.send(); assert.equal(first.status, 200)
  first.body.results[0].title = 'Mutated by caller'
  const replay = await f.send({ ...f.body, query: '  Public   synthetic search  ' })
  assert.equal(replay.status, 200); assert.equal(replay.body.results[0].title, source.Heading); assert.equal(f.calls, 1)
  const conflict = await f.send({ ...f.body, query: 'Another query' })
  assert.equal(conflict.status, 409); assert.equal(conflict.body.error, 'request_id_conflict'); assert.equal(f.calls, 1)
})

test('independent: concurrent replay and divergent in-flight payload dispatch only once', async () => {
  let complete
  const f = fixture({ transport: () => new Promise(resolve => { complete = resolve }) })
  const pending = f.send()
  const same = await f.send(); assert.equal(same.status, 409); assert.equal(same.body.error, 'request_in_progress')
  const changed = await f.send({ ...f.body, query: 'Different while in flight' }); assert.equal(changed.body.error, 'request_id_conflict')
  assert.equal(f.calls, 1); complete({ data: source }); assert.equal((await pending).status, 200)
  assert.equal((await f.send()).status, 200); assert.equal(f.calls, 1)
})

test('independent: body and environment mutations during dispatch cannot change cache identity or receipt', async () => {
  let complete
  const f = fixture({ transport: () => new Promise(resolve => { complete = resolve }) })
  const original = { ...f.body }, pending = f.send()
  Object.assign(f.body, { request_id: randomUUID(), query: 'MUTATED_QUERY', expected_provider: 'google_cse', expected_tenant_id: tenantB })
  Object.assign(f.env, { PUBLIC_SEARCH_PROVIDER: 'google_cse', GOOGLE_API_KEY: 'changed' })
  complete({ data: source })
  const result = await pending
  assert.equal(result.status, 200); assert.equal(result.body.request_id, original.request_id); assert.equal(result.body.query, original.query)
  assert.equal(result.body.tenant_id, tenantA); assert.equal(result.body.provider, 'duckduckgo_instant_answer')
  Object.assign(f.env, environment('duckduckgo_instant_answer'))
  const replay = await f.send(original); assert.equal(replay.status, 200); assert.equal(replay.body.request_id, original.request_id); assert.equal(f.calls, 1)
})

test('independent: actual 8s timeout keeps uncertain tombstone after late completion', { timeout: 12000 }, async () => {
  let complete, signal
  const f = fixture({ transport: (_url, options) => { signal = options.signal; return new Promise(resolve => { complete = resolve }) } })
  const started = Date.now(), result = await f.send()
  assert.equal(result.status, 504); assert.equal(result.body.error, 'provider_timeout'); assert.equal(signal.aborted, true); assert.ok(Date.now() - started >= 7900)
  assert.equal((await f.send()).body.error, 'request_outcome_uncertain')
  complete({ data: source }); await new Promise(resolve => setImmediate(resolve))
  assert.equal((await f.send()).body.error, 'request_outcome_uncertain'); assert.equal(f.calls, 1)
})

test('independent: thrown failure never leaks provider content or silently retries', async () => {
  const f = fixture({ transport: () => { throw Error('SYNTHETIC_PRIVATE_PROVIDER_TEXT') } })
  const r = await f.send(); assert.deepEqual(r.body, { error: 'provider_request_failed' }); assert.equal(r.status, 502)
  assert.equal((await f.send()).body.error, 'request_outcome_uncertain'); assert.equal(f.calls, 1)
})

test('independent: tenant and actor isolation plus bounded ledger retains existing receipts', async () => {
  const f = fixture({ ledger: core.createSearchLedger(3) })
  assert.equal((await f.send()).status, 200)
  assert.equal((await f.send(f.body, { ...auth, userId: userB })).status, 200)
  assert.equal((await f.send({ ...f.body, expected_tenant_id: tenantB }, { ...auth, tenantId: tenantB })).status, 200)
  assert.equal(f.calls, 3)
  const over = await f.send({ ...f.body, request_id: randomUUID() }); assert.equal(over.status, 503); assert.equal(over.body.error, 'request_ledger_full')
  assert.equal((await f.send()).status, 200); assert.equal(f.calls, 3)
})

test('independent: default process ledger accepts 1000 claims, refuses 1001st and preserves replay', async () => {
  const filename = path.join(root, 'shared/public-search.cjs'), fresh = new Module(filename)
  fresh.require = name => { assert.equal(name, 'node:crypto'); return createRequire(filename)(name) }
  fresh._compile(readFileSync(filename, 'utf8'), filename)
  let calls = 0
  const options = { env: environment('duckduckgo_instant_answer'), auth, now: date, transport: async () => { calls++; return { data: source } } }
  const first = body()
  await fresh.exports.runPublicSearch({ ...options, body: first })
  for (let i = 1; i < 1000; i++) await fresh.exports.runPublicSearch({ ...options, body: body() })
  await assert.rejects(fresh.exports.runPublicSearch({ ...options, body: body() }), { status: 503, message: 'request_ledger_full' })
  const replay = await fresh.exports.runPublicSearch({ ...options, body: first })
  assert.equal(replay.request_id, first.request_id); assert.equal(calls, 1000)
})

test('independent: both actual Express mounts reject anonymous and authorization failures before profile/provider', async t => {
  for (const mode of ['legacy', 'supervised']) await t.test(mode, async () => {
    const f = authFixture(), env = environment('duckduckgo_instant_answer'); let data = source
    const transport = async () => { f.counts.provider++; return { data } }
    const app = mode === 'legacy' ? express() : createConversationApp({ env, createClient: f.createClient, now: date, fetchImpl: async () => { f.counts.provider++; return new Response(JSON.stringify(data)) } })
    if (mode === 'legacy') { app.use('/api', createSupabaseJwtAuth(f.verifier)); app.use('/api', createTenantContext(f.profiles)); app.use('/api/search', createSearchRouter({ env, transport })) }
    for (const token of [null, 'invalid', 'anonymous']) {
      for (const method of ['GET', 'POST']) {
        const beforeProfile = f.counts.profile
        const r = await syntheticRequest(app, { token, method, route: method === 'GET' ? '/api/search/capabilities' : '/api/search' })
        assert.equal(r.status, 401); assert.equal(f.counts.profile, beforeProfile); assert.equal(f.counts.provider, 0)
      }
    }
    for (const token of ['viewer', 'tenantless']) { assert.equal((await syntheticRequest(app, { token })).status, 403); assert.equal(f.counts.provider, 0) }
    assert.equal((await syntheticRequest(app, { rawHeaders: ['Authorization', 'Bearer valid', 'Authorization', 'Bearer valid'] })).status, 401)
    const payload = body()
    const success = await syntheticRequest(app, { data: payload }); assert.equal(success.status, 200); assert.equal(success.headers['cache-control'], 'no-store')
    assert.equal((await syntheticRequest(app, { data: payload })).status, 200); assert.equal(f.counts.provider, 1)
    assert.equal((await syntheticRequest(app, { token: 'anonymous', data: payload })).status, 401)
    assert.equal((await syntheticRequest(app, { token: 'viewer', data: payload })).status, 403); assert.equal(f.counts.provider, 1)
    assert.equal((await syntheticRequest(app, { data: { ...payload, query: 'Different' } })).status, 409); assert.equal(f.counts.provider, 1)
    assert.equal((await syntheticRequest(app, { data: payload, token: 'other' })).status, 200)
    assert.equal((await syntheticRequest(app, { data: { ...payload, expected_tenant_id: tenantB }, token: 'foreign' })).status, 200); assert.equal(f.counts.provider, 3)
    data = { RelatedTopics: [{ Text: '', FirstURL: '' }] }
    assert.equal((await syntheticRequest(app, { data: body() })).status, 502)
  })
})

test('independent: supervised auth timeout stops late user/profile and never queries provider', async () => {
  for (const stage of ['user', 'profile']) {
    let complete, profiles = 0, provider = 0
    const pending = new Promise(resolve => { complete = resolve })
    const user = { data: { user: { id: userA } } }, profile = { data: { tenant_id: tenantA, role: 'operator' } }
    const api = bridge.createAuthenticatedSearchBridge({ env: environment('duckduckgo_instant_answer'), authTimeoutMs: 10, now: date,
      createClient: () => ({ auth: { getUser: async () => stage === 'user' ? pending : user }, from() { profiles++; return { select() { return { eq() { return { single: async () => pending } } } } } } }),
      fetchImpl: async () => { provider++; throw Error('Must never dispatch') } })
    const result = await api.search({ headers: { authorization: 'Bearer valid' }, body: body() })
    assert.equal(result.status, 503); assert.equal(result.body.error, 'auth_unavailable')
    complete(stage === 'user' ? user : profile); await new Promise(resolve => setImmediate(resolve))
    assert.equal(provider, 0); assert.equal(profiles, stage === 'user' ? 0 : 1)
  }
})

test('independent: legacy router and supervised bridge share the default process ledger', async () => {
  const f = authFixture(), env = environment('duckduckgo_instant_answer'), payload = body()
  const app = express()
  app.use('/api', createSupabaseJwtAuth(f.verifier)); app.use('/api', createTenantContext(f.profiles))
  app.use('/api/search', createSearchRouter({ env, transport: async () => { f.counts.provider++; return { data: source } } }))
  const b = bridge.createAuthenticatedSearchBridge({ env, now: date, createClient: f.createClient, fetchImpl: async () => { f.counts.provider++; throw Error('Replay must not dispatch again') } })
  const first = await syntheticRequest(app, { data: payload }); assert.equal(first.status, 200)
  first.body.results[0].title = 'Mutated route response'
  const replay = await b.search({ headers: { authorization: 'Bearer valid' }, body: payload })
  assert.equal(replay.status, 200); assert.equal(replay.body.results[0].title, source.Heading); assert.equal(f.counts.provider, 1)
})

test('independent: client error text uses status-code allowlist, no false tenant/provider change and no retry', async () => {
  const caps = core.searchCapabilities(environment('duckduckgo_instant_answer'), auth, date)
  const cases = [[409, 'request_id_conflict'], [409, 'request_in_progress'], [409, 'request_outcome_uncertain'], [502, 'provider_response_invalid'], [503, 'request_ledger_full'], [409, 'UNKNOWN_PRIVATE_TEXT'], [409, { private: 'UNKNOWN_PRIVATE_TEXT' }], [500, 'provider_changed'], [409, undefined]]
  for (const [status, error] of cases) {
    let calls = 0
    await assert.rejects(client.submitPublicSearch({ capabilities: caps, query: 'Public synthetic search', authorized: true, requestId: randomUUID(), identity: { tenantId: tenantA, userId: userA }, isCurrent: () => true,
      transport: async () => { calls++; return new Response(error === undefined ? 'not JSON PRIVATE_TEXT' : JSON.stringify({ error }), { status }) } }), e => {
        assert.ok(e instanceof client.PublicSearchFailure); assert.ok(!e.message.includes('PRIVATE_TEXT')); assert.ok(!/A fonte mudou|A empresa mudou/.test(e.message)); assert.match(e.message, /[Nn]enhuma nova tentativa/); return true
      })
    assert.equal(calls, 1)
  }
})

test('independent: record exact reviewed source SHA256s', () => {
  for (const [name, expectedHash] of reviewHashes) { assert.equal(hash(name), expectedHash, 'Source changed during review: ' + name); console.log('REVIEW_SHA256', name, expectedHash) }
})
