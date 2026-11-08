'use strict';
const {createHash}=require('node:crypto');
class BudgetError extends Error {
 constructor(code='budget_unavailable',beforeDispatch=false){super('Orçamento não confirmado. Nenhuma repetição automática; consulte o responsável.');this.code=code;this.status=503;this.beforeDispatch=beforeDispatch;}
}
function createBudgetStore(db,env=process.env){
 return {async execute({scope,requestId,payload,send}){
  if(env.JAMES_BUDGET_ENABLED!=='true')throw new BudgetError('budget_disabled',true);
  if(!scope || !requestId)throw new BudgetError('budget_memory_required',true);
  // Homologation covers only this exact text-only Responses payload contract.
  // No tools, images, audio, previous responses, files or arbitrary extra billing dimensions.
  if(!payload || typeof payload!=='object' || Array.isArray(payload)
    || Object.keys(payload).some(k=>!['model','instructions','input','max_output_tokens','store'].includes(k))
    || typeof payload.model!=='string' || !payload.model || payload.model.length>100
    || (payload.instructions!==undefined && typeof payload.instructions!=='string')
    || payload.max_output_tokens!==600 || payload.store!==false || !Array.isArray(payload.input)
    || payload.input.some(t=>!t || typeof t!=='object' || Array.isArray(t)
      || Object.keys(t).some(k=>!['role','content'].includes(k))
      || !['user','assistant'].includes(t.role) || typeof t.content!=='string'))
   throw new BudgetError('budget_invalid_payload',true);
  const encoded=JSON.stringify(payload);
  const fingerprint=createHash('sha256').update(encoded).digest('hex');
  async function call(action,data={}){
   let result;
   try{result=await db.rpc('nucleo_budget_v1',{p_action:action,p_user:scope.userId,p_tenant:scope.tenantId,p_session:scope.sessionId,p_contact:scope.contactId??null,p_request:requestId,p_data:data});}
   catch{throw new BudgetError();}
   if(result?.error || !result?.data)throw new BudgetError();
   if(result.data.ok!==true)throw new BudgetError(result.data.code||'budget_unavailable',action==='reserve' && !['budget_uncertain','budget_conflict'].includes(result.data.code));
   return result.data;
  }
  const held=await call('reserve',{model:payload.model,fingerprint,bytes:Buffer.byteLength(encoded),maxOutput:payload.max_output_tokens,payloadContract:'responses_text_only_v1'});
  if(held.state==='completed')return held.response;
  if(held.state!=='reserved')throw new BudgetError();
  // Never dispatch if acknowledgement was lost; durable state blocks any replay.
  const dispatched=await call('dispatch');
  if(dispatched.state!=='dispatched')throw new BudgetError();
  try{
   const response=await send();
   const usage=response?.usage;
   if(!Number.isSafeInteger(usage?.input_tokens)||usage.input_tokens<0||!Number.isSafeInteger(usage?.output_tokens)||usage.output_tokens<0)
    throw new BudgetError('budget_invalid_usage');
   const done=await call('settle',{input:usage.input_tokens,output:usage.output_tokens,response});
   if(done.state!=='completed')throw new BudgetError();
   return response;
  }catch(error){
   try{await call('uncertain');}catch{/* Keep dispatched hold if persistence unavailable. */}
   // A 429/timeout/invalid body is NOT proof that nothing was billed.
   if(error instanceof BudgetError)throw error;
   throw new BudgetError('budget_uncertain');
  }
 }};
}
module.exports={BudgetError,createBudgetStore};
