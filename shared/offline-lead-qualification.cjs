'use strict';
// Synthetic evidence intake/qualification only. No collection/contact/queue APIs.
const {createHash}=require('node:crypto');
const {TenantJobError}=require('./offline-tenant-jobs.cjs');
const fail=(code,status)=>{throw new TenantJobError(code,status);};
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const time=v=>Number.isSafeInteger(v)&&v>=0;
const label=v=>typeof v==='string'&&v.trim()===v&&v.length>0&&v.length<=80;
function snap(o,keys){
 try{
  if(!o||typeof o!=='object'||Array.isArray(o))throw 0;
  const own=Reflect.ownKeys(o);if(own.length!==keys.length||own.some(k=>!keys.includes(k)))throw 0;
  const r=Object.create(null);for(const k of keys){if(!Object.hasOwn(o,k))throw 0;r[k]=o[k];}return Object.freeze(r);
 }catch{fail('lead_source_invalid',503);}
}
function snapshotEvidenceCollection(packet){
 // All provider-controlled traversal, including array proxies, stays behind
 // this boundary. Never invoke its iterator/map or reread a validated value.
 try{
  if(!Array.isArray(packet))throw 0;
  const length=packet.length;
  if(!Number.isInteger(length)||length<0||length>4)throw 0;
  const detached=[];
  for(let i=0;i<length;i++){
   if(!Object.hasOwn(packet,i))throw 0;
   const element=packet[i];
   const e=snap(element,['manifest','text']);
   const manifest=snap(e.manifest,['artifactId','tenantId','leadId','sha256','observedAt','expiresAt','synthetic']);
   detached.push(Object.freeze({manifest,text:e.text}));
  }
  return Object.freeze(detached);
 }catch{fail('lead_source_invalid',503);}
}
function createOfflineLeadQualification({resolveAuthorization,loadEvidence,now=Date.now}={}){
 if(typeof resolveAuthorization!=='function'||typeof loadEvidence!=='function'||typeof now!=='function')fail('lead_source_unavailable',503);
 function clock(){let t;try{t=now();}catch{fail('lead_source_unavailable',503);}if(!time(t))fail('lead_source_unavailable',503);return t;}
 return Object.freeze({async qualify(credential,leadId){
  if(typeof credential!=='string'||credential.length<1||credential.length>8192||!id(leadId))fail('unauthorized',401);
  let raw;try{raw=await resolveAuthorization(credential);}catch{fail('lead_source_unavailable',503);}
  if(raw===null)fail('forbidden',403);
  const g=snap(raw,['tenantId','canQualify','expiresAt','sector','city']);
  if(!id(g.tenantId)||g.canQualify!==true)fail('forbidden',403);
  if(!time(g.expiresAt)||!label(g.sector)||!label(g.city))fail('lead_source_invalid',503);
  if(g.expiresAt<=clock())fail('forbidden',403);
  let packet;try{packet=await loadEvidence(Object.freeze({tenantId:g.tenantId,leadId}));}catch{fail('lead_source_unavailable',503);}
  const t=clock();if(g.expiresAt<=t)fail('forbidden',403);
  const evidence=snapshotEvidenceCollection(packet);
  const provenance=[],facts=[],seen=new Set(),reasons=[];
  for(const e of evidence){
   const m=e.manifest;
   if(!id(m.artifactId)||seen.has(m.artifactId)||m.tenantId!==g.tenantId||m.leadId!==leadId||m.synthetic!==true||!time(m.observedAt)||!time(m.expiresAt)||m.observedAt>t||m.expiresAt<=m.observedAt||typeof m.sha256!=='string'||!/^[a-f0-9]{64}$/.test(m.sha256))fail('lead_source_invalid',503);
   seen.add(m.artifactId);
   if(typeof e.text!=='string'||Buffer.byteLength(e.text,'utf8')>4096||createHash('sha256').update(e.text,'utf8').digest('hex')!==m.sha256)fail('lead_evidence_mismatch',503);
   let parsed;try{parsed=JSON.parse(e.text);}catch{fail('lead_source_invalid',503);}
   const d=snap(parsed,['synthetic','tenantId','leadId','sector','city','operating']);
   if(d.synthetic!==true||d.tenantId!==g.tenantId||d.leadId!==leadId||(d.sector!==null&&!label(d.sector))||(d.city!==null&&!label(d.city))||(d.operating!==null&&typeof d.operating!=='boolean'))fail('lead_source_invalid',503);
   provenance.push(Object.freeze({...m}));facts.push(d);
   if(m.expiresAt<=t)reasons.push('expired_evidence');
  }
  if(!facts.length)reasons.push('missing_evidence');
  for(const key of ['sector','city','operating']){
   if(facts.some(f=>f[key]===null))reasons.push('missing_'+key);
   if(new Set(facts.map(f=>f[key]).filter(v=>v!==null)).size>1)reasons.push('conflicting_'+key);
  }
  let qualification='needs_review';
  if(!reasons.length){
   const f=facts[0];qualification=f.sector===g.sector&&f.city===g.city&&f.operating===true?'matches_criteria':'does_not_match';
   if(qualification==='does_not_match')reasons.push('outside_approved_criteria');
  }
  return Object.freeze({synthetic:true,leadId,qualification,reasons:Object.freeze([...new Set(reasons)]),
   provenance:Object.freeze(provenance),canContact:false,canSend:false,canEnqueue:false,
   contactAuthorization:'not_established',campaignDisposition:'blocked_until_separate_contact_permission_and_establishment_approval'});
 }});
}
module.exports={createOfflineLeadQualification};
