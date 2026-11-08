"use strict";
// Explicit entrypoint: imports no queue/scheduler, Banker, payment or legacy AI routes.
if(require.main===module){
 require('dotenv/config');
 const {createClient}=require('@supabase/supabase-js');
 const {createConversationApp}=require('./conversation-app.cjs');
 const port=Number(process.env.JAMES_PORT??3002);
 if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid JAMES_PORT');
 createConversationApp({env:process.env,createClient}).listen(port,'127.0.0.1',()=>{
  console.log(`James conversation listener on loopback:${port}; provider requires explicit budget authorization`);
 });
}
