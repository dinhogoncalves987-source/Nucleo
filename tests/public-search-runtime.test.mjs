import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire, Module } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import bridge from '../backend/src/public-search-bridge.cjs'
import core from '../shared/public-search.cjs'
const root = fileURLToPath(new URL('../', import.meta.url))
// Existing packages only; never installs dependencies.
const dependencyBase = path.resolve(process.env.NUCLEO_TEST_DEPS_ROOT || root)
assert.deepEqual(readFileSync(path.join(root, 'backend/package-lock.json')), readFileSync(path.join(dependencyBase, 'backend/package-lock.json')), 'Dependency lock must be identical')
const dependencyPackage = path.join(dependencyBase, 'backend/package.json')
if (!existsSync(path.join(dependencyBase, 'backend/node_modules/express'))) throw new Error('Existing Express packages required; install is not performed by this test')
const deps = createRequire(dependencyPackage)
const filename = path.join(root, 'backend/src/conversation-app.cjs')
const appModule = new Module(filename)
const sourceRequire = createRequire(filename)
appModule.require = name => ['express', 'cors'].includes(name) ? deps(name) : sourceRequire(name)
appModule._compile(readFileSync(filename, 'utf8'), filename)
const { createConversationApp } = appModule.exports
const user = '11111111-1111-4111-8111-111111111111'
const tenant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const body = { query: 'Restaurantes Curitiba', expected_tenant_id: tenant, expected_provider: 'duckduckgo_instant_answer', authorize_public_query: true, request_id: '12345678-1234-4123-8123-123456789abc' }
function fixture() {
  const counts = { client: 0, auth: 0, profile: 0, fetch: 0 }
  const env = { SUPABASE_URL: 'https://nucleo.synthetic.invalid', SUPABASE_SERVICE_KEY: 'synthetic-key', PUBLIC_SEARCH_ENABLED: 'true', PUBLIC_SEARCH_DDG_COMMERCIAL_APPROVED: 'true', JAMES_AUTH_MODE: 'qadma' }
  let role = 'operator', noTenant = false, failProvider = false
  return { env, counts, setRole: v => role = v, setTenantless: v => noTenant = v, failProvider: () => failProvider = true,
    createClient(url, key) {
      counts.client++; assert.equal(url, env.SUPABASE_URL); assert.equal(key, env.SUPABASE_SERVICE_KEY)
      return { auth: { async getUser(token) { counts.auth++; return token === 'synthetic' ? { data: { user: { id: user } }, error: null } : { data: {}, error: {} } } },
        from(table) { assert.equal(table, 'profiles'); return { select(columns) { assert.equal(columns, 'tenant_id, role'); return { eq(column, id) {
          assert.equal(column, 'id'); assert.equal(id, user); return { async single() { counts.profile++; return { data: noTenant ? null : { tenant_id: tenant, role }, error: null } } }
        } } } } }
      }
    },
    async fetchImpl(url, options) {
      counts.fetch++; assert.equal(new URL(url).origin, 'https://api.duckduckgo.com')
      assert.equal(new URL(url).searchParams.get('q'), body.query)
      assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal)
      if (failProvider) throw Error('secret-token private-query')
      return new Response(JSON.stringify({ Heading: 'Fonte', AbstractText: 'Público', AbstractURL: 'https://source.org/' }))
    }
  }
}
test('supervised runtime exposes search and preserves conversation/404 using local HTTP only', async t => {
  const f = fixture()
  const app = createConversationApp(f)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
  const base = 'http://127.0.0.1:' + server.address().port
  async function call(route, method = 'GET', token = 'synthetic', data) {
    const headers = { 'Content-Type': 'application/json' }; if (token) headers.Authorization = 'Bearer ' + token
    const r = await fetch(base + route, { method, headers, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(5000) })
    return { status: r.status, data: await r.json(), cache: r.headers.get('cache-control') }
  }
  try {
    await t.test('capabilities reads trusted Núcleo auth/profile only even with Qadma James mode', async () => {
      const r = await call('/api/search/capabilities'); assert.equal(r.status, 200); assert.equal(r.data.tenant_id, tenant)
      assert.equal(r.cache, 'no-store'); assert.equal(f.counts.fetch, 0); assert.equal(f.counts.profile, 1)
    })
    await t.test('auth, tenant, role, mismatches and checkbox block provider', async () => {
      assert.equal((await call('/api/search', 'POST', null, body)).status, 401)
      assert.equal((await call('/api/search', 'POST', 'invalid', body)).status, 401)
      f.setTenantless(true); assert.equal((await call('/api/search', 'POST', 'synthetic', body)).status, 403); f.setTenantless(false)
      f.setRole('viewer'); assert.equal((await call('/api/search', 'POST', 'synthetic', body)).status, 403); f.setRole('operator')
      for (const [changes, status] of [[{ expected_tenant_id: 'other' }, 409], [{ expected_provider: 'google_cse' }, 409], [{ authorize_public_query: false }, 400]]) {
        assert.equal((await call('/api/search', 'POST', 'synthetic', { ...body, ...changes })).status, status)
      }
      assert.equal(f.counts.fetch, 0)
    })
    await t.test('disabled-by-default configuration does not query provider', async () => {
      delete f.env.PUBLIC_SEARCH_ENABLED
      const r = await call('/api/search/capabilities'); assert.equal(r.data.enabled, false); assert.equal(r.data.reason, 'search_disabled')
      assert.equal((await call('/api/search', 'POST', 'synthetic', body)).status, 503); assert.equal(f.counts.fetch, 0)
      f.env.PUBLIC_SEARCH_ENABLED = 'true'
    })
    await t.test('authorized search invokes only bounded provider stub', async () => {
      const r = await call('/api/search', 'POST', 'synthetic', body)
      assert.equal(r.status, 200); assert.equal(r.data.results.length, 1); assert.equal(r.data.tenant_id, tenant)
      assert.equal(r.data.state.contact_permission, 'not_established'); assert.equal(f.counts.fetch, 1)
      let replay; const handlers = core.createSearchHandlers({ env: f.env, transport: async () => { throw Error('must not redispatch across entrypoints') } });
      await handlers.search({ auth: { userId: user, tenantId: tenant, appRole: 'operator' }, body }, { setHeader() {}, status(code) { assert.equal(code, 200); return this }, json(value) { replay = value } });
      assert.deepEqual(replay, r.data)
      assert.equal((await call('/api/search', 'POST', 'synthetic', body)).status, 200); assert.equal(f.counts.fetch, 1)
      assert.equal((await call('/api/search', 'POST', 'synthetic', { ...body, query: 'different' })).status, 409); assert.equal(f.counts.fetch, 1)
      f.failProvider(); assert.deepEqual((await call('/api/search', 'POST', 'synthetic', { ...body, request_id: '12345678-1234-4123-8123-123456789abd' })).data, { error: 'provider_request_failed' })
    })
    await t.test('existing conversation still handles unauthenticated request and unknown route stays 404', async () => {
      assert.equal((await call('/api/james/conversation', 'POST', null, { message: 'Fixture' })).status, 401)
      assert.deepEqual(await call('/not-found'), { status: 404, data: { code: 'route_not_available' }, cache: null })
      assert.equal(f.counts.fetch, 2)
    })
  } finally { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve())); assert.equal(server.listening, false) }
})

