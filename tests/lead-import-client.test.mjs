import test from 'node:test'
import assert from 'node:assert/strict'
import { prepareLeadFile } from '../src/lib/lead-source-file.ts'
import { submitLeadImport, getLeadImportReceipt, pendingImportKey, savePendingImport, readPendingImport, clearPendingImport, withPendingImportLock } from '../src/lib/lead-import-client.ts'
const tenant='00000000-0000-4000-8000-000000000010', user='00000000-0000-4000-8000-000000000001', request='00000000-0000-4000-8000-000000000201', lead='00000000-0000-4000-8000-000000000301'
const prepared=()=>prepareLeadFile({bytes:new TextEncoder().encode('nome,telefone\nContato Teste,(11) 91234-5678'),fileName:'teste.csv',tenantId:tenant,requestId:request})
const receipt=()=>({ok:true,request_id:request,tenant_id:tenant,imported:1,existing:0,total:1,items:[{lead_id:lead,phone:'+5511912345678',outcome:'imported'}],state:{whatsapp:'unknown',activity:'unknown',contact_permission:'not_established'}})
const rejects=(outcome)=>e=>e.outcome===outcome
function storage(){const map=new Map();return{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}}
test('no explicit authorization, stale context or tenant mismatch can call RPC',async()=>{let calls=0;const preview=await prepared();for(const extra of [{confirmed:false},{isCurrent:()=>false},{tenantId:'00000000-0000-4000-8000-000000000020'},{preview:{...preview,canImport:false}}])await assert.rejects(submitLeadImport({preview,tenantId:tenant,confirmed:true,isCurrent:()=>true,rpc:async()=>{calls++;return{}},...extra}),rejects('rejected'));assert.equal(calls,0)})
test('only exact authenticated import payload is submitted, receipt preserves unknown states',async()=>{let called;const preview=await prepared();const result=await submitLeadImport({preview,tenantId:tenant,confirmed:true,isCurrent:()=>true,rpc:async(name,args)=>{called={name,args};return{data:receipt(),error:null}}});assert.equal(called.name,'nucleo_import_leads_v1');assert.deepEqual(called.args,{p_request_id:request,p_expected_tenant:tenant,p_source:preview.source,p_contacts:preview.contacts});assert.equal(result.imported,1);assert.equal(result.state.contact_permission,'not_established')})
test('network timeout never retries or reports success',async()=>{let calls=0;await assert.rejects(submitLeadImport({preview:await prepared(),tenantId:tenant,confirmed:true,isCurrent:()=>true,rpc:async()=>{calls++;throw Error('network')}}),rejects('uncertain'));assert.equal(calls,1)})
test('missing migration and known rejection differ from uncertain transport/conflict',async()=>{for(const[code,outcome]of[['PGRST202','rejected'],['42883','rejected'],['42501','rejected'],['P0001','rejected'],['22023','uncertain'],['503','uncertain']])await assert.rejects(submitLeadImport({preview:await prepared(),tenantId:tenant,confirmed:true,isCurrent:()=>true,rpc:async()=>({data:null,error:{code,message:'PRIVATE'}})}),e=>e.outcome===outcome&&!e.message.includes('PRIVATE'))})
test('malformed, foreign, contradictory or consent-promoting receipt is not success',async()=>{const baseline=receipt();for(const change of [{tenant_id:'foreign'},{request_id:'foreign'},{total:2},{imported:2},{state:{...baseline.state,contact_permission:'granted'}},{items:[{...baseline.items[0],phone:'+5521912345678'}]},{items:[{...baseline.items[0],outcome:'existing'}]}])await assert.rejects(submitLeadImport({preview:await prepared(),tenantId:tenant,confirmed:true,isCurrent:()=>true,rpc:async()=>({data:{...baseline,...change},error:null})}),rejects('uncertain'))})
test('lookup never sends an import and null remains unconfirmed',async()=>{const calls=[];assert.equal(await getLeadImportReceipt({requestId:request,tenantId:tenant,rpc:async(name,args)=>{calls.push({name,args});return{data:null,error:null}}}),null);assert.deepEqual(calls,[{name:'nucleo_get_lead_import_v1',args:{p_request_id:request,p_expected_tenant:tenant}}]);assert.deepEqual(await getLeadImportReceipt({requestId:request,tenantId:tenant,rpc:async()=>({data:receipt(),error:null})}),receipt())})
test('pending reference contains no contact list and cannot be silently replaced',async()=>{const p=await prepared(),db=storage(),key=pendingImportKey(tenant,user),pending={requestId:request,tenantId:tenant,sha256:p.source.sha256,fileName:p.source.file_name};savePendingImport(db,key,pending);assert.deepEqual(readPendingImport(db,key,tenant),pending);assert.ok(!db.getItem(key).includes('91234'));assert.throws(()=>savePendingImport(db,key,{...pending,requestId:'00000000-0000-4000-8000-000000000202'}),rejects('rejected'));clearPendingImport(db,key,'00000000-0000-4000-8000-000000000202',tenant);assert.ok(readPendingImport(db,key,tenant));clearPendingImport(db,key,request,tenant);assert.equal(readPendingImport(db,key,tenant),null)})
test('storage failure is rejected before dispatch and malformed pending cannot disappear',async()=>{const p=await prepared(),key=pendingImportKey(tenant,user);assert.throws(()=>savePendingImport({getItem:()=>null,setItem:()=>{throw Error('quota')},removeItem:()=>{}},key,{requestId:request,tenantId:tenant,sha256:p.source.sha256,fileName:p.source.file_name}),rejects('rejected'));assert.throws(()=>readPendingImport({getItem:()=>'{bad',setItem:()=>{},removeItem:()=>{}},key,tenant),rejects('rejected'))})

