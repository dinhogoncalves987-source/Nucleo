import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import registry from '../shared/registry-search.cjs'
const { createRegistrySearchAdapter, RegistrySearchError, LIMITS } = registry
const auth = { userId: '11111111-1111-4111-8111-111111111111', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', appRole: 'operator' }
const filters = { cnae_fiscal: '6201501', uf: 'SP', municipio: '3550308' }
const enabled = { REGISTRY_SEARCH_ENABLED: 'true', REGISTRY_SEARCH_TERMS_APPROVED: 'true', REGISTRY_SEARCH_ARCHITECTURE_APPROVED: 'true', REGISTRY_SEARCH_TRANSIENT_DATA_APPROVED: 'true' }
let serial = 0
function id() { return '12345678-1234-4123-8123-' + String(++serial).padStart(12, '0') }
function body(overrides = {}) { return { request_id: id(), expected_tenant_id: auth.tenantId, expected_provider: 'minha_receita', authorize_registry_query: true, filters: { ...filters }, page_size: 10, cursor: null, ...overrides } }
function row(overrides = {}) { return { cnpj: '00.000.000/0001-00', razao_social: 'Empresa Sintética', nome_fantasia: 'Fixture', uf: 'SP', municipio: 'Município Sintético', codigo_municipio_ibge: 3550308, codigo_municipio: 7107, cnae_fiscal: 6201501, cnae_fiscal_descricao: 'Serviço sintético', descricao_situacao_cadastral: 'ATIVA', data_situacao_cadastral: '2020-02-29', ddd_telefone_1: '1133334444', ...overrides } }
function fixture(options = {}) {
  let calls = 0, current = new Date('2026-11-08T00:00:00Z'), responder = () => ({ data: [row()] })
  const requests = []
  const api = createRegistrySearchAdapter({ ...options, env: { ...enabled, ...options.env }, now: () => current,
    fetchImpl: async (url, init) => {
      calls++; requests.push({ url, init })
      const value = await responder(url, init)
      if (value instanceof Response) return value
      return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } })
    }
  })
  return { api, requests, calls: () => calls, set: value => { responder = typeof value === 'function' ? value : () => value }, setTime: value => { current = value }, search: b => api.search({ auth, body: b === undefined ? body() : b }) }
}
async function rejects(promise, status, code) { await assert.rejects(promise, error => error instanceof RegistrySearchError && error.status === status && error.code === code && error.message === code) }

