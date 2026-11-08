// Independent synthetic adversarial review. No sockets, real providers, or app startup.
import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import core from '../shared/registry-search.cjs'

globalThis.fetch = async () => { throw new Error('Independent review prohibits network') }
const target = new URL('../shared/registry-search.cjs', import.meta.url)
const hash = () => createHash('sha256').update(readFileSync(target)).digest('hex')
const initialHash = hash()
const actor = '11111111-1111-4111-8111-111111111111'
const tenant = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const otherActor = '22222222-2222-4222-8222-222222222222'
const otherTenant = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const identity = () => ({ userId: actor, tenantId: tenant, appRole: 'operator' })
const env = () => ({ REGISTRY_SEARCH_ENABLED: 'true', REGISTRY_SEARCH_TERMS_APPROVED: 'true', REGISTRY_SEARCH_ARCHITECTURE_APPROVED: 'true', REGISTRY_SEARCH_TRANSIENT_DATA_APPROVED: 'true' })
const filters = () => ({ cnae_fiscal: '6201501', uf: 'SP', municipio: '3550308' })
const body = extra => ({ request_id: randomUUID(), expected_tenant_id: tenant, expected_provider: 'minha_receita', authorize_registry_query: true, filters: filters(), page_size: 10, cursor: null, ...extra })
const row = extra => ({ cnpj: 'ABCD1234EFGH56', razao_social: 'EMPRESA SINTETICA DE REVISAO', nome_fantasia: 'REVISAO SINTETICA', cnae_fiscal: 6201501, cnae_fiscal_descricao: 'Descricao sintetica', uf: 'SP', municipio: 'MUNICIPIO SINTETICO', codigo_municipio_ibge: 3550308, situacao_cadastral: 2, descricao_situacao_cadastral: 'ATIVA', data_situacao_cadastral: '2026-01-10', ddd_telefone_1: '11987654321', ddd_telefone_2: '', ...extra })
const response = (data, init = {}) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
function fixture({ data = { data: [row()] }, fetchImpl, config = {}, environment = env(), now = () => new Date('2026-11-08T12:00:00.000Z') } = {}) {
  const seen = []
  const adapter = core.createRegistrySearchAdapter({ env: environment, now, ...config, fetchImpl: async (...args) => { seen.push(args); return fetchImpl ? fetchImpl(...args) : response(data) } })
  return { adapter, seen, send: (input = body(), auth = identity()) => adapter.search({ auth, body: input }) }
}
async function rejects(operation, { status, code } = {}) {
  let error
  try { await operation } catch (caught) { error = caught }
  assert.ok(error instanceof Error, 'Expected sanitized failure, not success')
  if (status !== undefined) assert.equal(error.status, status)
  if (code !== undefined) assert.equal(error.code ?? error.message, code)
  return error
}
function assertPrivateAbsent(value) {
  const serialized = JSON.stringify(value)
  for (const forbidden of ['SECRET_REVIEW_QSA', 'SECRET_REVIEW_CPF', 'SECRET_REVIEW_PAYLOAD', '123.456.789-01', '12345678901', '***456789**']) assert.ok(!serialized.includes(forbidden), 'Private synthetic value escaped: ' + forbidden)
  function scan(current) {
    if (!current || typeof current !== 'object') return
    for (const [key, val] of Object.entries(current)) {
      assert.ok(!/^(qsa|cnpj_cpf_do_socio|cpf_representante_legal|nome_socio|capital_social|cnaes_secundarios)$/i.test(key), 'Additional source field escaped: ' + key)
      scan(val)
    }
  }
  scan(value)
}

test('independent: default and each missing governance gate prevent provider access', async t => {
  const defaultAdapter = core.createRegistrySearchAdapter({ fetchImpl: () => { assert.fail('Network attempted') } })
  await rejects(defaultAdapter.search({ auth: identity(), body: body() }))
  for (const key of Object.keys(env())) for (const value of [undefined, false, true, 'TRUE', 'false', '1', ' true ']) await t.test(key + '=' + String(value), async () => {
    const environment = env(); environment[key] = value
    const f = fixture({ environment }); await rejects(f.send()); assert.equal(f.seen.length, 0)
  })
})

