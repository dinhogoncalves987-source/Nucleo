'use strict';
// Offline reference boundary, NOT an Auth/Redis/database integration.
const {randomUUID}=require('node:crypto');
class TenantJobError extends Error {
 constructor(code,status){super(code);this.code=code;this.status=status;}
}
const deny=(code,status)=>{throw new TenantJobError(code,status);};
const text=(s,max)=>typeof s==='string' && s.trim().length>0 && s.length<=max;
const identityId=s=>typeof s==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(s);
const permissions=new Set(['jobs:read','jobs:details','jobs:create','jobs:update']);
function snapshot(obj,keys,code,status,strict=true){
 try{
  if(!obj||typeof obj!=='object'||Array.isArray(obj))deny(code,status);
  if(strict&&Reflect.ownKeys(obj).some(k=>!keys.includes(k)))deny(code,status);
  const result=Object.create(null);
  for(const key of keys){
   if(!Object.hasOwn(obj,key))deny(code,status);
   result[key]=obj[key]; // Exactly one external value read, including accessors.
  }
  return Object.freeze(result);
 }catch{deny(code,status);}
}
function permissionSnapshot(value){
 try{
  if(!Array.isArray(value))deny('forbidden',403);
  const length=value.length;
  if(!Number.isSafeInteger(length)||length<0||length>permissions.size)deny('forbidden',403);
  const result=[];
  for(let i=0;i<length;i++)result.push(value[i]); // No untrusted iterator/some method.
  if(result.some(p=>!permissions.has(p)))deny('forbidden',403);
  return Object.freeze(result);
 }catch{deny('forbidden',403);}
}
const jobId=id=>typeof id==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
function createOfflineTenantJobs({verifyIdentity,resolveAccess,now=Date.now,contextTtlMs=60000}={}){
 if(typeof verifyIdentity!=='function'||typeof resolveAccess!=='function'||typeof now!=='function'
   ||!Number.isSafeInteger(contextTtlMs)||contextTtlMs<1||contextTtlMs>60000)deny('identity_source_unavailable',503);
 const contexts=new WeakMap(),partitions=new Map();
 function time(){
  let value;try{value=now();}catch{deny('authorization_unavailable',503);}
  if(!Number.isSafeInteger(value)||value<0)deny('authorization_unavailable',503);
  return value;
 }
 async function access(identity){
  let grant;
  try{grant=await resolveAccess(identity.subject,identity.sessionId);}catch{deny('authorization_unavailable',503);}
  const values=snapshot(grant,['active','tenantId','revision','permissions'],'forbidden',403,false);
  if(values.active!==true||!identityId(values.tenantId)||!Number.isSafeInteger(values.revision)||values.revision<1)deny('forbidden',403);
  // Validate the detached permission items and use those same items afterwards.
  return Object.freeze({tenantId:values.tenantId,revision:values.revision,permissions:permissionSnapshot(values.permissions)});
 }
 async function authenticate(credential){
  if(!text(credential,512))deny('unauthorized',401);
  let proof;
  try{proof=await verifyIdentity(credential);}catch{deny('identity_source_unavailable',503);}
  const identity=snapshot(proof,['subject','sessionId','expiresAt'],'unauthorized',401,false);
  if(!identityId(identity.subject)||!identityId(identity.sessionId)||!Number.isSafeInteger(identity.expiresAt)||identity.expiresAt<=time())deny('unauthorized',401);
  // Tenant fields in credentials/claims NEVER authorize. Only this trusted lookup does.
  const grant=await access(identity);
  const context=Object.freeze(Object.create(null));
  contexts.set(context,{...identity,...grant,expiresAt:Math.min(identity.expiresAt,time()+contextTtlMs)});
  return context;
 }
 async function check(context,permission){
  const saved=context && typeof context==='object'?contexts.get(context):null;
  if(!saved||saved.expiresAt<=time())deny('unauthorized',401);
  const current=await access(saved);
  // Membership/session revocation and scope changes invalidate already-issued contexts.
  if(saved.expiresAt<=time())deny('unauthorized',401);
  if(current.tenantId!==saved.tenantId||current.revision!==saved.revision)deny('context_stale',403);
  if(!current.permissions.includes(permission))deny('forbidden',403);
  return saved;
 }
 const partition=scope=>partitions.get(scope.tenantId);
 const project=j=>({id:j.id,kind:j.kind,title:j.title,status:j.status,version:j.version});
 function find(scope,id){
  if(!jobId(id))deny('invalid_job_id',400);
  const job=partition(scope)?.get(id);
  if(!job)deny('job_not_found',404); // foreign and nonexistent IDs are indistinguishable
  return job;
 }
 return Object.freeze({
  authenticate,
  async create(context,input){
   const scope=await check(context,'jobs:create');
   const values=snapshot(input,['kind','title','details'],'invalid_job',400);
   if(!['treasury_demo','education_demo'].includes(values.kind)||!text(values.title,100)||!text(values.details,1000))deny('invalid_job',400);
   // Tenant, owner, UUID, state and revision are assigned here, never from client input.
   const job={id:randomUUID(),tenantId:scope.tenantId,createdBy:scope.subject,kind:values.kind,title:values.title,details:values.details,status:'draft',version:1};
   let rows=partition(scope);if(!rows){rows=new Map();partitions.set(scope.tenantId,rows);}
   rows.set(job.id,job);return project(job);
  },
  async list(context){const scope=await check(context,'jobs:read');return [...(partition(scope)?.values()??[])].map(project);},
  async get(context,id){const scope=await check(context,'jobs:read');return project(find(scope,id));},
  async details(context,id){const scope=await check(context,'jobs:details');const job=find(scope,id);return {...project(job),details:job.details};},
  async summary(context){
   const scope=await check(context,'jobs:read');const counts={draft:0,reviewed:0,cancelled:0};
   for(const job of partition(scope)?.values()??[])counts[job.status]++;
   return counts;
  },
  async update(context,id,input){
   const scope=await check(context,'jobs:update');const job=find(scope,id);
   const values=snapshot(input,['expectedVersion','status'],'invalid_update',400);
   if(!Number.isSafeInteger(values.expectedVersion)||values.expectedVersion<1||!['reviewed','cancelled'].includes(values.status))deny('invalid_update',400);
   if(job.version!==values.expectedVersion)deny('version_conflict',409);
   if(job.status==='cancelled'||(job.status==='reviewed'&&values.status!=='cancelled'))deny('invalid_transition',409);
   // No await between compare-and-set. Atomic only within this process/event loop.
   job.status=values.status;job.version++;return project(job);
  },
 });
}
module.exports={TenantJobError,createOfflineTenantJobs};
