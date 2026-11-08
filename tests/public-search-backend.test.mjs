import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { searchCapabilities as coreCapabilities, runPublicSearch, publicResultUrl, phoneEvidence, adaptResults, createSearchHandlers, createSearchLedger } from '../backend/src/public-search.ts'
const searchCapabilities = (env, auth, now = () => new Date('2026-11-08T12:00:00Z')) => coreCapabilities(env, auth, now)
const auth = { userId: 'operator', tenantId: 'tenant-a', appRole: 'operator' }
const env = { PUBLIC_SEARCH_ENABLED: 'true', PUBLIC_SEARCH_DDG_COMMERCIAL_APPROVED: 'true' }
const body = { query: '  restaurantes   Curitiba ', expected_tenant_id: 'tenant-a', expected_provider: 'duckduckgo_instant_answer', authorize_public_query: true, request_id: '12345678-1234-4123-8123-123456789abc' }
const source = { Heading: 'Fonte pública', AbstractText: 'Telefone (41) 91234-5678', AbstractURL: 'https://public-source.org/page' }
function setup(extra = {}) { const calls = []; return { calls, options: { ledger: createSearchLedger(), env, auth, body, transport: async (...args) => { calls.push(args); return { data: source } }, now: () => new Date('2026-11-08T12:00:00Z'), ...extra } } }
async function rejectsBeforeNetwork(extra, code) { const f = setup(extra); await assert.rejects(runPublicSearch(f.options), { message: code }); assert.equal(f.calls.length, 0) }