test('independent: missing and malformed trusted identities fail before provider access', async t => {
  const invalid = [undefined, null, {}, { ...identity(), userId: '' }, { ...identity(), tenantId: otherTenant }, { ...identity(), appRole: 'viewer' }, { ...identity(), appRole: 'anonymous' }, { ...identity(), isAnonymous: true }]
  for (const [i, auth] of invalid.entries()) await t.test('identity ' + i, async () => {
    const f = fixture(); await rejects(f.adapter.search({ auth, body: body() })); assert.equal(f.seen.length, 0)
  })
})

test('independent: malformed request cannot broaden scope or inject provider input', async t => {
  const invalid = [null, [], {}, body({ authorize_registry_query: false }), body({ expected_provider: 'google_cse' }), body({ request_id: 'not-an-id' }), body({ expected_tenant_id: otherTenant }), body({ page_size: 0 }), body({ page_size: 11 }), body({ page_size: 1.1 }), body({ page_size: '1' }), body({ cursor: 'https://attacker.invalid/?cpf=12345678901' }), body({ url: 'https://attacker.invalid' }), body({ fields: ['qsa'] }), body({ filters: {} }), body({ filters: { ...filters(), uf: 'ZZ' } }), body({ filters: { ...filters(), uf: 'SP&x=1' } }), body({ filters: { ...filters(), municipio: '355030' } }), body({ filters: { ...filters(), municipio: 3550308 } }), body({ filters: { ...filters(), cnae_fiscal: '6201501,6201502' } }), body({ filters: { ...filters(), cnpj_cpf_do_socio: '12345678901' } })]
  for (const [i, input] of invalid.entries()) await t.test('request ' + i, async () => {
    const f = fixture(); await rejects(f.send(input)); assert.equal(f.seen.length, 0)
  })
})

test('independent: fetch boundary uses fixed origin and bounded GET with no auth or identity leaks', async () => {
  const f = fixture(); const input = body(); const result = await f.send(input)
  assert.equal(f.seen.length, 1)
  const [rawUrl, options] = f.seen[0], url = new URL(rawUrl)
  assert.equal(url.origin, 'https://minhareceita.org'); assert.equal(url.pathname, '/')
  assert.deepEqual([...url.searchParams.keys()].sort(), ['cnae_fiscal', 'limit', 'municipio', 'uf'])
  assert.equal(url.searchParams.get('limit'), '10'); assert.equal(url.searchParams.get('municipio'), '3550308')
  assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal)
  const wire = JSON.stringify([rawUrl, options]); assert.ok(!wire.includes(actor)); assert.ok(!wire.includes(tenant)); assert.ok(!wire.includes(input.request_id))
  assertPrivateAbsent(result)
})

test('independent: every row revalidates principal CNAE, UF and exact IBGE7, including later rows', async t => {
  const mutations = [{ cnae_fiscal: 6201502 }, { cnae_fiscal: null }, { cnae_fiscal: '' }, { uf: 'RJ' }, { uf: undefined }, { codigo_municipio_ibge: 3304557 }, { codigo_municipio_ibge: undefined, codigo_municipio: 3550308 }, { codigo_municipio_ibge: '3550308x' }]
  for (const [i, patch] of mutations.entries()) await t.test('row scope ' + i, async () => {
    const f = fixture({ data: { data: [row(), row({ cnpj: 'ZZZZ1234EFGH56', ...patch })] } })
    await rejects(f.send()); assert.equal(f.seen.length, 1)
  })
})

test('independent: malformed envelopes, rows and pagination fail rather than valid empty', async t => {
  const malformed = [null, [], {}, { data: null }, { data: {} }, { data: [null] }, { data: [[]] }, { data: [{}] }, { data: [row()], cursor: 3 }, { data: [row()], cursor: {} }, { data: [row()], cursor: [] }, { data: [row()], cursor: 'x'.repeat(3000) }, { data: Array.from({ length: 11 }, () => row()) }]
  for (const [i, data] of malformed.entries()) await t.test('schema ' + i, async () => {
    const f = fixture({ data }); await rejects(f.send()); assert.equal(f.seen.length, 1)
  })
})

