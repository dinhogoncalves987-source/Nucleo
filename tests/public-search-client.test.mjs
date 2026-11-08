import test from 'node:test'
import assert from 'node:assert/strict'
import { getPublicSearchCapabilities, submitPublicSearch, isPublicSourceUrl, PublicSearchFailure } from '../src/lib/public-search-client.ts'

const requestId = '8f067376-7207-4e37-b50c-89e71d1c3e21'
const capabilities = { tenant_id: 'tenant-a', enabled: true, provider: 'duckduckgo_instant_answer', configured: true, reason: null, requires_query_authorization: true, limitations: ['Limited source'] }
const result = () => ({ request_id: requestId, tenant_id: 'tenant-a', query: 'salões Curitiba', provider: capabilities.provider, searched_at: '2026-11-08T12:00:00.000Z', results: [{ title: 'Source', snippet: 'Telefone: (41) 3333-4444', url: 'https://www.duckduckgo.com/example', phone_evidence: [{ raw: '(41) 3333-4444', normalized: '+554133334444', excerpt: 'Telefone: (41) 3333-4444' }] }], limitations: ['Limited source'], state: { whatsapp: 'unknown', activity: 'unknown', contact_permission: 'not_established' } })
const response = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
const context = (transport = async () => response(result())) => ({ transport, identity: { tenantId: 'tenant-a', userId: 'user-a' }, isCurrent: () => true, capabilities, query: 'salões Curitiba', authorized: true, requestId })

