'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {configuredHandler}=require('../shared/james-integration.cjs');
const ids={user:'11111111-1111-4111-8111-111111111111',tenant:'22222222-2222-4222-8222-222222222222',org:'33333333-3333-4333-8333-333333333333',session:'44444444-4444-4444-8444-444444444444',request:'55555555-5555-4555-8555-555555555555',lease:'66666666-6666-4666-8666-666666666666',other:'77777777-7777-4777-8777-777777777777'};
function fixture(options={}){
 const events=[];let sends=0;
 const env={SUPABASE_URL:'synthetic:nucleo',SUPABASE_SERVICE_KEY:'FAKE-NOT-A-KEY',JAMES_MEMORY_ENABLED:'true',JAMES_BUDGET_ENABLED:'true',JAMES_OPENAI_ENABLED:'true',OPENAI_API_KEY:'FAKE-NOT-A-KEY',OPENAI_MODEL:'synthetic-unhomologated-model',JAMES_AUTH_MODE:'qadma',QADMA_SUPABASE_URL:'synthetic:qadma',QADMA_SUPABASE_PUBLISHABLE_KEY:'FAKE-PUBLIC',QADMA_PILOT_ORGANIZATION_ID:ids.org,QADMA_PILOT_USER_ID:ids.user,NUCLEO_PILOT_TENANT_ID:ids.tenant,...options.env};
 const response={status:'completed',usage:{input_tokens:20,output_tokens:5},output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Resposta sintetica supervisionada.'}]}]};
 const createClient=(url,key,config)=>{
  events.push({kind:'client',url,config});
  return {auth:{getUser:async token=>{events.push({kind:'auth',url,token});return {data:{user:{id:options.user??ids.user}},error:options.authError??null};}},
   from:table=>{const filters=[];const q={select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q;},single:async()=>{events.push({kind:'profile',table,filters});return {data:{tenant_id:options.tenant??ids.tenant},error:null};},maybeSingle:async()=>{events.push({kind:'membership',table,filters});return {data:{organization_id:options.org??ids.org,is_active:options.active??true},error:null};}};return q;},
   rpc:async(name,p)=>{
    events.push({kind:'rpc',name,p});
    if(name==='nucleo_memory_v1'){
     if(p.p_action==='begin')return {data:options.replay?{ok:true,state:'completed',reply:'Resposta anterior.'}:{ok:true,state:'reserved',lease:ids.lease,turns:[]}};
     if(p.p_action==='complete')return {data:{ok:true,state:'completed',reply:p.p_reply}};
     return {data:{ok:true,turns:[]}};
    }
    if(name==='nucleo_budget_v1'){
     if(options.quota&&p.p_action==='reserve')return {data:{ok:false,code:'budget_exhausted'}};
     return {data:{ok:true,state:({reserve:'reserved',dispatch:'dispatched',settle:'completed',uncertain:'uncertain'})[p.p_action]}};
    }
    throw Error('Unexpected synthetic RPC');
   }};
 };
 const fetchImpl=async(_url,init)=>{sends++;events.push({kind:'send',payload:JSON.parse(init.body)});if(options.fetchThrows)throw Error('PRIVATE TRANSPORT DETAIL');return {ok:!options.status,status:options.status??200,json:async()=>options.invalidUsage?{...response,usage:null}:response};};
 const handle=configuredHandler({env,createClient,fetchImpl});
 const request={method:'POST',headers:{authorization:'Bearer synthetic-session'},body:{message:'Qual o proximo passo do Qadma?',sessionId:ids.session,requestId:ids.request,tenantId:ids.other,organizationId:ids.other}};
 return {handle,request,events,sends:()=>sends};
}
test('Qadma verified membership reaches existing memory, budget, provider and committed reply',async()=>{
 const f=fixture();const result=await f.handle(f.request);assert.equal(result.status,200);assert.equal(result.body.reply,'Resposta sintetica supervisionada.');assert.equal(f.sends(),1);
 assert.deepEqual(f.events.filter(e=>e.kind==='rpc').map(e=>`${e.name}:${e.p.p_action}`),['nucleo_memory_v1:begin','nucleo_budget_v1:reserve','nucleo_budget_v1:dispatch','nucleo_budget_v1:settle','nucleo_memory_v1:complete']);
 for(const e of f.events.filter(e=>e.kind==='rpc')){assert.equal(e.p.p_tenant,ids.tenant);assert.equal(e.p.p_user,ids.user);assert.equal(e.p.p_session,ids.session);}
 assert.deepEqual(f.events.find(e=>e.kind==='membership').filters,[['user_id',ids.user],['organization_id',ids.org],['is_active',true]]);
 const payload=f.events.find(e=>e.kind==='send').payload;assert.equal(payload.store,false);assert.equal(payload.max_output_tokens,600);assert.equal(payload.input.length,1);
});
for(const [name,options,code] of [
 ['wrong user',{user:ids.other},'unauthorized'],['wrong organization',{org:ids.other},'unauthorized'],['inactive membership',{active:false},'unauthorized'],['wrong mapped tenant',{tenant:ids.other},'unauthorized'],['invalid bearer',{authError:{message:'PRIVATE'}},'unauthorized'],['missing pilot mapping',{env:{NUCLEO_PILOT_TENANT_ID:''}},'auth_unavailable'],['unsupported identity mode',{env:{JAMES_AUTH_MODE:'claims'}},'auth_unavailable']
])test(name+' blocks before memory and provider',async()=>{const f=fixture(options);const r=await f.handle(f.request);assert.equal(r.body.code,code);assert.equal(f.sends(),0);assert.equal(f.events.filter(e=>e.kind==='rpc').length,0);assert.ok(!JSON.stringify(r).includes('PRIVATE'));});
test('missing bearer does not create clients',async()=>{const f=fixture();f.request.headers={};assert.equal((await f.handle(f.request)).status,401);assert.equal(f.events.length,0);});
for(const [name,env,code] of [['memory off',{JAMES_MEMORY_ENABLED:'false'},'memory_unavailable'],['provider off',{JAMES_OPENAI_ENABLED:'false'},'ai_disabled'],['missing key',{OPENAI_API_KEY:''},'ai_not_configured'],['missing model',{OPENAI_MODEL:''},'ai_not_configured'],['budget off',{JAMES_BUDGET_ENABLED:'false'},'budget_disabled']])test(name+' never dispatches',async()=>{const f=fixture({env});const r=await f.handle(f.request);assert.equal(r.body.code,code);assert.equal(f.sends(),0);assert.ok(!f.events.some(e=>e.kind==='rpc'&&e.p.p_action==='dispatch'));});
test('quota refuses before provider and marks pre-dispatch failure safe',async()=>{const f=fixture({quota:true});assert.equal((await f.handle(f.request)).body.code,'budget_exhausted');assert.equal(f.sends(),0);assert.equal(f.events.find(e=>e.kind==='rpc'&&e.p.p_action==='fail').p.p_safe_failure,true);});
for(const [name,options] of [['429',{status:429}],['transport uncertainty',{fetchThrows:true}],['invalid usage',{invalidUsage:true}]])test(name+' holds uncertainty without automatic retry',async()=>{const f=fixture(options);const r=await f.handle(f.request);assert.equal(r.status,503);assert.equal(f.sends(),1);assert.ok(f.events.some(e=>e.kind==='rpc'&&e.p.p_action==='uncertain'));assert.equal(f.events.find(e=>e.kind==='rpc'&&e.p.p_action==='fail').p.p_safe_failure,false);assert.ok(!f.events.some(e=>e.kind==='rpc'&&e.p.p_action==='complete'));assert.ok(!JSON.stringify(r).includes('PRIVATE'));});
test('memory receipt replay does not dispatch',async()=>{const f=fixture({replay:true});const r=await f.handle(f.request);assert.equal(r.body.replayed,true);assert.equal(f.sends(),0);assert.equal(f.events.filter(e=>e.kind==='rpc').length,1);});
test('load uses verified scope without generation',async()=>{const f=fixture();f.request.body.action='load';assert.equal((await f.handle(f.request)).status,200);assert.equal(f.sends(),0);assert.equal(f.events.filter(e=>e.kind==='rpc')[0].p.p_tenant,ids.tenant);});
test('existing Nucleo login stays supported',async()=>{const f=fixture({env:{JAMES_AUTH_MODE:'nucleo'}});assert.equal((await f.handle(f.request)).status,200);assert.ok(!f.events.some(e=>e.kind==='membership'));assert.equal(f.sends(),1);});
test('conversation entrypoint import does not start a listener or import queues',()=>{const http=require('node:http');const old=http.Server.prototype.listen;http.Server.prototype.listen=()=>{throw Error('Listener forbidden');};try{require('../backend/src/conversation-server.cjs');assert.ok(!Object.keys(require.cache).some(p=>/backend[\\/]src[\\/](queue|scheduler|server\.ts)/.test(p)));}finally{http.Server.prototype.listen=old;}});
