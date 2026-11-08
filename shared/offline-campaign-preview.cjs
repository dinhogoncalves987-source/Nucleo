'use strict';
// Read-only offline reference. No sender/queue/provider/persistence implementation.
const {TenantJobError}=require('./offline-tenant-jobs.cjs');
const fail=(c,s)=>{throw new TenantJobError(c,s);};
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(v);
const integer=v=>Number.isSafeInteger(v)&&v>=0;
function snapshot(o,keys){
 try{
  if(!o||typeof o!=='object'||Array.isArray(o))throw 0;
  const own=Reflect.ownKeys(o);
  if(own.length!==keys.length||own.some(k=>!keys.includes(k)))throw 0;
  const out=Object.create(null);
  for(const k of keys){if(!Object.hasOwn(o,k))throw 0;out[k]=o[k];}
  return Object.freeze(out);
 }catch{fail('campaign_source_invalid',503);}
}
function createOfflineCampaignPreview({resolveAuthorization,loadCandidates,now=Date.now}={}){
 if(typeof resolveAuthorization!=='function'||typeof loadCandidates!=='function'||typeof now!=='function')fail('campaign_source_unavailable',503);
 function clock(){let t;try{t=now();}catch{fail('campaign_source_unavailable',503);}if(!integer(t))fail('campaign_source_unavailable',503);return t;}
 return Object.freeze({async preview(credential,campaignId){
  if(typeof credential!=='string'||credential.length<1||credential.length>8192||!id(campaignId))fail('unauthorized',401);
  let raw;try{raw=await resolveAuthorization(credential,campaignId);}catch{fail('campaign_source_unavailable',503);}
  if(raw===null)fail('forbidden',403);
  const g=snapshot(raw,['campaignId','tenantId','channel','purpose','approved','expiresAt','maxRecipients','inactiveForMs','cooldownMs']);
  if(g.campaignId!==campaignId||!id(g.tenantId)||g.channel!=='whatsapp'||g.purpose!=='reactivation'||g.approved!==true)fail('forbidden',403);
  if(!integer(g.expiresAt)||!Number.isInteger(g.maxRecipients)||g.maxRecipients<1||g.maxRecipients>100||!integer(g.inactiveForMs)||g.inactiveForMs<1||!integer(g.cooldownMs)||g.cooldownMs<1)fail('campaign_source_invalid',503);
  if(g.expiresAt<=clock())fail('forbidden',403);
  let rows;try{rows=await loadCandidates(Object.freeze({tenantId:g.tenantId,campaignId:g.campaignId}));}catch{fail('campaign_source_unavailable',503);}
  const t=clock();if(g.expiresAt<=t)fail('forbidden',403);
  // Fully snapshot/validate batch before constructing output. Never return partial
  // results from a contaminated tenant batch or silently truncate an oversized page.
  let batch;
  try{
   if(!Array.isArray(rows))throw 0;
   const size=rows.length;if(!Number.isInteger(size)||size<0||size>100)throw 0;
   batch=[];
   for(let i=0;i<size;i++){
    const r=snapshot(rows[i],['contactId','tenantId','optOut','historyComplete','lastInteractionAt','lastCampaignAt','permission']);
    const p=snapshot(r.permission,['tenantId','channel','purpose','active','expiresAt']);
    if(!id(r.contactId)||r.tenantId!==g.tenantId||p.tenantId!==g.tenantId||typeof r.optOut!=='boolean'||typeof r.historyComplete!=='boolean'||typeof p.active!=='boolean'||!integer(p.expiresAt)||!['whatsapp'].includes(p.channel)||p.purpose!=='reactivation')throw 0;
    if([r.lastInteractionAt,r.lastCampaignAt].some(v=>v!==null&&(!integer(v)||v>t)))throw 0;
    batch.push({...r,permission:p});
   }
  }catch{fail('campaign_source_invalid',503);}
  const seen=new Set(),duplicates=new Set();
  for(const r of batch){if(seen.has(r.contactId))duplicates.add(r.contactId);seen.add(r.contactId);}
  const counts={duplicate:0,optedOut:0,permissionMissingOrExpired:0,historyUnknown:0,recentInteraction:0,cooldown:0,overLimit:0};
  const proposed=[];
  for(const r of batch.sort((a,b)=>a.contactId<b.contactId?-1:a.contactId>b.contactId?1:0)){
   if(duplicates.has(r.contactId)){counts.duplicate++;continue;}
   if(r.optOut){counts.optedOut++;continue;}
   if(!r.permission.active||r.permission.expiresAt<=t){counts.permissionMissingOrExpired++;continue;}
   if(!r.historyComplete||r.lastInteractionAt===null){counts.historyUnknown++;continue;}
   if(t-r.lastInteractionAt<g.inactiveForMs){counts.recentInteraction++;continue;}
   if(r.lastCampaignAt!==null&&t-r.lastCampaignAt<g.cooldownMs){counts.cooldown++;continue;}
   if(proposed.length>=g.maxRecipients){counts.overLimit++;continue;}
   proposed.push(r.contactId);
  }
  return Object.freeze({previewOnly:true,canSend:false,requiresFreshAuthorizationAtDispatch:true,
   campaignId:g.campaignId,proposedContactIds:Object.freeze(proposed),excluded:Object.freeze(counts)});
 }});
}
module.exports={createOfflineCampaignPreview};