test('independent: additions from source never appear in results or replay', async () => {
  const f = fixture({ data: { data: [row({ qsa: [{ nome_socio: 'SECRET_REVIEW_QSA', cnpj_cpf_do_socio: '12345678901', cpf_representante_legal: '***456789**' }], capital_social: 12345678901, cnaes_secundarios: [{ codigo: 12345678901 }], SECRET_REVIEW_PAYLOAD: 'SECRET_REVIEW_CPF' })], SECRET_REVIEW_PAYLOAD: 'SECRET_REVIEW_CPF' } })
  const input = body(); const result = await f.send(input); assertPrivateAbsent(result)
  const replay = await f.send(input); assertPrivateAbsent(replay); assert.deepEqual(replay, result); assert.equal(f.seen.length, 1)
})

test('independent: provider redirect, status failure and raw error do not leak or retry', async t => {
  for (const status of [301, 302, 307, 400, 401, 403, 404, 429, 500, 503]) await t.test('status ' + status, async () => {
    const f = fixture({ fetchImpl: () => response({ message: 'SECRET_REVIEW_CPF', qsa: 'SECRET_REVIEW_QSA' }, { status, headers: { 'location': 'https://attacker.invalid', 'retry-after': 'SECRET_REVIEW_CPF' } }) })
    const error = await rejects(f.send()); assertPrivateAbsent({ message: error.message, code: error.code, ...error }); assert.equal(f.seen.length, 1)
  })
  const f = fixture({ fetchImpl: () => { throw new Error('SECRET_REVIEW_CPF https://attacker.invalid/?token=SECRET_REVIEW_QSA') } })
  const error = await rejects(f.send()); assertPrivateAbsent({ message: error.message, code: error.code, ...error }); assert.equal(f.seen.length, 1)
})

test('independent: malformed JSON, fatal UTF8 and body overflow are sanitized', async t => {
  const bad = [new Response('{"data":', { headers: { 'content-type': 'application/json' } }), new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'content-type': 'application/json' } }), response({ data: [], marker: 'x'.repeat(256 * 1024) })]
  for (const [i, upstream] of bad.entries()) await t.test('body failure ' + i, async () => {
    const f = fixture({ fetchImpl: () => upstream }); await rejects(f.send()); assert.equal(f.seen.length, 1)
  })
})

test('independent: invalid CNPJ types and CPF-shaped identifiers never become company records', async t => {
  const invalid = [null, 12345678901234, '', '12345678901', '123.456.789-01', 'ABCDEFGHIJKLMN', 'ABCD1234EFGHA6', 'ABCD1234EFGH5Z', 'ABCD1234EFGH56/secret', 'ABCD1234EFGH56?cpf=12345678901', { toString: () => 'ABCD1234EFGH56' }]
  for (const [i, cnpj] of invalid.entries()) await t.test('CNPJ ' + i, async () => {
    const f = fixture({ data: { data: [row({ cnpj })] } }); await rejects(f.send()); assert.equal(f.seen.length, 1)
  })
})

test('independent: request replay is clone-protected and divergent request cannot execute', async () => {
  const f = fixture(), input = body(), result = await f.send(input), before = structuredClone(result)
  for (const key of Object.keys(result)) result[key] = 'MUTATED_REPLAY_RECEIPT'
  assert.deepEqual(await f.send(input), before); assert.equal(f.seen.length, 1)
  await rejects(f.send({ ...input, page_size: 9 })); assert.equal(f.seen.length, 1)
  await rejects(f.send({ ...input, filters: { ...filters(), cnae_fiscal: '6201502' } })); assert.equal(f.seen.length, 1)
})

test('independent: same request in flight cannot invoke upstream again', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve }), f = fixture({ fetchImpl: () => pending }), input = body()
  const first = f.send(input)
  await pause(0)
  const second = f.send(input); await pause(0); assert.equal(f.seen.length, 1)
  release(response({ data: [row()] })); const result = await first; assert.deepEqual(await second, result)
  assert.deepEqual(await f.send(input), result); assert.equal(f.seen.length, 1)
})