test('bridge rejects duplicate authorization and missing configuration before provider', async () => {
  const f = fixture(), b = bridge.createAuthenticatedSearchBridge(f)
  assert.equal((await b.capabilities({ rawHeaders: ['Authorization', 'Bearer synthetic', 'Authorization', 'Bearer synthetic'] })).status, 401)
  delete f.env.SUPABASE_SERVICE_KEY
  assert.equal((await b.capabilities({ headers: { authorization: 'Bearer synthetic' } })).status, 503)
  assert.equal(f.counts.fetch, 0); assert.equal(f.counts.client, 0)
})
test('bounded fetch refuses oversized declared/streamed response, invalid status and redirects', async () => {
  const options = { params: {}, maxContentLength: 262144, signal: new AbortController().signal }
  for (const response of [
    new Response('x', { headers: { 'content-length': '262145' } }),
    new Response('x'.repeat(262145)),
    new Response('private failure', { status: 500 })
  ]) {
    const transport = bridge.createBoundedSearchTransport(async (_url, init) => { assert.equal(init.redirect, 'error'); return response })
    await assert.rejects(transport('https://api.duckduckgo.com/', options), e => e.status === 502)
  }
  const t = bridge.createBoundedSearchTransport(async () => { throw Error('redirect rejected') })
  await assert.rejects(t('https://api.duckduckgo.com/', options))
  await assert.rejects(t('http://127.0.0.1/', options), { message: 'provider_request_failed' })
})
test('runtime app imports only conversation and search bridges, no legacy startup', () => {
  const s = readFileSync(filename, 'utf8')
  assert.ok(s.includes("app.get('/api/search/capabilities'")); assert.ok(s.includes("app.post('/api/search'"))
  assert.ok(!/require\([^)]*(server|scheduler|queue)/.test(s))
  const facade = readFileSync(path.join(root, 'backend/src/public-search.ts'), 'utf8')
  assert.ok(facade.includes("export * from '../../shared/public-search.cjs'"))
})


