"use strict";
const express=require('express');
const cors=require('cors');
const {configuredHandler}=require('../../shared/james-integration.cjs');
const {createAuthenticatedSearchBridge}=require('./public-search-bridge.cjs');
function createConversationApp(deps){
 const app=express();const origins=(deps.env.CORS_ORIGINS??'http://localhost:5173').split(',').map(s=>s.trim()).filter(Boolean);
 app.disable('x-powered-by');app.use(cors({origin:(origin,done)=>done(null,!origin||origins.includes(origin))}));
 app.use(express.json({limit:'32kb'}));const handle=configuredHandler(deps);
 app.post('/api/james/conversation',async(req,res)=>{const r=await handle(req);res.setHeader('Cache-Control','no-store');res.status(r.status).json(r.body);});
 const search=createAuthenticatedSearchBridge(deps);
 app.get('/api/search/capabilities',async(req,res)=>{const r=await search.capabilities(req);res.setHeader('Cache-Control','no-store');res.status(r.status).json(r.body);});
 app.post('/api/search',async(req,res)=>{const r=await search.search(req);res.setHeader('Cache-Control','no-store');res.status(r.status).json(r.body);});
 app.use((_req,res)=>res.status(404).json({code:'route_not_available'}));
 return app;
}
module.exports={createConversationApp};
