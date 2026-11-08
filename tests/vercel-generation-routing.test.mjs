import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

// Run with node --experimental-vm-modules --test tests/vercel-generation-routing.test.mjs.
// Every external service is replaced in the VM. No credentials or network needed.
const root = fileURLToPath(new URL('../', import.meta.url))
const names = ['affiliate-opportunities', 'batch-messages', 'extract-contact', 'health', 'promo-suggestion', 'rescue-message']
const context = () => vm.createContext({ console, process: { env: {} } })
const read = path => readFileSync(resolve(root, path), 'utf8')
const response = () => ({ code: 200, body: null, status(code) { this.code = code; return this }, json(body) { this.body = body; return this } })

async function fixture({ claims = true, profile = true } = {}) {
  const ctx = context()
  const calls = { claims: 0, profiles: 0, provider: 0, loaded: [] }
  const supabase = { auth: { getClaims: async () => { calls.claims++; return claims ? { data: { claims: { sub: 'synthetic-user' } } } : { error: true } } }, from: () => ({ select: () => ({ eq: () => ({ single: async () => { calls.profiles++; return { data: profile ? { tenant_id: 'trusted-tenant' } : null } } }) }) }) }
  const engine = { openai: { chat: { completions: { create: async () => { calls.provider++; return { choices: [{ message: { content: '{"nome":"synthetic"}' } }] } } } } } }
  const cache = new Map()
  async function stub(id, value) {
    const mod = new vm.SyntheticModule(Object.keys(value), function () { for (const [key, entry] of Object.entries(value)) this.setExport(key, entry) }, { context: ctx, identifier: id })
    await mod.link(() => { throw new Error('Unexpected stub import') }); await mod.evaluate(); return mod
  }
  const supabaseModule = await stub('supabase', { createClient: () => supabase })
  const engineModule = await stub('engine', engine)
  async function load(path) {
    if (cache.has(path)) return cache.get(path)
    calls.loaded.push(path)
    const source = stripTypeScriptTypes(readFileSync(path, 'utf8'), { mode: 'strip' })
    const module = new vm.SourceTextModule(source, { context: ctx, identifier: path,
      importModuleDynamically: async (specifier, parent) => { const child = await link(specifier, parent); if (child.status === 'linked') await child.evaluate(); return child } })
    cache.set(path, module)
    await module.link(link)
    return module
  }
  async function link(specifier, parent) {
    if (specifier === '@supabase/supabase-js') return supabaseModule
    if (specifier.endsWith('/james-engine')) return engineModule
    if (!specifier.startsWith('.')) throw new Error(`External import forbidden: ${specifier}`)
    return load(resolve(dirname(parent.identifier), specifier + '.ts'))
  }
  const router = await load(resolve(root, 'api/james/generate/[action].ts'))
  await router.evaluate()
  return { handle: router.namespace.default, calls }
}

for (const name of names) {
  test(`${name}: existing URL invokes its handler and retains auth/method denial`, async () => {
    const f = await fixture()
    const make = () => ({ url: `/api/james/generate/${name}?action=health`, method: 'POST', headers: {}, query: { action: 'health' }, body: { tenant_id: 'spoof', leads: [], text: 'synthetic' } })
    let req = make(); let res = response(); await f.handle(req, res)
    assert.equal(res.code, 401); assert.equal(f.calls.provider, 0); assert.equal(f.calls.claims, 0)
    req = make(); req.headers.authorization = 'Bearer synthetic'; req.method = 'GET'; res = response(); await f.handle(req, res)
    assert.equal(res.code, 405); assert.equal(f.calls.provider, 0)
    req = make(); req.headers.authorization = 'Bearer synthetic'; res = response(); await f.handle(req, res)
    assert.equal(res.code, 200); assert.equal(req.body.tenant_id, 'trusted-tenant')
    const loadedHandlers = f.calls.loaded.filter(path => path.includes('server-handlers'))
    assert.equal(loadedHandlers.length, 1)
    assert.ok(loadedHandlers[0].endsWith(`${name}.ts`))
  })
}

test('invalid JWT and missing trusted tenant cannot reach provider', async () => {
  for (const opts of [{ claims: false }, { profile: false }]) {
    const f = await fixture(opts)
    const res = response()
    await f.handle({ url: '/api/james/generate/health', method: 'POST', headers: { authorization: 'Bearer synthetic' }, body: { tenant_id: 'spoof' } }, res)
    assert.equal(res.code, opts.claims === false ? 401 : 403)
    assert.equal(f.calls.provider, 0)
  }
})

test('unknown paths and query/body dispatch injection never load a handler', async () => {
  const f = await fixture()
  for (const url of ['/api/james/generate/unknown', '/api/james/generate', '/api/james/generate/__proto__', '/api/james/generate/health/nested', '/api/james/generate/%2e%2e', '/api/james/conversation', undefined]) {
    const res = response()
    await f.handle({ url, method: 'POST', query: { action: 'health' }, headers: {}, body: { action: 'health' } }, res)
    assert.equal(res.code, 404)
  }
  assert.equal(f.calls.loaded.length, 1); assert.equal(f.calls.provider, 0)
})

test('file-based generation routing stays within Hobby function budget', () => {
  const files = readdirSync(resolve(root, 'api'), { recursive: true }).filter(path => path.endsWith('.ts'))
  assert.equal(files.length, 12, '10 entrypoints + 2 unchanged _lib modules; no more than 12 even if helpers counted')
  assert.equal(files.filter(path => !path.replaceAll('\\', '/').startsWith('_lib/')).length, 10)
  assert.deepEqual(readdirSync(resolve(root, 'api/james/generate')), ['[action].ts'])
  for (const name of names) {
    const source = read(`server-handlers/generate/${name}.ts`)
    assert.ok(source.includes('if (!await requireApiAuth(req, res)) return'))
    assert.ok(source.indexOf('requireApiAuth(req, res)') < source.indexOf('openai.chat.completions.create'))
  }
  const config = JSON.parse(read('vercel.json'))
  assert.equal(config.functions['api/**/*.ts'].maxDuration, 60)
  assert.deepEqual(config.crons, [{ path: '/api/keep-alive', schedule: '0 8 * * *' }])
  assert.deepEqual(config.rewrites, [{ source: '/((?!api/).*)', destination: '/index.html' }])
})