test('disabled defaults and exact capability contract', () => {
  const c = searchCapabilities({}, auth)
  assert.equal(c.enabled, false); assert.equal(c.reason, 'search_disabled')
  assert.equal(c.provider, 'duckduckgo_instant_answer'); assert.equal(c.configured, true)
  assert.deepEqual(Object.keys(c).sort(), ['tenant_id', 'enabled', 'provider', 'configured', 'reason', 'requires_query_authorization', 'limitations'].sort())
})
test('Google requires explicit key, engine and budget, unsupported provider fails closed', () => {
  const g = { ...env, PUBLIC_SEARCH_PROVIDER: 'google_cse', PUBLIC_SEARCH_GOOGLE_LEGACY_CUSTOMER: 'true' }
  assert.equal(searchCapabilities(g, auth).reason, 'provider_not_configured')
  assert.equal(searchCapabilities({ ...g, GOOGLE_API_KEY: 'stub', GOOGLE_SEARCH_ENGINE_ID: 'stub' }, auth).reason, 'google_budget_not_approved')
  assert.equal(searchCapabilities({ ...g, GOOGLE_API_KEY: 'stub', GOOGLE_SEARCH_ENGINE_ID: 'stub', PUBLIC_SEARCH_GOOGLE_BUDGET_APPROVED: 'true' }, auth).enabled, true)
  assert.equal(searchCapabilities({ ...env, PUBLIC_SEARCH_PROVIDER: 'unknown' }, auth).reason, 'provider_not_supported')
})
test('anonymous, tenantless and forbidden role are rejected before transport', async () => {
  await rejectsBeforeNetwork({ auth: undefined }, 'authentication_required')
  await rejectsBeforeNetwork({ auth: { ...auth, tenantId: '' } }, 'tenant_required')
  await rejectsBeforeNetwork({ auth: { ...auth, appRole: 'viewer' } }, 'role_forbidden')
  for (const appRole of ['superadmin', 'manager', 'operator']) assert.equal(searchCapabilities(env, { ...auth, appRole }).enabled, true)
})
test('exact body, explicit consent, request UUID and tenant/provider matching', async () => {
  await rejectsBeforeNetwork({ body: { ...body, extra: true } }, 'invalid_request')
  await rejectsBeforeNetwork({ body: { query: 'q' } }, 'invalid_request')
  await rejectsBeforeNetwork({ body: { ...body, authorize_public_query: false } }, 'public_query_authorization_required')
  await rejectsBeforeNetwork({ body: { ...body, request_id: 'not-uuid' } }, 'invalid_request_id')
  await rejectsBeforeNetwork({ body: { ...body, expected_tenant_id: 'tenant-b' } }, 'tenant_changed')
  await rejectsBeforeNetwork({ body: { ...body, expected_provider: 'google_cse' } }, 'provider_changed')
  await rejectsBeforeNetwork({ env: {} }, 'search_disabled')
})
test('empty, long, non-string and control queries cannot be transmitted', async () => {
  for (const query of ['', '   ', 'a'.repeat(201), 1, 'a\nb', 'a\u007fb', 'a\u0085b']) await rejectsBeforeNetwork({ body: { ...body, query } }, 'invalid_query')
})
test('success keeps source provenance, normalized query and unestablished contact state', async () => {
  const f = setup(); const r = await runPublicSearch(f.options)
  assert.equal(f.calls.length, 1); assert.equal(r.query, 'restaurantes Curitiba')
  assert.equal(r.searched_at, '2026-11-08T12:00:00.000Z'); assert.equal(r.request_id, body.request_id)
  assert.deepEqual(r.state, { whatsapp: 'unknown', activity: 'unknown', contact_permission: 'not_established' })
  assert.equal(r.results[0].title, source.Heading)
  assert.deepEqual(r.results[0].phone_evidence, [{ raw: '(41) 91234-5678', normalized: '+5541912345678', excerpt: source.AbstractText }])
  const [url, config] = f.calls[0]
  assert.equal(url, 'https://api.duckduckgo.com/'); assert.equal(config.params.q, r.query)
  assert.equal(config.timeout, 8000); assert.equal(config.maxContentLength, 262144); assert.equal(config.maxRedirects, 0)
})
test('public URLs only, no local/private/obfuscated IP or script/userinfo', () => {
  for (const u of ['javascript:alert(1)', 'file:///tmp/x', 'http://localhost/a', 'http://a.local/a', 'http://127.1/a', 'http://2130706433/a', 'http://0x7f000001/a', 'http://10.0.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'https://user:secret@source.org/', 'https://source.org:444/', 'https://source.org/\nx']) assert.equal(publicResultUrl(u), null, u)
  assert.equal(publicResultUrl('https://source.org/page#anchor'), 'https://source.org/page')
})
test('no synthetic titles, unsourced direct answers or duplicate URL; nested topics bounded', () => {
  const data = { Answer: '42', Heading: '', AbstractText: 'text', AbstractURL: 'https://source.org/', RelatedTopics: [
    { Topics: [{ Text: 'Literal topic', FirstURL: 'https://source.org/a#one' }, { Text: 'Duplicate', FirstURL: 'https://source.org/a#two' }] },
    { Text: 'No URL' }, { Text: 'Private', FirstURL: 'http://192.168.0.1' }
  ] }
  assert.deepEqual(adaptResults('duckduckgo_instant_answer', data).map(r => r.title), ['Literal topic'])
  assert.deepEqual(adaptResults('duckduckgo_instant_answer', { Answer: '42' }), [])
  let nested = [{ Text: 'Too deep', FirstURL: 'https://source.org/deep' }]
  for (let i = 0; i < 7; i++) nested = [{ Topics: nested }]
  assert.deepEqual(adaptResults('duckduckgo_instant_answer', { RelatedTopics: nested }), [])
})
test('Google adapter caps ten results, ignores non-string provider fields and never falls back', async () => {
  assert.equal(adaptResults('google_cse', { items: Array.from({ length: 30 }, (_, i) => ({ title: 'Source ' + i, snippet: 'Description', link: 'https://source.org/' + i })) }).length, 10)
  assert.deepEqual(adaptResults('google_cse', { items: [{ title: {}, snippet: true, link: 'https://source.org' }] }), [])
  let count = 0
  const g = { ...env, PUBLIC_SEARCH_PROVIDER: 'google_cse', PUBLIC_SEARCH_GOOGLE_LEGACY_CUSTOMER: 'true', GOOGLE_API_KEY: 'stub-key', GOOGLE_SEARCH_ENGINE_ID: 'stub-engine', PUBLIC_SEARCH_GOOGLE_BUDGET_APPROVED: 'true' }
  const f = setup({ env: g, body: { ...body, expected_provider: 'google_cse' }, transport: async (url, config) => {
    count++; assert.equal(url, 'https://www.googleapis.com/customsearch/v1'); assert.equal(config.params.key, 'stub-key'); return { data: { items: [], searchInformation: { totalResults: '0' } } }
  } })
  assert.deepEqual((await runPublicSearch(f.options)).results, []); assert.equal(count, 1)
})
test('provider error/invalid/oversized data sanitized, no secret/query leakage', async () => {
  for (const data of [null, [], 4, '<html>error</html>', { error: { message: 'secret' } }, { text: 'a'.repeat(262145) }]) {
    await assert.rejects(runPublicSearch(setup({ transport: async () => ({ data }) }).options), e => e.status === 502 && !e.message.includes('secret'))
  }
  await assert.rejects(runPublicSearch(setup({ transport: async () => { throw Error('secret-key https://secret?query=private') } }).options), { message: 'provider_request_failed' })
})
test('phone evidence never fills missing digits/DDD, checks actual DDD, deduplicates', () => {
  assert.deepEqual(phoneEvidence('91234-5678; (20) 91234-5678; (41) 1234-5678; 41912345678'), [])
  const text = 'Fixo (11) 2345-6789; móvel +55 (41) 91234-5678; repetido (41) 91234-5678'
  const e = phoneEvidence(text)
  assert.deepEqual(e.map(x => x.normalized), ['+551123456789', '+5541912345678'])
  for (const x of e) { assert.ok(text.includes(x.raw)); assert.ok(x.excerpt.includes(x.raw)) }
})
test('router wiring static: upstream JWT and tenant precede mount; guard, no logs or network-on-import', () => {
  const router = readFileSync(new URL('../backend/src/search.ts', import.meta.url), 'utf8')
  const server = readFileSync(new URL('../backend/src/server.ts', import.meta.url), 'utf8')
  assert.ok(router.includes('createSearchRouter')); assert.ok(router.includes('router.use(handlers.guard)'))
  assert.ok(router.includes("router.get('/capabilities'")); assert.ok(router.includes('createSearchHandlers'))
  assert.ok(!router.includes('logger')); assert.ok(!router.includes('dotenv'))
  assert.ok(server.indexOf("app.use('/api', createSupabaseJwtAuth") < server.indexOf("app.use('/api/search'"))
  assert.ok(server.indexOf("app.use('/api', createTenantContext") < server.indexOf("app.use('/api/search'"))
})


test('deadline aborts transport and exposes only a fixed timeout code', async () => {
  let signal
  const f = setup({ transport: async (_url, config) => { signal = config.signal; return new Promise(() => {}) } })
  await assert.rejects(runPublicSearch(f.options), { status: 504, message: 'provider_timeout' })
  assert.equal(signal.aborted, true)
  await assert.rejects(runPublicSearch(f.options), { status: 409, message: 'request_outcome_uncertain' })
})


test('HTTP handlers independently enforce auth, tenant, role and map errors without Express', async () => {
  const f = setup(); const h = createSearchHandlers(f.options)
  function response() { return { code: 200, payload: null, headers: {}, status(code) { this.code = code; return this }, json(body) { this.payload = body }, setHeader(key, value) { this.headers[key] = value } } }
  let next = 0
  const missing = response(); h.guard({}, missing, () => next++); assert.equal(missing.code, 401); assert.equal(next, 0)
  const good = response(); h.guard({ auth }, good, () => next++); assert.equal(next, 1)
  for (const req of [{}, { auth: { ...auth, tenantId: '' } }, { auth: { ...auth, appRole: 'viewer' } }]) {
    const c = response(); h.capabilities(req, c); assert.ok([401, 403].includes(c.code))
    const p = response(); await h.search({ ...req, body }, p); assert.ok([401, 403].includes(p.code))
  }
  assert.equal(f.calls.length, 0)
  const c = response(); h.capabilities({ auth }, c); assert.equal(c.payload.tenant_id, 'tenant-a'); assert.equal(c.headers['Cache-Control'], 'no-store')
  const changed = response(); await h.search({ auth, body: { ...body, expected_tenant_id: 'other' } }, changed); assert.equal(changed.code, 409); assert.equal(f.calls.length, 0)
  const ok = response(); await h.search({ auth, body }, ok); assert.equal(ok.code, 200); assert.equal(ok.payload.request_id, body.request_id); assert.equal(f.calls.length, 1)
  const bad = createSearchHandlers({ env, ledger: createSearchLedger(), transport: async () => { throw Error('private key') } }); const r = response(); await bad.search({ auth, body }, r); assert.equal(r.code, 502); assert.deepEqual(r.payload, { error: 'provider_request_failed' })
})
test('URL policy rejects non-default ports and malformed/local DNS labels', () => {
  for (const url of ['http://source.org:443/', 'https://source.org:80/', 'https://hidden.onion/', 'https://bad_.org/', 'https://-bad.org/', 'https://bad-.org/', 'https://bad..org/']) assert.equal(publicResultUrl(url), null)
  assert.equal(publicResultUrl('https://source.org:443/'), 'https://source.org/')
})

test('DDG requires prior commercial approval and identifies client in authorized request', async () => {
  await rejectsBeforeNetwork({ env: { PUBLIC_SEARCH_ENABLED: 'true' } }, 'duckduckgo_commercial_approval_required')
  const f = setup(); await runPublicSearch(f.options)
  assert.equal(f.calls[0][1].params.t, 'nucleo-public-search')
  assert.ok(searchCapabilities(env, auth).limitations.some(s => s.includes('DuckDuckGo')))
})
test('Google legacy eligibility and exact UTC retirement fail closed before HTTP', async () => {
  const google = { PUBLIC_SEARCH_ENABLED: 'true', PUBLIC_SEARCH_PROVIDER: 'google_cse', GOOGLE_API_KEY: 'synthetic', GOOGLE_SEARCH_ENGINE_ID: 'synthetic', PUBLIC_SEARCH_GOOGLE_BUDGET_APPROVED: 'true' }
  const googleBody = { ...body, expected_provider: 'google_cse' }
  await rejectsBeforeNetwork({ env: google, body: googleBody }, 'google_eligibility_unconfirmed')
  const eligible = { ...google, PUBLIC_SEARCH_GOOGLE_LEGACY_CUSTOMER: 'true' }
  const before = () => new Date('2026-12-31T23:59:59.999Z')
  const after = () => new Date('2027-01-01T00:00:00.000Z')
  assert.equal(searchCapabilities(eligible, auth, before).enabled, true)
  assert.equal(searchCapabilities(eligible, auth, after).reason, 'google_provider_retired')
  await rejectsBeforeNetwork({ env: eligible, body: googleBody, now: after }, 'google_provider_retired')
  await rejectsBeforeNetwork({ env: eligible, body: googleBody, now: () => new Date('invalid') }, 'google_provider_retired')
  let calls = 0; const f = setup({ env: eligible, body: googleBody, now: before, transport: async () => { calls++; return {data: {searchInformation: {totalResults:'0'}}} } }); await runPublicSearch(f.options); assert.equal(calls, 1)
})
test('handler capabilities propagates injected retirement clock', () => {
  const h = createSearchHandlers({ env: { ...env, PUBLIC_SEARCH_PROVIDER: 'google_cse' }, transport: async () => { throw Error('must not call') }, now: () => new Date('2027-01-01T00:00:00Z') })
  let response
  h.capabilities({ auth }, { setHeader() {}, json(value) { response = value }, status() { return this } })
  assert.equal(response.reason, 'google_provider_retired')
})

test('malformed provider schemas cannot masquerade as empty successful searches', async () => {
  for (const data of [{}, { status: 'ok' }, { AbstractText: 123 }, { RelatedTopics: 'bad' }, { RelatedTopics: [null] }, { RelatedTopics: [{Text:'', FirstURL:''}] }, { RelatedTopics: [{Topics:[]}] }, {Heading:'Source',AbstractText:'Description',AbstractURL:'',Type:'A',RelatedTopics:[],Results:[]}, { RelatedTopics: [{ Topics: {} }] }, { Heading: '', AbstractText: '', AbstractURL: '' }]) {
    await assert.rejects(runPublicSearch(setup({ transport: async () => ({ data }) }).options), { message: 'provider_response_invalid' })
  }
  const google = { ...env, PUBLIC_SEARCH_PROVIDER: 'google_cse', PUBLIC_SEARCH_GOOGLE_LEGACY_CUSTOMER: 'true', GOOGLE_API_KEY: 'synthetic', GOOGLE_SEARCH_ENGINE_ID: 'synthetic', PUBLIC_SEARCH_GOOGLE_BUDGET_APPROVED: 'true' }
  for (const data of [{}, { items: [] }, { items: {} }, { items: [null] }, { items: [{ title: 1, link: 'https://source.org' }] }, { searchInformation: { totalResults: 0 } }, { searchInformation: { totalResults: '4' } }]) {
    await assert.rejects(runPublicSearch(setup({ env: google, body: { ...body, expected_provider: 'google_cse' }, transport: async () => ({ data }) }).options), { message: 'provider_response_invalid' })
  }
})
test('recognizable legitimate zero results succeed for both providers', async () => {
  const ddg = { Heading: '', AbstractText: '', AbstractURL: '', Type: '', RelatedTopics: [], Results: [] }
  assert.deepEqual((await runPublicSearch(setup({ transport: async () => ({ data: ddg }) }).options)).results, [])
  const google = { ...env, PUBLIC_SEARCH_PROVIDER: 'google_cse', PUBLIC_SEARCH_GOOGLE_LEGACY_CUSTOMER: 'true', GOOGLE_API_KEY: 'synthetic', GOOGLE_SEARCH_ENGINE_ID: 'synthetic', PUBLIC_SEARCH_GOOGLE_BUDGET_APPROVED: 'true' }
  assert.deepEqual((await runPublicSearch(setup({ env: google, body: { ...body, expected_provider: 'google_cse' }, transport: async () => ({ data: { searchInformation: { totalResults: '0' } } }) }).options)).results, [])
})
test('request ledger replays same normalized payload once and rejects different payload', async () => {
  const f = setup(); const first = await runPublicSearch(f.options)
  first.results[0].title = 'Caller mutation'
  const second = await runPublicSearch({ ...f.options, body: { ...body, query: 'restaurantes Curitiba' } })
  assert.equal(f.calls.length, 1); assert.equal(second.results[0].title, source.Heading)
  await assert.rejects(runPublicSearch({ ...f.options, body: { ...body, query: 'Different' } }), { status: 409, message: 'request_id_conflict' })
  assert.equal(f.calls.length, 1)
})
test('inflight duplicates do not dispatch and completed requests become replayable', async () => {
  let finish, calls = 0
  const f = setup({ transport: async () => { calls++; return new Promise(resolve => { finish = resolve }) } })
  const first = runPublicSearch(f.options)
  await assert.rejects(runPublicSearch(f.options), { status: 409, message: 'request_in_progress' })
  finish({ data: source }); await first; await runPublicSearch(f.options); assert.equal(calls, 1)
})
test('post-dispatch failure is uncertain and never silently retried', async () => {
  let calls = 0
  const f = setup({ transport: async () => { calls++; throw Error('private') } })
  await assert.rejects(runPublicSearch(f.options), { message: 'provider_request_failed' })
  await assert.rejects(runPublicSearch(f.options), { status: 409, message: 'request_outcome_uncertain' }); assert.equal(calls, 1)
})
test('ledger scopes tenant and actor, bounds records without eviction', async () => {
  const f = setup({ ledger: createSearchLedger(3) }); await runPublicSearch(f.options)
  await runPublicSearch({ ...f.options, auth: { ...auth, userId: 'other-user' } })
  await runPublicSearch({ ...f.options, auth: { ...auth, tenantId: 'tenant-b' }, body: { ...body, expected_tenant_id: 'tenant-b' } })
  assert.equal(f.calls.length, 3)
  await assert.rejects(runPublicSearch({ ...f.options, body: { ...body, request_id: '12345678-1234-4123-8123-123456789abd' } }), { status: 503, message: 'request_ledger_full' })
  await runPublicSearch(f.options); assert.equal(f.calls.length, 3)
})

test('DDG Results entries preserve source evidence rather than silently returning zero', async () => {
  const data = { Heading: '', AbstractText: '', AbstractURL: '', Type: 'E', RelatedTopics: [], Results: [{ Text: 'Source text', FirstURL: 'https://source.org/result' }] }
  const r = await runPublicSearch(setup({ transport: async () => ({data}) }).options); assert.equal(r.results.length, 1); assert.equal(r.results[0].url, 'https://source.org/result')
})

test('request receipt snapshots exact validated ID before awaiting provider', async () => {
  let finish, calls = 0
  const originalId = 'ABCDEF12-1234-4123-8123-123456789ABC'
  const mutableBody = { ...body, request_id: originalId }
  const f = setup({ body: mutableBody, transport: async () => { calls++; return new Promise(resolve => { finish = resolve }) } })
  const pending = runPublicSearch(f.options)
  mutableBody.request_id = '12345678-1234-4123-8123-123456789abd'
  finish({ data: source })
  assert.equal((await pending).request_id, originalId)
  const replay = await runPublicSearch({ ...f.options, body: { ...body, request_id: originalId } })
  assert.equal(replay.request_id, originalId); assert.equal(calls, 1)
})