test('isolated module has no application wiring, startup, database, persistence or public-search imports', () => {
  const source = readFileSync(new URL('../shared/registry-search.cjs', import.meta.url), 'utf8')
  assert.ok(!/require\((?!['"]node:crypto['"])[^)]/.test(source))
  assert.ok(!/\bconsole\.|\bprocess\.env|writeFile|appendFile|setInterval|\.listen\(/.test(source))
})

test('disabled by default and each approval gate independently blocks before fetch', async t => {
  let calls = 0
  const def = createRegistrySearchAdapter({ fetchImpl: async () => { calls++; throw Error('must not call') } })
  assert.equal(def.capabilities(auth).enabled, false)
  await rejects(def.search({ auth, body: body() }), 503, 'registry_search_disabled')
  for (const [key, reason] of [['REGISTRY_SEARCH_ENABLED','registry_search_disabled'],['REGISTRY_SEARCH_TERMS_APPROVED','registry_terms_approval_required'],['REGISTRY_SEARCH_ARCHITECTURE_APPROVED','registry_architecture_approval_required'],['REGISTRY_SEARCH_TRANSIENT_DATA_APPROVED','registry_transient_data_approval_required']]) {
    await t.test(key, async () => {
      const f = fixture({ env: { [key]: undefined } })
      assert.equal(f.api.capabilities(auth).reason, reason)
      await rejects(f.search(), 503, reason); assert.equal(f.calls(), 0)
    })
  }
  assert.equal(calls, 0)
})

test('trusted identity still requires UUID user and tenant, role and non-anonymous identity', async t => {
  for (const [changes, status, code] of [[{ userId: '' },401,'authentication_required'],[{ userId: 'plain-user' },401,'authentication_required'],[{ tenantId: '' },403,'tenant_required'],[{ appRole: 'viewer' },403,'role_forbidden'],[{ isAnonymous: true },401,'authentication_required']]) {
    await t.test(JSON.stringify(changes), async () => { const f = fixture(); await rejects(f.api.search({ auth: { ...auth, ...changes }, body: body() }), status, code); assert.equal(f.calls(), 0) })
  }
  assert.throws(() => fixture().api.capabilities(undefined), { status: 401 })
})

test('exact request and strict scope prevent broad, ambiguous or unauthorised query', async t => {
  const cases = [
    [null,'invalid_registry_request'], [[], 'invalid_registry_request'], [{ ...body(), extra: true },'invalid_registry_request'],
    [body({ authorize_registry_query: false }), 'registry_query_authorization_required'], [body({ request_id: 'id' }), 'invalid_request_id'],
    [body({ page_size: 0 }),'invalid_registry_page_size'], [body({ page_size: 11 }),'invalid_registry_page_size'], [body({ page_size: 1.5 }),'invalid_registry_page_size'],
    [body({ cursor: 'upstream-cursor' }),'invalid_registry_cursor'],
    ...[{},{...filters,cnae_fiscal:'6201-5/01'},{...filters,uf:'sp'},{...filters,municipio:'7107'},{...filters,municipio:'3304557'},{...filters,cnae:filters.cnae_fiscal},{...filters,municipio:3550308}].map(value => [body({ filters: value }),'invalid_registry_filters'])
  ]
  for (const [input, code] of cases) await t.test(code, async () => { const f = fixture(); await rejects(f.search(input), 400, code); assert.equal(f.calls(), 0) })
  const f = fixture()
  await rejects(f.search(body({ expected_tenant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })),409,'tenant_changed')
  await rejects(f.search(body({ expected_provider: 'google_cse' })),409,'provider_changed'); assert.equal(f.calls(),0)
})

test('allowlist preserves honest origin, separate dates and unproven contact state; strips extra fields', async () => {
  const f = fixture()
  f.set({ data: [row({ qsa: [{ cpf: 'SENSITIVE_QSA_SENTINEL' }], cpf: 'SENSITIVE_CPF_SENTINEL', email: 'private@example.invalid', logradouro: 'PRIVATE_ADDRESS_SENTINEL', updated: '2026-11-08', url: 'https://evil.invalid/CPF' })], qsa: 'ENVELOPE_SENTINEL' })
  const result = await f.search()
  assert.equal(result.fetched_at,'2026-11-08T00:00:00.000Z'); assert.equal(result.source_extracted_at,null)
  assert.deepEqual(result.state,{ whatsapp:'unknown',activity:'unknown',contact_permission:'not_established' })
  assert.equal(result.results[0].situacao_cadastral.data,'2020-02-29')
  assert.equal(result.results[0].source.source_extracted_at,null)
  assert.equal(result.results[0].source.origin,'https://minhareceita.org/'); assert.equal(result.results[0].source.upstream,'Receita Federal')
  assert.equal(result.results[0].cnpj,'00.000.000/0001-00'); assert.equal(result.results[0].cnpj_key,'00000000000100')
  assert.equal(result.results[0].cnpj_validation,'syntax_only')
  assert.deepEqual(result.results[0].phone_evidence,[{source_field:'ddd_telefone_1',raw:'1133334444',normalized:'+551133334444',evidence_type:'registry_phone',ownership:'unverified'}])
  const text = JSON.stringify(result)
  for (const sentinel of ['SENSITIVE_', 'PRIVATE_', 'ENVELOPE_SENTINEL','private@example.invalid','evil.invalid']) assert.ok(!text.includes(sentinel))
  const request = new URL(f.requests[0].url)
  assert.equal(request.origin,'https://minhareceita.org'); assert.equal(request.pathname,'/')
  assert.deepEqual(Object.fromEntries(request.searchParams),{ cnae_fiscal:'6201501',uf:'SP',municipio:'3550308',limit:'10' })
  assert.equal(f.requests[0].init.redirect,'error'); assert.equal(f.requests[0].init.credentials,'omit')
})

test('possible CPF is omitted from every text field without fabricating a name', async t => {
  for (const value of ['Pessoa 123.456.789-01','Pessoa 12345678901','Pessoa 123 456 789 01','Pessoa 123 / 456 / 789 / 01','Pessoa １２３４５６７８９０１','EMPRESA***456789**','EMPRESA ***.456.789-**','EMPRESA XXX.456.789-XX','EMPRESA ●●●.456.789-●●']) {
    await t.test(value, async () => {
      const f = fixture(); f.set({ data: [row({ razao_social:value,nome_fantasia:value,municipio:value,cnae_fiscal_descricao:value,descricao_situacao_cadastral:value })] })
      const result = await f.search(), item = result.results[0]
      assert.equal(item.razao_social,null); assert.equal(item.nome_fantasia,null); assert.equal(item.municipio.nome,null); assert.equal(item.cnae_fiscal.descricao,null); assert.equal(item.situacao_cadastral.descricao,null)
      assert.equal(item.omitted_fields.length,5); assert.ok(item.omitted_fields.every(field => field.reason === 'possible_personal_identifier'))
      assert.ok(!JSON.stringify(result).includes(value))
    })
  }
})

test('optional absent or invalid fields stay null; dates and names are not invented', async () => {
  const f = fixture()
  f.set({ data: [{ cnpj:'00000000000100',uf:'SP',cnae_fiscal:'6201501',codigo_municipio_ibge:'3550308' }] })
  const item = (await f.search()).results[0]
  assert.equal(item.razao_social,null); assert.equal(item.nome_fantasia,null); assert.equal(item.municipio.nome,null); assert.equal(item.situacao_cadastral.data,null); assert.deepEqual(item.phone_evidence,[])
  f.set({ data: [row({ razao_social:'invalid\nname',nome_fantasia:'x'.repeat(201),data_situacao_cadastral:'2026-02-30' })] })
  const invalid = (await f.search()).results[0]
  assert.equal(invalid.situacao_cadastral.data,null); assert.equal(invalid.omitted_fields.length,2)
})

test('CNPJ literal and separate key accept numeric/alpha syntax only; no number or CPF coercion', async t => {
  for (const value of ['00000000000100','00.000.000/0001-00','12.ABC.345/01DE-35','12ABC34501DE35']) {
    await t.test(value, async () => {
      const f = fixture(); f.set({ data:[row({cnpj:value})] }); const item=(await f.search()).results[0]
      assert.equal(item.cnpj,value); assert.equal(item.cnpj_key,value.replace(/[./-]/g,'')); assert.equal(item.cnpj_validation,'syntax_only')
    })
  }
  for (const value of [12345678901,'12345678901','123.456.789-01','12abc34501de35','12.ABC.345/01DE-3A',' 00000000000100','00000000000100 ','0'.repeat(15),null]) {
    await t.test(String(value),async () => { const f=fixture();f.set({data:[row({cnpj:value})]});await rejects(f.search(),502,'registry_response_invalid') })
  }
})

test('telephone extraction is restricted to coherent explicit fields; never scans names or QSA', async () => {
  const f = fixture()
  for (const value of ['12345678901','123.456.789-01','0033334444','11111111111','11912345678 ramal 1','+5511912345678','fone 1133334444',1133334444]) {
    f.set({data:[row({ddd_telefone_1:value,ddd_telefone_2:value,nome_fantasia:'ligue 1133334444',qsa:[{telefone:'11912345678'}]})]})
    assert.deepEqual((await f.search()).results[0].phone_evidence,[])
  }
  f.set({data:[row({ddd_telefone_1:'(11) 91234-5678',ddd_telefone_2:'11912345678'})]})
  assert.equal((await f.search()).results[0].phone_evidence.length,1)
})

test('each row must independently match all filters; SIAFI/name cannot substitute for IBGE', async t => {
  for (const changes of [{uf:'RJ'},{uf:undefined},{cnae_fiscal:'6201502'},{cnae_fiscal:undefined},{codigo_municipio_ibge:'3304557'},{codigo_municipio_ibge:undefined,codigo_municipio:3550308},{codigo_municipio_ibge:'3550308 extra'}]) {
    await t.test(JSON.stringify(changes),async () => {const f=fixture();f.set({data:[row(),row({cnpj:'00000000000200',...changes})]});await rejects(f.search(),502,'registry_scope_unverified')})
  }
  const f=fixture();f.set({data:[row({cnae_fiscal:111301})]})
  assert.equal((await f.search(body({filters:{...filters,cnae_fiscal:'0111301'}}))).results[0].cnae_fiscal.codigo,'0111301')
})

test('invalid envelope is never disguised as no results', async t => {
  for (const value of [{},[],null,{data:{}},{data:[null]},{data:[row(),row()]},{data:[],cursor:''},{data:[],cursor:42},{data:[],cursor:'x\n'},{data:[],error:'private upstream reason'},{data:[row(),row({cnpj:'00000000000200'})]}]) {
    await t.test(JSON.stringify(value),async () => {const f=fixture();f.set(value);await rejects(f.search(body({page_size:1})),502,'registry_response_invalid')})
  }
  const f=fixture();f.set({data:[]});const r=await f.search();assert.equal(r.results.length,0);assert.equal(r.pagination.has_more,false)
})

test('an empty/short page with source cursor still continues; source cursor is opaque and internal', async () => {
  const f=fixture();f.set({data:[],cursor:'opaque+/=source'})
  const first=await f.search();assert.equal(first.pagination.has_more,true);assert.match(first.pagination.next_cursor,/^rsc_[\w-]{43}$/)
  assert.ok(!JSON.stringify(first).includes('opaque+/=source'))
  f.set({data:[row()]})
  const next=await f.search(body({cursor:first.pagination.next_cursor}))
  assert.equal(new URL(f.requests[1].url).searchParams.get('cursor'),'opaque+/=source')
  assert.equal(next.pagination.has_more,false);assert.equal(next.pagination.stop_reason,'source_exhausted')
})

test('same request is coalesced concurrently and replayed without provider call or shared mutable output', async () => {
  const f=fixture();let resolve;f.set(()=>new Promise(r=>{resolve=r}))
  const input=body(), a=f.search(input), b=f.search(input)
  assert.equal(f.calls(),1);resolve({data:[row()]})
  const [one,two]=await Promise.all([a,b]);assert.deepEqual(one,two)
  one.results[0].razao_social='mutated';one.pagination.returned=999
  const three=await f.search(input);assert.equal(three.results[0].razao_social,'Empresa Sintética');assert.equal(three.pagination.returned,1);assert.equal(f.calls(),1)
  await rejects(f.search({...input,page_size:2}),409,'registry_request_conflict');assert.equal(f.calls(),1)
})

test('request metadata is snapshotted before awaiting provider', async () => {
  const f=fixture();let resolve;f.set(()=>new Promise(r=>{resolve=r}))
  const input=body(), expected=input.request_id, pending=f.search(input)
  input.request_id=id();input.filters.uf='RJ';resolve({data:[row()]})
  const result=await pending;assert.equal(result.request_id,expected);assert.equal(result.filters.uf,'SP')
})

test('failed provider request is replayed as sanitised failure, never retried automatically', async () => {
  const f=fixture();f.set(()=>{throw Error('SECRET private upstream')});const input=body()
  await rejects(f.search(input),502,'registry_provider_failed');await rejects(f.search(input),502,'registry_provider_failed');assert.equal(f.calls(),1)
})

test('cursor bound to user, tenant, filters and page size; tampering, reuse and expiration are blocked', async () => {
  const f=fixture();f.set({data:[row()],cursor:'page-two'});const r=await f.search(), cursor=r.pagination.next_cursor
  for(const changes of [{page_size:1},{filters:{...filters,cnae_fiscal:'6201502'}}]) await rejects(f.search(body({cursor,...changes})),409,'registry_cursor_scope_mismatch')
  for(const changes of [{userId:'22222222-2222-4222-8222-222222222222'},{tenantId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}]) {
    const identity={...auth,...changes};await rejects(f.api.search({auth:identity,body:body({cursor,expected_tenant_id:identity.tenantId})}),409,'registry_cursor_scope_mismatch')
  }
  await rejects(f.search(body({cursor:'rsc_'+'z'.repeat(43)})),410,'registry_cursor_expired');assert.equal(f.calls(),1)
  f.set({data:[]});const second=body({cursor});await f.search(second);await f.search(second);assert.equal(f.calls(),2)
  await rejects(f.search(body({cursor})),409,'registry_cursor_consumed')
  f.setTime(new Date('2026-11-08T00:10:00Z'));await rejects(f.search(body({cursor})),410,'registry_cursor_expired')
})

test('cursor page failure consumes cursor and ledger replays error without another provider call', async () => {
  const f=fixture();f.set({data:[],cursor:'second'});const first=await f.search()
  f.set(new Response('private',{status:429}));const input=body({cursor:first.pagination.next_cursor})
  await rejects(f.search(input),429,'registry_provider_rate_limited');await rejects(f.search(input),429,'registry_provider_rate_limited')
  await rejects(f.search(body({cursor:first.pagination.next_cursor})),409,'registry_cursor_consumed');assert.equal(f.calls(),2)
})

test('repeated upstream cursor or CNPJ across pages fails closed', async t => {
  for(const repeat of ['cursor','cnpj']) await t.test(repeat,async()=>{
    const f=fixture();f.set({data:[row()],cursor:'same'});const first=await f.search()
    f.set({data:repeat==='cnpj'?[row({cnpj:'00000000000100'})]:[],cursor:repeat==='cursor'?'same':'new'})
    await rejects(f.search(body({cursor:first.pagination.next_cursor})),502,'registry_pagination_invalid')
  })
})

test('session stops at 30 records even when source offers more', async () => {
  const f=fixture();let counter=0;f.set(()=>({data:Array.from({length:10},()=>row({cnpj:String(++counter).padStart(12,'0')+'00'})),cursor:'page-'+counter}))
  let cursor=null,result
  for(let i=0;i<3;i++){result=await f.search(body({cursor}));cursor=result.pagination.next_cursor}
  assert.equal(result.pagination.session_returned,30);assert.equal(cursor,null);assert.equal(result.pagination.stop_reason,'session_limit');assert.equal(f.calls(),3)
})

test('empty pages cannot bypass finite 30-page session budget', async () => {
  const f=fixture();let counter=0;f.set(()=>({data:[],cursor:'empty-'+(++counter)}))
  let cursor=null,result
  for(let i=0;i<30;i++){result=await f.search(body({page_size:1,cursor}));cursor=result.pagination.next_cursor}
  assert.equal(result.pagination.session_returned,0);assert.equal(result.pagination.pages_fetched,30);assert.equal(cursor,null);assert.equal(result.pagination.stop_reason,'session_limit')
})

test('server page limit shrinks to remaining session records', async () => {
  const f=fixture();let n=0
  f.set(url=>({data:Array.from({length:Number(new URL(url).searchParams.get('limit'))},()=>row({cnpj:String(++n).padStart(12,'0')+'00'})),cursor:'after-'+n}))
  let cursor=null,result
  for(let i=0;i<4;i++){result=await f.search(body({page_size:8,cursor}));cursor=result.pagination.next_cursor}
  assert.equal(new URL(f.requests[3].url).searchParams.get('limit'),'6');assert.equal(result.pagination.session_returned,30);assert.equal(cursor,null)
})

test('session/ledger capacity is bounded; expired settled state can be cleared', async () => {
  const f=fixture();f.set({data:[]})
  for(let i=0;i<LIMITS.sessions;i++)await f.search()
  await rejects(f.search(),503,'registry_capacity_reached');assert.equal(f.calls(),LIMITS.sessions)
  f.setTime(new Date('2026-11-08T00:10:00Z'));await f.search();assert.equal(f.calls(),LIMITS.sessions+1)
})

test('ledger refuses saturation rather than evicting unexpired request protection', async () => {
  const f=fixture();let n=0;f.set(()=>({data:[],cursor:'source-'+(++n)}))
  let cursor=null
  for(let i=0;i<LIMITS.ledger;i++) {
    if(i%30===0)cursor=null
    const result=await f.search(body({cursor,page_size:1}));cursor=result.pagination.next_cursor
  }
  await rejects(f.search(body({cursor,page_size:1})),503,'registry_capacity_reached');assert.equal(f.calls(),LIMITS.ledger)
})

test('timeout is bounded, cached, aborts transport and ignores late completion', async () => {
  const f=fixture({timeoutMs:10});let resolve;f.set(()=>new Promise(r=>{resolve=r}));const input=body()
  await rejects(f.search(input),504,'registry_timeout')
  assert.equal(f.requests[0].init.signal.aborted,true)
  resolve({data:[row()],cursor:'late-private-source'});await new Promise(r=>setTimeout(r,10))
  await rejects(f.search(input),504,'registry_timeout');assert.equal(f.calls(),1)
})

test('expired session during response is not returned and invalid clock blocks provider', async () => {
  const f=fixture();f.set(()=>{f.setTime(new Date('2026-11-08T00:10:00Z'));return {data:[row()]}})
  await rejects(f.search(),410,'registry_cursor_expired')
  f.setTime(new Date('invalid'));await rejects(f.search(),500,'registry_clock_invalid');assert.equal(f.calls(),1)
})


test('expired request results become permanent bounded tombstones, including uncertain failures',async t=>{
  for(const failure of [false,true])await t.test(String(failure),async()=>{
    const f=fixture();const input=body()
    if(failure){f.set(()=>{throw Error('uncertain upstream')});await rejects(f.search(input),502,'registry_provider_failed')}
    else await f.search(input)
    f.setTime(new Date('2026-11-08T00:10:01Z'))
    await rejects(f.search(input),410,'registry_request_expired')
    await rejects(f.search({...input,page_size:1}),409,'registry_request_conflict')
    assert.equal(f.calls(),1)
  })
})

test('expired ledger remains saturated rather than permitting old request identities to execute again',async()=>{
  const f=fixture();let n=0;f.set(()=>({data:[],cursor:'expire-'+(++n)}))
  let cursor=null, first
  for(let i=0;i<LIMITS.ledger;i++){
    if(i%30===0)cursor=null
    const input=body({cursor,page_size:1});if(i===0)first=input
    cursor=(await f.search(input)).pagination.next_cursor
  }
  f.setTime(new Date('2026-11-08T00:10:01Z'))
  await rejects(f.search(first),410,'registry_request_expired')
  await rejects(f.search(),503,'registry_capacity_reached');assert.equal(f.calls(),LIMITS.ledger)
})


test('synchronously reentrant fetch observes reserved promise and receives the same receipt',async()=>{
  const f=fixture(), input=body();let reentrant
  f.set(()=>{reentrant=f.search(input);return {data:[row()]}})
  const first=await f.search(input), second=await reentrant
  assert.notEqual(second,null);assert.deepEqual(first,second);assert.equal(f.calls(),1)
})