test('independent: input identity, query and operation id are captured before awaiting provider', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve }), f = fixture({ fetchImpl: () => pending })
  const auth = identity(), input = body(), originalInput = structuredClone(input), originalAuth = structuredClone(auth)
  const first = f.adapter.search({ auth, body: input }); await pause(0)
  auth.userId = otherActor; auth.tenantId = otherTenant; auth.appRole = 'viewer'
  input.request_id = randomUUID(); input.expected_tenant_id = otherTenant; input.page_size = 1; input.filters.uf = 'RJ'; input.filters.municipio = '3304557'; input.filters.cnae_fiscal = '9999999'
  release(response({ data: [row()] })); const result = await first
  const replay = await f.send(originalInput, originalAuth); assert.deepEqual(replay, result); assert.equal(f.seen.length, 1)
  assert.ok(!JSON.stringify(result).includes(otherTenant)); assert.ok(!JSON.stringify(result).includes(otherActor)); assert.ok(!JSON.stringify(result).includes('9999999'))
})

test('independent: failed provider leaves an uncertain request that cannot execute again', async () => {
  const f = fixture({ fetchImpl: () => { throw new Error('SECRET_REVIEW_PAYLOAD') } }), input = body()
  await rejects(f.send(input)); await rejects(f.send(input)); assert.equal(f.seen.length, 1)
})

test('independent: deadline covers slow headers and late completion cannot restore replay', async () => {
  let release
  const pending = new Promise(resolve => { release = resolve }), f = fixture({ config: { timeoutMs: 30 }, fetchImpl: () => pending }), input = body()
  const before = performance.now(); await rejects(f.send(input)); assert.ok(performance.now() - before < 1000)
  assert.ok(f.seen[0][1].signal.aborted)
  release(response({ data: [row()] })); await pause(10)
  await rejects(f.send(input)); assert.equal(f.seen.length, 1)
})