test('supervised bridge enforces DDG approval and Google retirement without provider calls', async () => {
  const f = fixture(); delete f.env.PUBLIC_SEARCH_DDG_COMMERCIAL_APPROVED
  const before = () => new Date('2026-11-08T00:00:00Z')
  const b = bridge.createAuthenticatedSearchBridge({ ...f, now: before })
  const request = { headers: { authorization: 'Bearer synthetic' }, body }
  assert.equal((await b.capabilities(request)).body.reason, 'duckduckgo_commercial_approval_required')
  assert.equal((await b.search(request)).status, 503)
  Object.assign(f.env, { PUBLIC_SEARCH_PROVIDER: 'google_cse', GOOGLE_API_KEY: 'synthetic', GOOGLE_SEARCH_ENGINE_ID: 'synthetic', PUBLIC_SEARCH_GOOGLE_BUDGET_APPROVED: 'true' })
  request.body = { ...body, expected_provider: 'google_cse' }
  assert.equal((await b.capabilities(request)).body.reason, 'google_eligibility_unconfirmed')
  assert.equal((await b.search(request)).status, 503)
  f.env.PUBLIC_SEARCH_GOOGLE_LEGACY_CUSTOMER = 'true'
  const retired = bridge.createAuthenticatedSearchBridge({ ...f, now: () => new Date('2027-01-01T00:00:00Z') })
  assert.equal((await retired.capabilities(request)).body.reason, 'google_provider_retired')
  assert.equal((await retired.search(request)).status, 503)
  assert.equal(f.counts.fetch, 0)
})

test('anonymous Supabase identity is rejected before profile and provider', async () => {
  let profiles = 0, queries = 0
  const b = bridge.createAuthenticatedSearchBridge({ env: { SUPABASE_URL: 'synthetic', SUPABASE_SERVICE_KEY: 'synthetic' }, createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: user, is_anonymous: true } } }) }, from() { profiles++; throw Error('must not read') } }), fetchImpl: async () => { queries++; throw Error('must not send') } })
  const r = await b.capabilities({ headers: { authorization: 'Bearer synthetic' } })
  assert.equal(r.status, 401); assert.equal(profiles, 0); assert.equal(queries, 0)
})
test('auth deadline bounds getUser/profile and ignores late completion without continuing', async () => {
  for (const pendingStage of ['user', 'profile']) {
    let resolvePending, profiles = 0, queries = 0
    const pending = new Promise(resolve => { resolvePending = resolve })
    const verified = { data: { user: { id: user } } }
    const profile = { data: { tenant_id: tenant, role: 'operator' } }
    const b = bridge.createAuthenticatedSearchBridge({ authTimeoutMs: 10, env: { SUPABASE_URL: 'synthetic', SUPABASE_SERVICE_KEY: 'synthetic', PUBLIC_SEARCH_ENABLED: 'true', PUBLIC_SEARCH_DDG_COMMERCIAL_APPROVED: 'true' }, createClient: () => ({
      auth: { getUser: async () => pendingStage === 'user' ? pending : verified },
      from() { profiles++; return { select: () => ({ eq: () => ({ single: async () => pending }) }) } }
    }), fetchImpl: async () => { queries++; throw Error('must not send') } })
    const r = await b.search({ headers: { authorization: 'Bearer synthetic' }, body })
    assert.deepEqual(r, { status: 503, body: { error: 'auth_unavailable' } })
    resolvePending(pendingStage === 'user' ? verified : profile)
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(profiles, pendingStage === 'user' ? 0 : 1); assert.equal(queries, 0)
  }
})
test('stream decoder rejects malformed UTF-8', async () => {
  const transport = bridge.createBoundedSearchTransport(async () => new Response(new Uint8Array([0xc3, 0x28])))
  await assert.rejects(transport('https://api.duckduckgo.com/', { params: {}, maxContentLength: 262144, signal: new AbortController().signal }))
})
