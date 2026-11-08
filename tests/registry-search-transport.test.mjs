import test from 'node:test'
import assert from 'node:assert/strict'
import registry from '../shared/registry-search.cjs'
const { createBoundedRegistryTransport, LIMITS } = registry
const filters = { cnae_fiscal:'6201501',uf:'SP',municipio:'3550308' }
const options = () => ({filters:{...filters},limit:1,cursor:null,signal:new AbortController().signal})
const response = value => new Response(value,{headers:{'content-type':'application/json'}})
const expect = (promise,status,code) => assert.rejects(promise,e=>e.status===status&&e.code===code)

test('transport only constructs fixed HTTPS endpoint from strict structured parameters',async()=>{
  let calls=0
  const transport=createBoundedRegistryTransport(async(url,init)=>{
    calls++;assert.equal(url,'https://minhareceita.org/?cnae_fiscal=6201501&uf=SP&municipio=3550308&limit=1&cursor=opaque%2B%2F%3D')
    assert.equal(init.redirect,'error');assert.equal(init.method,'GET');assert.equal(init.credentials,'omit');assert.equal(init.cache,'no-store')
    return response('{"data":[]}')
  })
  assert.deepEqual(await transport({...options(),cursor:'opaque+/='}),{results:[],cursor:null})
  for(const change of [{limit:11},{limit:0},{cursor:undefined},{cursor:'\n'},{signal:null},{filters:{...filters,uf:'https://evil.invalid'}}])await assert.rejects(transport({...options(),...change}))
  assert.equal(calls,1)
})

test('transport refuses non-success/status/redirect responses without relaying raw content',async t=>{
  for(const [status,code,expected] of [[429,'registry_provider_rate_limited',429],[400,'registry_provider_failed',502],[301,'registry_provider_failed',502],[204,'registry_provider_failed',502],[500,'registry_provider_failed',502]]){
    await t.test(String(status),async()=>{
      let calls=0
      const transport=createBoundedRegistryTransport(async()=>{calls++;return new Response(status===204?null:'SENSITIVE UPSTREAM',{status,headers:{'retry-after':'123','location':'https://evil.invalid'}})})
      await expect(transport(options()),expected,code);assert.equal(calls,1)
    })
  }
  for(const extra of [{redirected:true},{url:'https://evil.invalid/path'}]){
    const transport=createBoundedRegistryTransport(async()=>Object.assign({status:200,headers:new Headers(),body:response('{"data":[]}').body},extra))
    await expect(transport(options()),502,'registry_provider_failed')
  }
})

test('transport enforces declared/streamed byte limits and strict JSON content/schema',async t=>{
  const factories=[
    ()=>new Response('x',{headers:{'content-length':String(LIMITS.response_bytes+1)}}),
    ()=>new Response('x',{headers:{'content-length':'-1'}}),
    ()=>new Response('x',{headers:{'content-length':'wat'}}),
    ()=>response('x'.repeat(LIMITS.response_bytes+1)),
    ()=>response('not-json'),
    ()=>response('{"error":"private"}'),
    ()=>response('{"data":[], "cursor":' + JSON.stringify('x'.repeat(2049)) + '}'),
    ()=>new Response('{"data":[]}',{headers:{'content-type':'text/html'}}),
    ()=>new Response(null,{headers:{'content-type':'application/json'}}),
    ()=>response(new Uint8Array([0xc3,0x28])),
    ()=>response(new Uint8Array([0x7b,0xc3]))
  ]
  for(let i=0;i<factories.length;i++)await t.test(String(i),async()=>await expect(createBoundedRegistryTransport(async()=>factories[i]())(options()),502,'registry_response_invalid'))
})

test('multibyte UTF-8 split across chunks is decoded without corruption',async()=>{
  const encoded=new TextEncoder().encode(JSON.stringify({data:[{cnpj:'00000000000100',uf:'SP',codigo_municipio_ibge:3550308,cnae_fiscal:6201501,razao_social:'Sintética'}]}))
  const body=new ReadableStream({start(controller){for(const byte of encoded)controller.enqueue(new Uint8Array([byte]));controller.close()}})
  const page=await createBoundedRegistryTransport(async()=>new Response(body,{headers:{'content-type':'application/json;charset=utf-8'}}))(options())
  assert.equal(page.results[0].razao_social,'Sintética')
})

test('stream failure and fetch exception are sanitized',async()=>{
  await expect(createBoundedRegistryTransport(async()=>{throw Error('secret URL token body')})(options()),502,'registry_provider_failed')
  const body=new ReadableStream({pull(controller){controller.error(Error('secret stream body'))}})
  await expect(createBoundedRegistryTransport(async()=>new Response(body,{headers:{'content-type':'application/json'}}))(options()),502,'registry_provider_failed')
})

test('abort rejects an uncooperative fetch and cancels its late response',async()=>{
  let resolve,cancelled=0
  const transport=createBoundedRegistryTransport(()=>new Promise(r=>{resolve=r})),controller=new AbortController()
  const pending=transport({...options(),signal:controller.signal})
  controller.abort();await expect(pending,504,'registry_timeout')
  const body=new ReadableStream({cancel(){cancelled++}})
  resolve(new Response(body,{headers:{'content-type':'application/json'}}))
  await new Promise(r=>setTimeout(r,0));assert.equal(cancelled,1)
})

test('abort rejects a stalled body and cancels without hanging on cancellation',async()=>{
  let cancelled=0
  const body=new ReadableStream({pull(){return new Promise(()=>{})},cancel(){cancelled++;return new Promise(()=>{})}})
  const transport=createBoundedRegistryTransport(async()=>new Response(body,{headers:{'content-type':'application/json'}})),controller=new AbortController()
  const pending=transport({...options(),signal:controller.signal})
  await new Promise(r=>setTimeout(r,0));controller.abort()
  await expect(pending,504,'registry_timeout');assert.equal(cancelled,1)
})

test('pre-aborted transport does not fetch',async()=>{
  let calls=0
  const transport=createBoundedRegistryTransport(async()=>{calls++;return response('{"data":[]}')}),controller=new AbortController()
  controller.abort();await expect(transport({...options(),signal:controller.signal}),504,'registry_timeout');assert.equal(calls,0)
})
