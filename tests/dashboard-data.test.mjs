import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { monthWindow, groupFinances, countLeads, conversionRate, readAllRows, loadDashboard, createRequestGate } from '../src/lib/dashboard-data.ts'
const now = new Date('2026-01-15T12:00:00Z')
const window = monthWindow(now)
test('six UTC months preserve year boundaries', () => {
  assert.deepEqual(window, { start: '2025-08-01T00:00:00.000Z', end: '2026-02-01T00:00:00.000Z' })
  assert.deepEqual(groupFinances([], window.start, window.end).map(p => p.month), ['Ago/25','Set/25','Out/25','Nov/25','Dez/25','Jan/26'])
})
test('finance sums reconcile cents and include zero months', () => {
  const points = groupFinances([{ transaction_date:'2026-01-02',amount:'10.10' },{ transaction_date:'2026-01-12',amount:0.20 }],window.start,window.end)
  assert.equal(points.length,6); assert.equal(points.at(-1).value,10.30); assert.equal(points[0].value,0)
})
test('malformed or out-of-window finance values fail instead of becoming zero', () => {
  for(const row of [null,{}, {transaction_date:'bad',amount:1},{transaction_date:'2026-01-02',amount:''},{transaction_date:'2026-01-02',amount:Infinity},{transaction_date:'2026-02-01',amount:1}]) assert.throws(() => groupFinances([row],window.start,window.end))
})
test('lead totals retain all statuses and distinguish no denominator', () => {
  const counts = countLeads(['new','contacted','qualified','converted','lost'].map(status=>({status})))
  assert.equal(conversionRate(counts),20); assert.equal(conversionRate(countLeads([])),null)
  assert.throws(()=>countLeads([{status:'unverified'}]))
})
test('pagination keeps tenant and exact requested bounds',async()=>{
  const calls=[]; const first=Array.from({length:1000},(_,id)=>({id,status:'new'}))
  const rows=await readAllRows(async(...args)=>{calls.push(args);return {data:args[2]===0?first:[{id:1000,status:'converted'}],error:null,count:1001}},'leads','tenant-a',window.start,window.end)
  assert.equal(rows.length,1001);assert.deepEqual(calls.map(c=>c.slice(0,4)),[['leads','tenant-a',0,999],['leads','tenant-a',1000,1999]])
})
test('no tenant cannot query; partial and changed pages fail closed',async()=>{
  let calls=0
  await assert.rejects(readAllRows(async()=>{calls++;return {}},'leads','',window.start,window.end));assert.equal(calls,0)
  for(const result of [{data:[],error:Error('offline'),count:0},{data:[],error:null,count:null},{data:[],error:null,count:1},{data:[{}],error:null,count:0}]) await assert.rejects(readAllRows(async()=>result,'leads','a',window.start,window.end))
  let page=0;await assert.rejects(readAllRows(async()=>({data:[{}],error:null,count:++page===1?2:3}),'leads','a',window.start,window.end))
})
test('unavailable resource never erases healthy resource or reports zero',async()=>{
 const result=await loadDashboard(async(table)=>table==='finances'?{data:null,error:Error('denied'),count:null}:{data:[],error:null,count:0},'a',now)
 assert.deepEqual(result.billing,{status:'error'});assert.equal(result.leads.status,'ready');assert.equal(conversionRate(result.leads.data),null)
})
test('latest refresh and cleanup invalidate earlier results',()=>{
 const gate=createRequestGate();const first=gate.begin();const second=gate.begin();assert.equal(first(),false);assert.equal(second(),true);gate.cancel();assert.equal(second(),false)
})
test('conversion footer does not append a second percent or percent to unavailable',()=>{
 const source=readFileSync(new URL('../src/pages/Dashboard.tsx',import.meta.url),'utf8')
 assert.ok(!source.includes('\x60\x24{conversionRate}%\x60'), 'conversionRate already includes percent or unavailable text')
 assert.ok(source.includes(": conversionRate}</span>"))
})
