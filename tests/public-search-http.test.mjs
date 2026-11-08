import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire, Module } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
// Existing packages only: no downloads, symlinks, builds, environment files or server imports.
const dependencyBase = path.resolve(process.env.NUCLEO_TEST_DEPS_ROOT || root)
assert.deepEqual(readFileSync(path.join(root, 'backend/package-lock.json')), readFileSync(path.join(dependencyBase, 'backend/package-lock.json')), 'Dependency lock must be identical')
const dependencyRoots = [path.join(dependencyBase, 'backend')]
const dependencyRoot = dependencyRoots.find(dir => ['express', 'axios', 'typescript'].every(name => existsSync(path.join(dir, 'node_modules', name, 'package.json'))))
if (!dependencyRoot) throw new Error('Existing Express/Axios/TypeScript packages required; install is not performed by this test')
const requireDependency = createRequire(path.join(dependencyRoot, 'package.json'))
const ts = requireDependency('typescript')
const express = requireDependency('express')
const permitted = new Set(['search.ts', 'public-search.ts', 'auth/jwt-auth.ts', 'auth/tenant-context.ts'].map(name => path.resolve(root, 'backend/src', name)))
const cache = new Map()
function loadSource(filename) {
  filename = path.resolve(filename)
  assert.ok(permitted.has(filename), 'Unexpected source import: ' + filename)
  if (cache.has(filename)) return cache.get(filename).exports
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  const module = new Module(filename)
  cache.set(filename, module)
  module.filename = filename
  module.require = name => {
    if (name === '../../shared/public-search.cjs') return createRequire(filename)(name)
    if (name.startsWith('.')) return loadSource(path.resolve(path.dirname(filename), name + '.ts'))
    assert.ok(['express', 'axios'].includes(name), 'Unexpected runtime dependency: ' + name)
    return requireDependency(name)
  }
  module._compile(compiled, filename)
  return module.exports
}
const { createSearchRouter } = loadSource(path.join(root, 'backend/src/search.ts'))
const { createSupabaseJwtAuth } = loadSource(path.join(root, 'backend/src/auth/jwt-auth.ts'))
const { createTenantContext } = loadSource(path.join(root, 'backend/src/auth/tenant-context.ts'))
const ids = { operator: '11111111-1111-4111-8111-111111111111', viewer: '22222222-2222-4222-8222-222222222222', tenantless: '33333333-3333-4333-8333-333333333333' }
const payload = { query: 'Restaurantes Curitiba', expected_tenant_id: 'tenant-a', expected_provider: 'duckduckgo_instant_answer', authorize_public_query: true, request_id: '12345678-1234-4123-8123-123456789abc' }

test('real local Express mount with production JWT and tenant middleware, synthetic upstreams', async t => {
  const counters = { provider: 0, verify: 0, profile: 0 }
  let providerFails = false
  const verifier = async token => {
    counters.verify++
    if (token === 'anonymous') return { ok: true, claims: { sub: ids.operator, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 60, is_anonymous: true } }
    if (!(token in ids)) return { ok: false, reason: 'invalid' }
    return { ok: true, claims: { sub: ids[token], role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 60 } }
  }
  const profiles = {
    from(table) {
      assert.equal(table, 'profiles')
      return { select(columns) {
        assert.equal(columns, 'tenant_id, role')
        return { eq(column, userId) {
          assert.equal(column, 'id')
          return { async single() {
            counters.profile++
            return { data: userId === ids.tenantless ? null : { tenant_id: 'tenant-a', role: userId === ids.viewer ? 'viewer' : 'operator' }, error: null }
          } }
        } }
      } }
    }
  }
  const app = express()
  app.use(express.json())
  app.use('/api', createSupabaseJwtAuth(verifier))
  app.use('/api', createTenantContext(profiles))
  app.use('/api/search', createSearchRouter({
    env: { PUBLIC_SEARCH_ENABLED: 'true', PUBLIC_SEARCH_DDG_COMMERCIAL_APPROVED: 'true' },
    transport: async (url, options) => {
      counters.provider++
      assert.equal(url, 'https://api.duckduckgo.com/')
      assert.equal(options.params.q, payload.query)
      if (providerFails) throw new Error('private-token https://secret.invalid/?key=private-token')
      return { data: { Heading: 'Fonte de teste', AbstractText: 'Informação pública de fixture', AbstractURL: 'https://source.org/test' } }
    }
  }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
  const address = server.address()
  assert.equal(address.address, '127.0.0.1')
  const base = 'http://127.0.0.1:' + address.port
  const call = async (method, token, body) => {
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers.Authorization = 'Bearer ' + token
    const response = await fetch(base + (method === 'GET' ? '/api/search/capabilities' : '/api/search'), {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000)
    })
    return { status: response.status, data: await response.json(), cache: response.headers.get('cache-control') }
  }
  try {
    await t.test('GET capabilities requires JWT and resolves trusted tenant', async () => {
      assert.equal((await call('GET')).status, 401)
      assert.equal((await call('GET', 'invalid')).status, 401)
      const profilesBefore = counters.profile; assert.equal((await call('GET', 'anonymous')).status, 401); assert.equal(counters.profile, profilesBefore)
      const good = await call('GET', 'operator')
      assert.equal(good.status, 200); assert.equal(good.data.tenant_id, 'tenant-a')
      assert.equal(good.data.enabled, true); assert.equal(good.cache, 'no-store')
      assert.equal(counters.provider, 0)
    })
    await t.test('POST without JWT, invalid JWT, missing tenant, wrong role, mismatch or consent never reaches provider', async () => {
      const cases = [
        ['anonymous', payload, 401], [undefined, payload, 401], ['invalid', payload, 401], ['tenantless', payload, 403],
        ['viewer', payload, 403], ['operator', { ...payload, expected_tenant_id: 'tenant-b' }, 409],
        ['operator', { ...payload, authorize_public_query: false }, 400]
      ]
      for (const [token, body, status] of cases) assert.equal((await call('POST', token, body)).status, status)
      assert.equal(counters.provider, 0)
    })
    await t.test('authorized POST invokes provider exactly once and returns unestablished contact state', async () => {
      const result = await call('POST', 'operator', payload)
      assert.equal(result.status, 200); assert.equal(counters.provider, 1)
      assert.equal(result.data.request_id, payload.request_id); assert.equal(result.data.tenant_id, 'tenant-a')
      assert.equal(result.data.results[0].url, 'https://source.org/test')
      assert.equal(result.data.state.contact_permission, 'not_established')
      assert.equal(result.cache, 'no-store')
      assert.equal((await call('POST', 'operator', payload)).status, 200); assert.equal(counters.provider, 1)
      assert.equal((await call('POST', 'operator', { ...payload, query: 'different' })).status, 409); assert.equal(counters.provider, 1)
    })
    await t.test('provider failure is sanitized at HTTP boundary', async () => {
      providerFails = true
      const result = await call('POST', 'operator', { ...payload, request_id: '12345678-1234-4123-8123-123456789abd' })
      assert.equal(result.status, 502); assert.equal(counters.provider, 2)
      assert.deepEqual(result.data, { error: 'provider_request_failed' })
      assert.ok(!JSON.stringify(result).includes('private-token'))
    })
    assert.ok(counters.verify > 0); assert.ok(counters.profile > 0)
    assert.equal(cache.size, 4)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    assert.equal(server.listening, false)
  }
})