test('independent: deadline also covers a stalled response body', async () => {
  let cancelled = false
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"data":[')) }, cancel() { cancelled = true } })
  const f = fixture({ config: { timeoutMs: 30 }, fetchImpl: () => new Response(stream, { headers: { 'content-type': 'application/json' } }) }), input = body()
  const before = performance.now(); await rejects(f.send(input)); assert.ok(performance.now() - before < 1000)
  await pause(5); assert.ok(f.seen[0][1].signal.aborted); assert.equal(cancelled, true)
  await rejects(f.send(input)); assert.equal(f.seen.length, 1)
})

test('independent: authorization is checked again before serving replay', async () => {
  const environment = env(), f = fixture({ environment }), input = body()
  await f.send(input); environment.REGISTRY_SEARCH_TERMS_APPROVED = 'false'
  await rejects(f.send(input)); assert.equal(f.seen.length, 1)
})

test('independent: metadata never equates registry status or phone with activity, WhatsApp or permission', async () => {
  const f = fixture(), result = await f.send()
  assert.equal(result.source_extracted_at, null); assert.equal(result.fetched_at, '2026-11-08T12:00:00.000Z')
  assert.deepEqual(result.state, { whatsapp: 'unknown', activity: 'unknown', contact_permission: 'not_established' })
})

test('independent: internal cursor is scoped to actor, tenant, all filters and page size', async t => {
  const patches = [
    { identity: { ...identity(), userId: otherActor } },
    { identity: { ...identity(), tenantId: otherTenant }, input: { expected_tenant_id: otherTenant } },
    { input: { page_size: 9 } },
    { input: { filters: { ...filters(), cnae_fiscal: '6201502' } } },
    { input: { filters: { ...filters(), uf: 'RJ', municipio: '3304557' } } },
    { input: { filters: { ...filters(), municipio: '3509502' } } }
  ]
  for (const [i, patch] of patches.entries()) await t.test('cursor scope ' + i, async () => {
    const f = fixture({ data: { data: [row()], cursor: 'upstream-opaque-token' } }), first = await f.send()
    const cursor = first.pagination.next_cursor; assert.match(cursor, /^rsc_[A-Za-z0-9_-]{43}$/)
    assert.ok(!JSON.stringify(first).includes('upstream-opaque-token'))
    await rejects(f.send(body({ cursor, ...patch.input }), patch.identity ?? identity())); assert.equal(f.seen.length, 1)
  })
})

test('independent: cursor is single-use across request ids, including concurrent use', async () => {
  let release, count = 0
  const pending = new Promise(resolve => { release = resolve })
  const f = fixture({ fetchImpl: () => ++count === 1 ? response({ data: [row()], cursor: 'opaque-page-2' }) : pending })
  const first = await f.send(), input = body({ cursor: first.pagination.next_cursor }), second = f.send(input)
  await pause(0); await rejects(f.send(body({ cursor: input.cursor }))); assert.equal(f.seen.length, 2)
  release(response({ data: [row({ cnpj: 'ZZZZ1234EFGH56' })] })); const result = await second
  assert.deepEqual(await f.send(input), result); assert.equal(f.seen.length, 2)
  await rejects(f.send(body({ cursor: input.cursor }))); assert.equal(f.seen.length, 2)
  const secondUrl = new URL(f.seen[1][0]); assert.equal(secondUrl.searchParams.get('cursor'), 'opaque-page-2')
  assert.ok(!String(f.seen[1][0]).includes(input.cursor))
})

test('independent: cursor remains consumed after provider failure and cannot retry under fresh id', async () => {
  let calls = 0
  const f = fixture({ fetchImpl: () => ++calls === 1 ? response({ data: [], cursor: 'opaque-page-2' }) : Promise.reject(Error('synthetic failure')) })
  const first = await f.send(), input = body({ cursor: first.pagination.next_cursor })
  await rejects(f.send(input)); await rejects(f.send(input)); await rejects(f.send(body({ cursor: input.cursor }))); assert.equal(f.seen.length, 2)
})

test('independent: expired cursor cannot reopen scope even when a past receipt is replayed', async () => {
  let timestamp = Date.parse('2026-11-08T12:00:00Z')
  const f = fixture({ now: () => new Date(timestamp), data: { data: [], cursor: 'opaque-page-2' } }), input = body(), first = await f.send(input)
  timestamp += 10 * 60 * 1000 + 1
  await rejects(f.send(body({ cursor: first.pagination.next_cursor }))); assert.equal(f.seen.length, 1)
  try { await f.send(input) } catch { /* Refusing an expired receipt is also fail-closed. */ }
  assert.equal(f.seen.length, 1, 'Expired replay must not execute the original request again')
  await rejects(f.send(body({ cursor: first.pagination.next_cursor }))); assert.equal(f.seen.length, 1)
})

test('independent: session stops at thirty returned records without a follow-up fetch', async () => {
  let page = 0
  const f = fixture({ fetchImpl: () => { page++; return response({ data: Array.from({ length: 10 }, (_, i) => row({ cnpj: 'ABCD' + String(page * 10 + i).padStart(8, '0') + '56' })), cursor: 'opaque-page-' + page }) } })
  let cursor = null, last
  for (let i = 0; i < 3; i++) { last = await f.send(body({ cursor })); cursor = last.pagination.next_cursor }
  assert.equal(last.pagination.session_returned, 30); assert.equal(last.pagination.has_more, false); assert.equal(cursor, null); assert.equal(f.seen.length, 3)
})

test('independent: empty pages still exhaust the thirty-page session ceiling', async () => {
  let page = 0
  const f = fixture({ fetchImpl: () => response({ data: [], cursor: 'opaque-empty-' + (++page) }) })
  let cursor = null, last
  for (let i = 0; i < 30; i++) { last = await f.send(body({ cursor })); cursor = last.pagination.next_cursor }
  assert.equal(last.pagination.session_returned, 0); assert.equal(last.pagination.pages_fetched, 30); assert.equal(last.pagination.has_more, false); assert.equal(cursor, null); assert.equal(f.seen.length, 30)
})

test('independent: repeated opaque upstream cursor is detected and cannot loop', async () => {
  const f = fixture({ data: { data: [], cursor: 'upstream-repeating-cursor' } }), first = await f.send()
  const input = body({ cursor: first.pagination.next_cursor }); await rejects(f.send(input)); assert.equal(f.seen.length, 2)
  await rejects(f.send(input)); await rejects(f.send(body({ cursor: input.cursor }))); assert.equal(f.seen.length, 2)
})

test('independent: sixty-four outstanding sessions fill capacity without evicting prior scopes', async () => {
  const f = fixture({ data: { data: [], cursor: 'upstream-first-cursor' } }), firstInput = body(), first = await f.send(firstInput)
  for (let i = 1; i < 64; i++) await f.send()
  await rejects(f.send()); assert.equal(f.seen.length, 64)
  assert.deepEqual(await f.send(firstInput), first); assert.equal(f.seen.length, 64)
})

test('independent: request ledger saturates at 512 without evicting replay receipts', async () => {
  let page = 0, timestamp = Date.parse('2026-11-08T12:00:00Z')
  const f = fixture({ now: () => new Date(timestamp), fetchImpl: () => response({ data: [], cursor: 'ledger-opaque-' + (++page) }) }), firstInput = body()
  let first, cursor = null
  for (let i = 0; i < 512; i++) {
    const result = await f.send(i === 0 ? firstInput : body({ cursor }))
    if (i === 0) first = structuredClone(result)
    cursor = result.pagination.next_cursor
  }
  await rejects(f.send(body({ cursor }))); assert.equal(f.seen.length, 512)
  assert.deepEqual(await f.send(firstInput), first); assert.equal(f.seen.length, 512)
  timestamp += 600001
  await rejects(f.send()); await rejects(f.send(firstInput)); assert.equal(f.seen.length, 512, 'TTL may expire results, but cannot evict operation tombstones to reopen capacity')
})

test('independent: CPF-like strings embedded in company names are removed or rejected', async t => {
  const names = ['EMPRESA 12345678901', 'EMPRESA 123.456.789-01', 'EMPRESA***456789**', 'EMPRESA ***.456.789-**', 'EMPRESA12345678901', '12345678901EMPRESA', 'EMPRESA XXX.456.789-XX', 'EMPRESA \u2022\u2022\u2022.456.789-\u2022\u2022', 'EMPRESA \u25cf\u25cf\u25cf.456.789-\u25cf\u25cf', 'EMPRESA \uff11\uff12\uff13\uff14\uff15\uff16\uff17\uff18\uff19\uff10\uff11']
  for (const name of names) await t.test(name, async () => {
    const f = fixture({ data: { data: [row({ razao_social: name, nome_fantasia: name })] } })
    try { const result = await f.send(); assertPrivateAbsent(result); assert.ok(!JSON.stringify(result).includes(name), 'CPF-bearing name escaped') } catch (error) { if (!(error instanceof core.RegistrySearchError)) throw error }
  })
})

test('independent: invalid calendar dates cannot become claimed registry timestamps', async t => {
  for (const date of ['2026-02-30', '2025-02-29', '2026-13-01', '2026-00-01', '2026-01-00', '2026-01-32', '2026-01-01T00:00:00Z', 20260101, {}, true]) await t.test(String(date), async () => {
    const f = fixture({ data: { data: [row({ data_situacao_cadastral: date })] } }); const result = await f.send(); assert.equal(result.results[0].situacao_cadastral.data, null); assert.equal(result.source_extracted_at, null)
  })
})

test('independent: uncertain ledger entry does not expire into another upstream execution', async () => {
  let timestamp = Date.parse('2026-11-08T12:00:00Z')
  const f = fixture({ now: () => new Date(timestamp), fetchImpl: () => { throw new Error('synthetic uncertain outcome') } }), input = body()
  await rejects(f.send(input)); timestamp += 10 * 60 * 1000 + 1
  await rejects(f.send(input)); assert.equal(f.seen.length, 1, 'Uncertain request must remain blocked beyond cursor TTL')
})

test('independent: invalid UTF8 inside otherwise valid JSON is rejected, not replaced silently', async () => {
  const prefix = new TextEncoder().encode(JSON.stringify({ data: [row({ nome_fantasia: 'UTF8_MARKER' })] }))
  const marker = new TextEncoder().encode('UTF8_MARKER'), start = Buffer.from(prefix).indexOf(Buffer.from(marker))
  assert.ok(start > 0)
  const bytes = new Uint8Array(prefix.length - marker.length + 2)
  bytes.set(prefix.slice(0, start)); bytes.set([0xc3, 0x28], start); bytes.set(prefix.slice(start + marker.length), start + 2)
  const f = fixture({ fetchImpl: () => new Response(bytes, { headers: { 'content-type': 'application/json' } }) })
  await rejects(f.send()); assert.equal(f.seen.length, 1)
})

test('independent: frozen caller inputs are not mutated', async () => {
  const input = Object.freeze({ ...body(), filters: Object.freeze(filters()) }), auth = Object.freeze(identity()), environment = Object.freeze(env())
  const f = fixture({ environment }); await f.send(input, auth); assert.equal(f.seen.length, 1)
})

test('independent: formatted numeric and alphanumeric CNPJ preserve literal with separate key', async t => {
  for (const [literal, key] of [['AB.CD1.234/EFGH-56', 'ABCD1234EFGH56'], ['12.345.678/0001-90', '12345678000190'], ['ABCD1234EFGH56', 'ABCD1234EFGH56']]) await t.test(literal, async () => {
    const f = fixture({ data: { data: [row({ cnpj: literal })] } }), result = await f.send()
    assert.equal(result.results[0].cnpj, literal); assert.equal(result.results[0].cnpj_key, key); assert.equal(result.results[0].cnpj_validation, 'syntax_only')
  })
})

test('independent: missing optional source values remain absent rather than invented', async () => {
  const f = fixture({ data: { data: [{ cnpj: 'ABCD1234EFGH56', cnae_fiscal: 6201501, uf: 'SP', codigo_municipio_ibge: 3550308 }] } }), result = await f.send(), record = result.results[0]
  assert.equal(record.razao_social, null); assert.equal(record.nome_fantasia, null); assert.equal(record.municipio.nome, null)
  assert.equal(record.cnae_fiscal.descricao, null); assert.deepEqual(record.situacao_cadastral, { descricao: null, data: null }); assert.deepEqual(record.phone_evidence, [])
  assert.equal(record.source.source_extracted_at, null)
})

test('independent: duplicate CNPJ canonical identities in one page or later page fail closed', async () => {
  const f = fixture({ data: { data: [row(), row({ cnpj: 'AB.CD1.234/EFGH-56' })] } }); await rejects(f.send())
  let page = 0
  const g = fixture({ fetchImpl: () => response({ data: [row({ cnpj: ++page === 1 ? 'ABCD1234EFGH56' : 'AB.CD1.234/EFGH-56' })], cursor: 'opaque-duplicate-' + page }) }), first = await g.send()
  await rejects(g.send(body({ cursor: first.pagination.next_cursor }))); assert.equal(g.seen.length, 2)
})

test('independent: remaining session budget narrows the last outbound page limit', async () => {
  let page = 0
  const f = fixture({ fetchImpl: rawUrl => { page++; const limit = Number(new URL(rawUrl).searchParams.get('limit')); return response({ data: Array.from({ length: limit }, (_, i) => row({ cnpj: 'ABCD' + String(page * 10 + i).padStart(8, '0') + '56' })), cursor: 'budget-opaque-' + page }) } })
  let cursor = null, last
  for (let i = 0; i < 4; i++) { last = await f.send(body({ page_size: 8, cursor })); cursor = last.pagination.next_cursor }
  assert.deepEqual(f.seen.map(([url]) => new URL(url).searchParams.get('limit')), ['8', '8', '8', '6'])
  assert.equal(last.pagination.session_returned, 30); assert.equal(cursor, null)
})

test('independent: production default deadline is eight seconds and aborts a never-ending fetch', async () => {
  const f = fixture({ fetchImpl: () => new Promise(() => {}) }), input = body(), start = performance.now()
  const error = await rejects(f.send(input), { status: 504, code: 'registry_timeout' }), elapsed = performance.now() - start
  assert.ok(elapsed >= 7900 && elapsed < 10000, 'Default deadline elapsed: ' + elapsed)
  assert.ok(f.seen[0][1].signal.aborted); assert.equal(f.seen.length, 1); assertPrivateAbsent({ message: error.message, code: error.code })
  await rejects(f.send(input)); assert.equal(f.seen.length, 1)
})

test('independent: a reentrant trusted fetch never observes an uninitialized receipt promise', async () => {
  let nested
  const input = body(), f = fixture({ fetchImpl: () => { nested = f.send(input); return response({ data: [row()] }) } })
  const first = await f.send(input), second = await nested
  assert.deepEqual(second, first); assert.equal(f.seen.length, 1)
})

test('independent: source hash remains unchanged throughout independent execution', () => { assert.equal(hash(), initialHash) })