test('capabilities uses only authenticated injected GET and validates tenant', async () => {
  let calls = 0
  const ctx = context(async (path, init) => { calls++; assert.equal(path, '/api/search/capabilities'); assert.equal(init.method, 'GET'); assert.equal(init.body, undefined); assert.equal(init.cache, 'no-store'); return response(capabilities) })
  assert.deepEqual(await getPublicSearchCapabilities(ctx), capabilities)
  assert.equal(calls, 1)
  for (const patch of [{ tenant_id: 'foreign' }, { requires_query_authorization: false }, { provider: 'other' }, { configured: 'yes' }, { limitations: null }]) {
    await assert.rejects(getPublicSearchCapabilities(context(async () => response({ ...capabilities, ...patch }))), PublicSearchFailure)
  }
})
test('disabled capabilities are honestly unavailable', async () => {
  const caps = await getPublicSearchCapabilities(context(async () => response({ ...capabilities, enabled: false, configured: false, reason: 'search_disabled' })))
  assert.equal(caps.enabled, false)
  let calls = 0
  await assert.rejects(submitPublicSearch({ ...context(async () => { calls++; return response(result()) }), capabilities: caps }), PublicSearchFailure)
  assert.equal(calls, 0)
})
test('authorization, identity and query validation happen before transport', async () => {
  let calls = 0
  const ctx = context(async () => { calls++; return response(result()) })
  for (const patch of [{ authorized: false }, { authorized: 'true' }, { isCurrent: () => false }, { identity: { tenantId: '', userId: 'u' } }, { identity: { tenantId: 'tenant-a', userId: '' } }, { query: ' ' }, { query: 'a'.repeat(201) }, { query: 'a\nb' }, { requestId: 'not-uuid' }, { capabilities: { ...capabilities, tenant_id: 'foreign' } }]) {
    await assert.rejects(submitPublicSearch({ ...ctx, ...patch }), PublicSearchFailure)
  }
  assert.equal(calls, 0)
})
test('POST carries only authorized query and binds identity, provider and request', async () => {
  const ctx = context(async (path, init) => {
    assert.equal(path, '/api/search'); assert.equal(init.method, 'POST')
    assert.deepEqual(JSON.parse(init.body), { query: 'salões Curitiba', expected_tenant_id: 'tenant-a', expected_provider: capabilities.provider, authorize_public_query: true, request_id: requestId })
    return response(result())
  })
  assert.deepEqual(await submitPublicSearch(ctx), result())
})
test('late responses after identity switch are discarded for GET and POST', async () => {
  for (const fn of [getPublicSearchCapabilities, submitPublicSearch]) {
    let current = true
    const ctx = { ...context(async () => { current = false; return response(fn === submitPublicSearch ? result() : capabilities) }), isCurrent: () => current }
    await assert.rejects(fn(ctx), /Identidade alterada/)
  }
})
test('foreign, malformed and contact-promoting results fail closed', async () => {
  for (const patch of [{ request_id: 'other' }, { tenant_id: 'other' }, { query: 'other' }, { provider: 'google_cse' }, { searched_at: 'yesterday' }, { results: null }, { results: Array(11).fill(result().results[0]) }, { limitations: [123] }, { state: { ...result().state, contact_permission: 'granted' } }, { state: { ...result().state, whatsapp: 'verified' } }, { state: { ...result().state, activity: 'active' } }]) {
    await assert.rejects(submitPublicSearch(context(async () => response({ ...result(), ...patch }))), PublicSearchFailure)
  }
  for (const patch of [{ title: {} }, { snippet: null }, { phone_evidence: [{ raw: '123', normalized: '+554133334444', excerpt: 'unrelated' }] }, { url: 'javascript:alert(1)' }]) {
    await assert.rejects(submitPublicSearch(context(async () => response({ ...result(), results: [{ ...result().results[0], ...patch }] }))), PublicSearchFailure)
  }
})
test('zero results remain zero without synthetic substitutes', async () => {
  const found = await submitPublicSearch(context(async () => response({ ...result(), results: [] })))
  assert.deepEqual(found.results, [])
  assert.equal(found.state.contact_permission, 'not_established')
})
test('unsafe source URLs rejected including IP normalization and credentials', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://user:pass@public.org', 'https://127.0.0.1', 'https://2130706433', 'https://0x7f000001', 'https://192.168.1.1', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://localhost.', 'https://host.internal', 'https://host.local', 'https://intranet', 'https://public.org:444', 'https://public.org\\@127.0.0.1']) assert.equal(isPublicSourceUrl(url), false, url)
  assert.equal(isPublicSourceUrl('https://www.duckduckgo.com/?q=public'), true)
})
test('throw, malformed JSON and error body are sanitized without retry', async () => {
  for (const fake of [async () => { throw Error('secret raw error') }, async () => new Response('secret raw error'), async () => new Response('{"error":"secret raw error"}', { status: 500 }), async () => new Response('{}', { status: 409 })]) {
    let calls = 0
    await assert.rejects(submitPublicSearch(context(async (...args) => { calls++; return fake(...args) })), error => error instanceof PublicSearchFailure && !error.message.includes('secret'))
    assert.equal(calls, 1)
  }
})
test('hard deadline bounds even a transport ignoring abort; no retry', async () => {
  let calls = 0, signal
  await assert.rejects(submitPublicSearch({ ...context(async (_, init) => { calls++; signal = init.signal; return new Promise(() => {}) }), timeoutMs: 5 }), /excedeu o prazo/)
  assert.equal(calls, 1); assert.equal(signal.aborted, true)
})
test('abort before send prevents transport; abort during body prevents result', async () => {
  const first = new AbortController(); first.abort()
  let calls = 0
  await assert.rejects(submitPublicSearch({ ...context(async () => { calls++; return response(result()) }), signal: first.signal }), /cancelada/)
  assert.equal(calls, 0)
  const second = new AbortController()
  await assert.rejects(submitPublicSearch({ ...context(async () => ({ ok: true, json: async () => { second.abort(); return result() } })), signal: second.signal }), /cancelada/)
})
test('query whitespace normalized; original overlength or C0/C1/DEL rejected', async () => {
  assert.equal((await submitPublicSearch({ ...context(), query: '  salões   Curitiba  ' })).query, 'salões Curitiba')
  for (const query of ['a\u0000b', 'a\u007fb', 'a\u0085b', ' '.repeat(201) + 'q']) await assert.rejects(submitPublicSearch({ ...context(), query }), PublicSearchFailure)
})
test('capabilities reason must be known and coherent', async () => {
  for (const patch of [{ reason: 'raw arbitrary error' }, { enabled: false, reason: null }, { enabled: true, reason: 'search_disabled' }, { configured: false }, { enabled: false, reason: 'google_budget_not_approved' }, { enabled: false, reason: 'provider_not_configured' }, { enabled: false, reason: 'provider_not_supported' }]) {
    await assert.rejects(getPublicSearchCapabilities(context(async () => response({ ...capabilities, ...patch }))), PublicSearchFailure)
  }
  const google = { ...capabilities, enabled: false, provider: 'google_cse', reason: 'google_budget_not_approved' }
  assert.deepEqual(await getPublicSearchCapabilities(context(async () => response(google))), google)
})
test('phone evidence must bind unchanged digits and explicit valid DDD to source snippet', async () => {
  for (const raw of ['(11) 91234-5678', '+55 (11) 91234-5678']) {
    const row = { ...result().results[0], snippet: raw, phone_evidence: [{ raw, normalized: '+5511912345678', excerpt: raw }] }
    assert.equal((await submitPublicSearch(context(async () => response({ ...result(), results: [row] })))).results.length, 1)
  }
  for (const patch of [{ raw: '(41) 3333-4444', normalized: '+554133334445' }, { raw: '(20) 3333-4444', normalized: '+552033334444', excerpt: '(20) 3333-4444' }, { raw: '3333-4444', normalized: '+554133334444', excerpt: '3333-4444' }, { raw: '(41) 3333-4444', normalized: '+5541933334444' }]) {
    const p = { ...result().results[0].phone_evidence[0], ...patch }
    await assert.rejects(submitPublicSearch(context(async () => response({ ...result(), results: [{ ...result().results[0], snippet: p.excerpt, phone_evidence: [p] }] }))), PublicSearchFailure)
  }
  for (const patch of [{ title: ' ' }, { snippet: 'No phone on this source' }]) await assert.rejects(submitPublicSearch(context(async () => response({ ...result(), results: [{ ...result().results[0], ...patch }] }))), PublicSearchFailure)
})
test('provider commercial and retirement reasons remain unavailable and never send queries', async () => {
  for (const reason of ['google_eligibility_unconfirmed', 'google_provider_retired', 'duckduckgo_commercial_approval_required']) {
    const provider = reason.startsWith('google_') ? 'google_cse' : 'duckduckgo_instant_answer'
    for (const configured of (provider === 'google_cse' ? [true, false] : [true])) {
      const expected = { ...capabilities, enabled: false, provider, configured, reason }
      const actual = await getPublicSearchCapabilities(context(async () => response(expected)))
      assert.deepEqual(actual, expected)
      let calls = 0
      const ctx = { ...context(async () => { calls++; return response(result()) }), capabilities: actual }
      await assert.rejects(submitPublicSearch(ctx), PublicSearchFailure)
      // A declared blocking reason cannot be bypassed by an inconsistent enabled flag.
      await assert.rejects(submitPublicSearch({ ...ctx, capabilities: { ...actual, enabled: true, configured: true } }), PublicSearchFailure)
      assert.equal(calls, 0)
      const incompatible = provider === 'google_cse' ? 'duckduckgo_instant_answer' : 'google_cse'
      await assert.rejects(getPublicSearchCapabilities(context(async () => response({ ...expected, provider: incompatible }))), PublicSearchFailure)
      await assert.rejects(getPublicSearchCapabilities(context(async () => response({ ...expected, enabled: true }))), PublicSearchFailure)
    }
  }
  await assert.rejects(getPublicSearchCapabilities(context(async () => response({ ...capabilities, enabled: false, configured: false, reason: 'duckduckgo_commercial_approval_required' }))), PublicSearchFailure)
})
test('server failures distinguish safe allowlisted codes without retries or accepting results', async () => {
  const cases = [
    [503, 'request_ledger_full', /Capacidade de controle de consultas esgotada/],
    [409, 'request_id_conflict', /Identificador.*dados diferentes/],
    [409, 'request_in_progress', /já está em andamento/],
    [409, 'request_outcome_uncertain', /resultado.*incerto/],
    [409, 'provider_changed', /A fonte mudou/],
    [409, 'tenant_changed', /A empresa mudou/],
    [502, 'provider_response_invalid', /fonte retornou uma resposta inválida/],
  ]
  for (const [status, error, expected] of cases) {
    let calls = 0
    await assert.rejects(submitPublicSearch(context(async () => { calls++; return new Response(JSON.stringify({ error, detail: 'secret raw error', ...result() }), { status }) })), err => err instanceof PublicSearchFailure && expected.test(err.message) && !err.message.includes('secret'))
    assert.equal(calls, 1)
  }
})
test('unknown, malformed or mismatched error bodies never imply changed identity or expose server prose', async () => {
  for (const [status, body] of [[409, '{}'], [409, '{broken secret'], [409, 'null'], [409, '[]'], [409, '"request_in_progress"'], [409, '{"error":{"message":"secret"}}'], [409, '{"error":"secret raw error"}'], [500, '{"error":"tenant_changed"}'], [502, '{"error":"request_in_progress"}']]) {
    let calls = 0
    await assert.rejects(submitPublicSearch(context(async () => { calls++; return new Response(body, { status }) })), err => err instanceof PublicSearchFailure && err.message === 'Busca indisponível no servidor. Nenhum resultado foi aceito e nenhuma nova tentativa foi enviada.')
    assert.equal(calls, 1)
  }
})
test('malformed success JSON is rejected rather than treated as an empty successful search', async () => {
  for (const body of ['{}', 'null', '[]', '{broken', '{"error":"provider_response_invalid"}']) {
    let calls = 0
    await assert.rejects(submitPublicSearch(context(async () => { calls++; return new Response(body, { status: 200 }) })), PublicSearchFailure)
    assert.equal(calls, 1)
  }
})
