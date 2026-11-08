"use strict";
const {createConversationHandler,createOpenAIResponder,ConversationError}=require('./james-conversation.cjs');
const {createSupabaseMemoryStore}=require('./james-memory.cjs');
const {createBudgetStore}=require('./james-budget.cjs');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function configuredHandler({env,createClient,fetchImpl=globalThis.fetch}) {
 return async request=>{
  let db;
  const unavailable=()=>{throw new ConversationError(503,'auth_unavailable','Configuracao de acesso ainda nao autorizada.');};
  const handle=createConversationHandler({
   respond:createOpenAIResponder({env,fetchImpl}),
   authenticate:async()=>{
    const token=/^Bearer ([^\s,]+)$/.exec(request.headers?.authorization??'')?.[1];if(!token)return null;
    if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_KEY)unavailable();
    db=createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const mode=env.JAMES_AUTH_MODE??'nucleo';let user;
    if(mode==='nucleo'){
     const result=await db.auth.getUser(token);if(result.error||!result.data?.user)return null;user=result.data.user;
    }else if(mode==='qadma'){
     if(!env.QADMA_SUPABASE_URL||!env.QADMA_SUPABASE_PUBLISHABLE_KEY||![env.QADMA_PILOT_ORGANIZATION_ID,env.QADMA_PILOT_USER_ID,env.NUCLEO_PILOT_TENANT_ID].every(v=>typeof v==='string'&&UUID.test(v)))unavailable();
     const qadma=createClient(env.QADMA_SUPABASE_URL,env.QADMA_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}});
     const result=await qadma.auth.getUser(token);if(result.error||!result.data?.user||result.data.user.id!==env.QADMA_PILOT_USER_ID)return null;user=result.data.user;
     const membership=await qadma.from('organization_users').select('organization_id,is_active').eq('user_id',user.id).eq('organization_id',env.QADMA_PILOT_ORGANIZATION_ID).eq('is_active',true).maybeSingle();
     if(membership.error||membership.data?.organization_id!==env.QADMA_PILOT_ORGANIZATION_ID||membership.data?.is_active!==true)return null;
    }else unavailable();
    const profile=await db.from('profiles').select('tenant_id').eq('id',user.id).single();
    if(profile.error||!UUID.test(profile.data?.tenant_id??''))return null;
    if(mode==='qadma'&&profile.data.tenant_id!==env.NUCLEO_PILOT_TENANT_ID)return null;
    // The memory/budget RPCs recheck private membership in the transaction.
    // This bridge never creates profiles, organizations, grants or memberships.
    return {userId:user.id,tenantId:profile.data.tenant_id};
   },memory:async()=>{
    if(env.JAMES_MEMORY_ENABLED!=='true')throw new ConversationError(503,'memory_unavailable','Memoria persistente precisa ser habilitada no ambiente autorizado.');
    return createSupabaseMemoryStore(db);
   },budget:async()=>createBudgetStore(db,env)
  });
  return handle(request);
 };
}
module.exports={configuredHandler};