test('a hanging import reaches a deadline without retry or late success',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});let calls=0,release;
  const preview=await prepared();
  const operation=submitLeadImport({preview,tenantId:tenant,confirmed:true,isCurrent:()=>true,rpc:()=>{calls++;return new Promise(resolve=>{release=resolve})}});
  const rejected=assert.rejects(operation,rejects('uncertain'));
  await Promise.resolve();t.mock.timers.tick(45_001);await rejected;
  assert.equal(calls,1);release({data:receipt(),error:null});await Promise.resolve();assert.equal(calls,1);
})
test('a hanging receipt lookup reaches a deadline and never submits',async(t)=>{
  t.mock.timers.enable({apis:['setTimeout']});const calls=[];
  const operation=getLeadImportReceipt({requestId:request,tenantId:tenant,rpc:name=>{calls.push(name);return new Promise(()=>{})}});
  const rejected=assert.rejects(operation,rejects('uncertain'));
  await Promise.resolve();t.mock.timers.tick(45_001);await rejected;
  assert.deepEqual(calls,['nucleo_get_lead_import_v1']);
})

test('cross-tab lock contention or missing locks cannot reserve or dispatch',async()=>{
  let calls=0;const work=async()=>{calls++;return 1};
  await assert.rejects(withPendingImportLock(undefined,'key',work),rejects('rejected'));
  await assert.rejects(withPendingImportLock({request:async(_key,_options,fn)=>fn(null)},'key',work),rejects('rejected'));
  assert.equal(calls,0);
})
test('cross-tab lock uses the tenant/user key and retains uncertainty',async()=>{
  let key,options,calls=0;
  const locks={request:async(k,o,fn)=>{key=k;options=o;return fn({name:k})}};
  assert.equal(await withPendingImportLock(locks,pendingImportKey(tenant,user),async()=>{calls++;return 42}),42);
  assert.equal(key,pendingImportKey(tenant,user));assert.deepEqual(options,{mode:'exclusive',ifAvailable:true});assert.equal(calls,1);
  await assert.rejects(withPendingImportLock(locks,key,async()=>{const {ImportFailure}=await import('../src/lib/lead-import-client.ts');throw new ImportFailure('uncertain','uncertain')}),rejects('uncertain'));
})

test('explicit legacy identity conflicts are rejected without revealing records',async()=>{
  for(const message of ['lead_import_name_conflict','lead_import_ambiguous_legacy'])await assert.rejects(submitLeadImport({preview:await prepared(),tenantId:tenant,confirmed:true,isCurrent:()=>true,rpc:async()=>({data:null,error:{code:'22023',message}})}),e=>e.outcome==='rejected'&&!e.message.includes('lead_import_'));
})

test('unexpected failure after acquiring lock is not mislabeled as a rejected write',async()=>{
  const error=new Error('unexpected');
  await assert.rejects(withPendingImportLock({request:async(_key,_options,fn)=>fn({name:'key'})},'key',async()=>{throw error}),e=>e===error&&!e.outcome);
})
