import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createOfflineLeadQualification}=require('../shared/offline-lead-qualification.cjs');
const {createOfflineCampaignPreview}=require('../shared/offline-campaign-preview.cjs');
const directory=new URL('./fixtures/leads/',import.meta.url);
const manifest=JSON.parse(fs.readFileSync(new URL('manifest.json',directory),'utf8'));
const records=(tenantId,leadId)=>manifest.filter(m=>m.tenantId===tenantId&&m.leadId===leadId).map(m=>({manifest:{...m},text:fs.readFileSync(new URL(m.artifactId+'.json',directory),'utf8')}));
const grant=tenantId=>({tenantId,canQualify:true,expiresAt:2000,sector:'salon',city:'fictional-city'});
const error=code=>e=>e.code===code;
function service(options={}){return createOfflineLeadQualification({now:()=>1000,resolveAuthorization:async token=>token==='synthetic-A'?grant('A'):token==='synthetic-B'?grant('B'):null,loadEvidence:async s=>records(s.tenantId,s.leadId),...options});}
test('verifiable fixture provenance qualifies but never authorizes contact/send/queue',async()=>{
 const r=await service().qualify('synthetic-A','lead-a');assert.equal(r.qualification,'matches_criteria');assert.equal(r.provenance[0].sha256,manifest[0].sha256);assert.equal(r.synthetic,true);
 for(const key of ['canContact','canSend','canEnqueue'])assert.equal(r[key],false);assert.equal(r.contactAuthorization,'not_established');assert.ok(Object.isFrozen(r)&&Object.isFrozen(r.provenance[0]));assert.equal('phone' in r,false);
});
test('company scope is provided by trusted resolver, no foreign lead facts/provenance',async()=>{
 const r=await service().qualify('synthetic-A','lead-b');assert.equal(r.qualification,'needs_review');assert.deepEqual(r.reasons,['missing_evidence']);assert.deepEqual(r.provenance,[]);
 assert.equal((await service().qualify('synthetic-B','lead-b')).qualification,'matches_criteria');
 await assert.rejects(service({loadEvidence:async()=>records('B','lead-b')}).qualify('synthetic-A','lead-b'),error('lead_source_invalid'));
});
test('unauthorized, expired and disallowed access never loads evidence',async()=>{
 let calls=0;const loadEvidence=async()=>{calls++;return [];};await assert.rejects(service({loadEvidence}).qualify('forged-A','lead-a'),error('forbidden'));
 for(const g of [{...grant('A'),canQualify:false},{...grant('A'),expiresAt:1000}])await assert.rejects(service({loadEvidence,resolveAuthorization:async()=>g}).qualify('synthetic-A','lead-a'),error('forbidden'));assert.equal(calls,0);
});
test('missing, expired, conflicting facts and outside criteria are separate states',async()=>{
 for(const [lead,qualification,reason] of [['lead-missing','needs_review','missing_sector'],['lead-old','needs_review','expired_evidence'],['lead-conflict','needs_review','conflicting_sector'],['lead-outside','does_not_match','outside_approved_criteria']]){
  const r=await service().qualify('synthetic-A',lead);assert.equal(r.qualification,qualification);assert.ok(r.reasons.includes(reason));assert.equal(r.canContact,false);
 }
});
test('modified artifact, forged digest and foreign manifest fail closed',async()=>{
 for(const mutate of [r=>{r[0].text+=' ';},r=>{r[0].manifest.sha256='0'.repeat(64);},r=>{r[0].manifest.tenantId='B';}]){
  const rows=records('A','lead-a');mutate(rows);await assert.rejects(service({loadEvidence:async()=>rows}).qualify('synthetic-A','lead-a'),e=>['lead_evidence_mismatch','lead_source_invalid'].includes(e.code));
 }
});
test('duplicate provenance, future dates and oversized packets rejected',async()=>{
 const r=records('A','lead-a');for(const rows of [[r[0],r[0]],Array(5).fill(r[0]),[{...r[0],manifest:{...r[0].manifest,observedAt:1001}}]])await assert.rejects(service({loadEvidence:async()=>rows}).qualify('synthetic-A','lead-a'),error('lead_source_invalid'));
});
test('snapshots take a single value; no client claims overwrite trusted scope',async()=>{
 let reads=0;const g={...grant('A'),get tenantId(){return ++reads===1?'A':'B';}};assert.equal((await service({resolveAuthorization:async()=>g}).qualify('synthetic-A','lead-a')).qualification,'matches_criteria');assert.equal(reads,1);
 await assert.rejects(service({resolveAuthorization:async()=>({...grant('A'),credential:'extra'})}).qualify('synthetic-A','lead-a'),error('lead_source_invalid'));
});
test('expiry during evidence loading and source failures produce no qualification',async()=>{
 let t=1000;await assert.rejects(service({now:()=>t,loadEvidence:async()=>{t=2000;return records('A','lead-a');}}).qualify('synthetic-A','lead-a'),error('forbidden'));
 for(const key of ['resolveAuthorization','loadEvidence'])await assert.rejects(service({[key]:async()=>{throw new Error('private');}}).qualify('synthetic-A','lead-a'),error('lead_source_unavailable'));
});
test('real phase13 boundary rejects qualification as contact even with establishment approval',async()=>{
 const lead=await service().qualify('synthetic-A','lead-a');
 const campaign=createOfflineCampaignPreview({now:()=>1000,resolveAuthorization:async()=>({campaignId:'campaign',tenantId:'A',channel:'whatsapp',purpose:'reactivation',approved:true,expiresAt:2000,maxRecipients:1,inactiveForMs:100,cooldownMs:50}),loadCandidates:async()=>[lead]});
 await assert.rejects(campaign.preview('synthetic-A','campaign'),error('campaign_source_invalid'));
});
test('qualification cannot override opt-out or missing permission on a separately loaded contact',async()=>{
 const lead=await service().qualify('synthetic-A','lead-a');assert.equal(lead.qualification,'matches_criteria');
 for(const [optOut,active] of [[true,true],[false,false]]){
 const campaign=createOfflineCampaignPreview({now:()=>1000,resolveAuthorization:async()=>({campaignId:'campaign',tenantId:'A',channel:'whatsapp',purpose:'reactivation',approved:true,expiresAt:2000,maxRecipients:1,inactiveForMs:100,cooldownMs:50}),loadCandidates:async()=>[{contactId:'separate-contact',tenantId:'A',optOut,historyComplete:true,lastInteractionAt:100,lastCampaignAt:null,permission:{tenantId:'A',channel:'whatsapp',purpose:'reactivation',active,expiresAt:2000}}]});
 assert.deepEqual((await campaign.preview('synthetic-A','campaign')).proposedContactIds,[]);
 }
});

