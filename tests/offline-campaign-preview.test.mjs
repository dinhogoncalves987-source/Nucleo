import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {createOfflineCampaignPreview}=createRequire(import.meta.url)('../shared/offline-campaign-preview.cjs');
const error=code=>e=>e.code===code;
const grant=tenantId=>({campaignId:'campaign',tenantId,channel:'whatsapp',purpose:'reactivation',approved:true,expiresAt:2000,maxRecipients:2,inactiveForMs:100,cooldownMs:50});
const contact=(contactId,tenantId='A',extra={})=>({contactId,tenantId,optOut:false,historyComplete:true,lastInteractionAt:500,lastCampaignAt:null,permission:{tenantId,channel:'whatsapp',purpose:'reactivation',active:true,expiresAt:2000},...extra});
function fixture(rows=[contact('contact-A')],g=grant('A')){
 let reads=0;const scopes=[];
 const service=createOfflineCampaignPreview({now:()=>1000,resolveAuthorization:async token=>token==='verified-A'?g:null,loadCandidates:async scope=>{reads++;scopes.push(scope);return rows;}});
 return {service,scopes,reads:()=>reads};
}
test('approved scoped preview never authorizes sending or exposes contact details',async()=>{
 const f=fixture();const r=await f.service.preview('verified-A','campaign');
 assert.deepEqual(f.scopes,[{tenantId:'A',campaignId:'campaign'}]);assert.deepEqual(r.proposedContactIds,['contact-A']);assert.equal(r.previewOnly,true);assert.equal(r.canSend,false);assert.equal(r.requiresFreshAuthorizationAtDispatch,true);assert.ok(Object.isFrozen(r.proposedContactIds));assert.equal('permission' in r,false);
});
test('forged caller identity and unapproved/expired campaign cannot load contacts',async()=>{
 const f=fixture();await assert.rejects(f.service.preview('caller-tenant-A','campaign'),error('forbidden'));assert.equal(f.reads(),0);
 for(const g of [{...grant('A'),approved:false},{...grant('A'),expiresAt:1000},{...grant('A'),campaignId:'other'}]){const f=fixture([],g);await assert.rejects(f.service.preview('verified-A','campaign'),error('forbidden'));assert.equal(f.reads(),0);}
});
test('A/B plans use trusted source scope; mixed company batch fails without partial output',async()=>{
 const f=fixture([contact('A-first'),contact('B-foreign','B')]);await assert.rejects(f.service.preview('verified-A','campaign'),error('campaign_source_invalid'));
 const b=fixture([contact('B-contact','B')],grant('B'));assert.deepEqual((await b.service.preview('verified-A','campaign')).proposedContactIds,['B-contact']);assert.equal(b.scopes[0].tenantId,'B');
 // Token name is synthetic; resolver controls verified binding, never caller tenant text.
});
test('opt-out, inactive permission, unknown history, recency and cooldown excluded',async()=>{
 const rows=[contact('opt','A',{optOut:true}),contact('permission','A',{permission:{...contact('x').permission,active:false}}),contact('unknown','A',{historyComplete:false}),contact('recent','A',{lastInteractionAt:950}),contact('cooldown','A',{lastCampaignAt:980}),contact('eligible')];
 const r=await fixture(rows).service.preview('verified-A','campaign');assert.deepEqual(r.proposedContactIds,['eligible']);
 for(const k of ['optedOut','permissionMissingOrExpired','historyUnknown','recentInteraction','cooldown'])assert.equal(r.excluded[k],1);
});
test('duplicates all excluded; cap is explicit and ordering deterministic',async()=>{
 const g={...grant('A'),maxRecipients:1};const r=await fixture([contact('z'),contact('duplicate'),contact('a'),contact('duplicate')],g).service.preview('verified-A','campaign');
 assert.deepEqual(r.proposedContactIds,['a']);assert.equal(r.excluded.duplicate,2);assert.equal(r.excluded.overLimit,1);
});
test('no invented default windows/limits; invalid or oversized sources fail closed',async()=>{
 for(const g of [{...grant('A'),maxRecipients:null},{...grant('A'),inactiveForMs:0},{...grant('A'),cooldownMs:null}])await assert.rejects(fixture([],g).service.preview('verified-A','campaign'),error('campaign_source_invalid'));
 for(const rows of [null,Array.from({length:101},(_,i)=>contact('c'+i)),[contact('x','A',{lastInteractionAt:1001})],[contact('x','A',{permission:{...contact('x').permission,tenantId:'B'}})]])await assert.rejects(fixture(rows).service.preview('verified-A','campaign'),error('campaign_source_invalid'));
});
test('single-read snapshots preserve validated getter values and reject invalid first read',async()=>{
 let approvals=0,ids=0;const g={...grant('A'),get approved(){return ++approvals===1?true:false;}};const c={...contact('first'),get contactId(){return ++ids===1?'first':{};}};
 assert.deepEqual((await fixture([c],g).service.preview('verified-A','campaign')).proposedContactIds,['first']);assert.equal(approvals,1);assert.equal(ids,1);
 await assert.rejects(fixture([{...contact('x'),get contactId(){return {};}}]).service.preview('verified-A','campaign'),error('campaign_source_invalid'));
});
test('expiry during source read and source errors return no preview',async()=>{
 let time=1000;const service=createOfflineCampaignPreview({now:()=>time,resolveAuthorization:async()=>grant('A'),loadCandidates:async()=>{time=2000;return [contact('x')];}});await assert.rejects(service.preview('synthetic','campaign'),error('forbidden'));
 for(const key of ['resolveAuthorization','loadCandidates']){const deps={now:()=>1000,resolveAuthorization:async()=>grant('A'),loadCandidates:async()=>[contact('x')]};deps[key]=async()=>{throw new Error('private');};await assert.rejects(createOfflineCampaignPreview(deps).preview('synthetic','campaign'),error('campaign_source_unavailable'));}
});
test('missing activity and expired contact permission are not silently eligible',async()=>{
 const r=await fixture([contact('no-history','A',{lastInteractionAt:null}),contact('expired','A',{permission:{...contact('x').permission,expiresAt:1000}})]).service.preview('verified-A','campaign');assert.deepEqual(r.proposedContactIds,[]);assert.equal(r.excluded.historyUnknown,1);assert.equal(r.excluded.permissionMissingOrExpired,1);
});