// Revision 2: external collection access must never expose provider exceptions.
const privateMarker='SYNTHETIC_PRIVATE_PROVIDER_DETAIL';
const sanitized=e=>{
 assert.equal(e.code,'lead_source_invalid');assert.equal(e.status,503);assert.equal(e.message,'lead_source_invalid');
 assert.equal(String(e.stack).includes(privateMarker),false);assert.equal(JSON.stringify(e).includes(privateMarker),false);assert.equal(e.cause,undefined);return true;
};
test('throwing length/index proxies and index getter are sanitized',async()=>{
 const valid=records('A','lead-a');
 for(const key of ['length','0']){
  const packet=new Proxy(valid,{get(target,k,r){if(k===key)throw new Error(privateMarker);return Reflect.get(target,k,r);}});
  await assert.rejects(service({loadEvidence:async()=>packet}).qualify('synthetic-A','lead-a'),sanitized);
 }
 const getter=[];Object.defineProperty(getter,0,{get(){throw new Error(privateMarker);}});
 await assert.rejects(service({loadEvidence:async()=>getter}).qualify('synthetic-A','lead-a'),sanitized);
});
test('collection descriptors, revocation and element shape access fail safely',async()=>{
 const valid=records('A','lead-a');
 const descriptor=new Proxy(valid,{getOwnPropertyDescriptor(){throw new Error(privateMarker);}});
 const element=new Proxy(valid[0],{ownKeys(){throw new Error(privateMarker);}});
 const badManifest={text:valid[0].text,get manifest(){throw new Error(privateMarker);}};
 const revocable=Proxy.revocable(valid,{get(target,k,r){if(k==='length'){revocable.revoke();return 1;}return Reflect.get(target,k,r);}});
 for(const packet of [descriptor,[element],[badManifest],revocable.proxy])await assert.rejects(service({loadEvidence:async()=>packet}).qualify('synthetic-A','lead-a'),sanitized);
});
test('valid mutable length/index read once; provider iterator/map never called',async()=>{
 let lengths=0,indices=0;const valid=records('A','lead-a');
 const packet=new Proxy(valid,{get(target,key,r){
  if(key==='length'){lengths++;if(lengths>1)throw new Error(privateMarker);return 1;}
  if(key==='0'){indices++;return indices===1?valid[0]:null;}
  if(key===Symbol.iterator||key==='map')throw new Error(privateMarker);
  return Reflect.get(target,key,r);
 }});
 const result=await service({loadEvidence:async()=>packet}).qualify('synthetic-A','lead-a');assert.equal(result.qualification,'matches_criteria');assert.equal(lengths,1);assert.equal(indices,1);
});
test('late bad collection element gives no partial qualification',async()=>{
 const rows=records('A','lead-a');Object.defineProperty(rows,1,{get(){throw new Error(privateMarker);}});
 let resolved=false;
 await assert.rejects(service({loadEvidence:async()=>rows}).qualify('synthetic-A','lead-a').then(r=>{resolved=true;return r;}),sanitized);assert.equal(resolved,false);
});
test('invalid lengths and sparse collections fail sanitized before evaluation',async()=>{
 for(const length of [null,-1,1.5,5,'1']){
  const packet=new Proxy([],{get(target,k,r){return k==='length'?length:Reflect.get(target,k,r);}});
  await assert.rejects(service({loadEvidence:async()=>packet}).qualify('synthetic-A','lead-a'),sanitized);
 }
 await assert.rejects(service({loadEvidence:async()=>new Array(1)}).qualify('synthetic-A','lead-a'),sanitized);
});
