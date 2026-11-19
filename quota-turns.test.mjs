import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {QuotaLedger, QuotaMonitor} from './quota.mjs';
import {QuotaJournal} from './quota-journal.mjs';

const start = Date.parse('2026-11-19T05:00:00Z');
const five = 300 * 60_000, week = 10080 * 60_000;
const limit = (used, minutes, reset) => used === null ? null :
  {used_percent:used, window_minutes:minutes, resets_at:(start + reset) / 1000};
const limits = (f, w, r = five, s = week) => ({limit_id:'codex', primary:limit(f,300,r), secondary:limit(w,10080,s)});
function setup({since = start, journal = null} = {}) {
  let time = start;
  const now = () => time;
  const ledger = new QuotaLedger({now, since, journal});
  const tick = offset => time = start + offset;
  function point(ms, f, w, options = {}) {
    tick(ms);
    const {r, s, official = false, req = ms} = options;
    ledger.quota(limits(f,w,r,s),time,official?'official':'log',official?start+req:null);
  }
  function event(ms, type, turn = 'one', source = 'a') {
    tick(ms);
    ledger.observe(source,{type:'event_msg',timestamp:new Date(time).toISOString(),payload:{type,turn_id:turn}});
  }
  const row = (id = 'one') => ledger.snapshot(time,'a').rounds.find(t => t.turnId === id);
  return {ledger, tick, point, event, row};
}
const values = row => [row.fiveHour.percent,row.weekly.percent];

test('short turn accepts same-cycle log progress after an official balance and preserves a weekly zero',()=>{
  const f=setup();f.point(0,81,31,{official:true});f.event(14000,'task_started');
  assert.equal(f.row().fiveHour.reason,'pending');
  f.point(35054,81,31);f.point(44636,82,31);f.event(44657,'task_complete');
  assert.deepEqual(values(f.row()),[1,0]);assert.deepEqual(f.row().fiveHour.notes,[]);
  assert.equal(f.ledger.snapshot().windows.fiveHour.usedPercent,81);
});

test('global collection gaps and an ageing last reading cannot erase existing progress',()=>{
  const f=setup();f.point(0,89,32);f.event(100,'task_started');f.point(50000,90,33);f.ledger.gap(start+60000,start+72000);
  f.point(140000,92,33);f.tick(330000);assert.deepEqual(values(f.row()),[3,1]);assert.ok(f.row().fiveHour.notes.includes('end'));
  f.point(331000,93,34);f.event(332000,'task_complete');assert.deepEqual(values(f.row()),[4,2]);assert.deepEqual(f.row().weekly.notes,[]);
});

test('a stale baseline needs corroboration and a lone reading cannot manufacture a zero',()=>{
  const f=setup();f.point(0,60,29);f.event(240000,'task_started');f.point(250000,68,29);
  assert.deepEqual(values(f.row()),[null,0]);f.point(260000,76,30);f.event(265000,'task_complete');
  assert.deepEqual(values(f.row()),[8,1]);assert.deepEqual(f.row().fiveHour.notes,['start']);
  assert.deepEqual(f.row().weekly.notes,[]);
});

test('separate windows, reset drift, out-of-order input and parallel account observations',()=>{
  const f=setup();f.point(0,60,25);f.event(1000,'task_started');f.event(1500,'task_started','other','b');
  f.point(4000,70,29,{r:five-230000,s:week-230000});f.point(3000,65,27,{r:five+12000,s:week+12000});
  f.point(4500,68,28);f.event(5000,'task_complete');assert.deepEqual(values(f.row()),[10,4]);assert.equal(f.row().overlap,true);
  assert.deepEqual(f.row().weekly.notes,[]);
});

test('reset adds the two observed portions; an exhausted old cycle has no missing tail',()=>{
  const f=setup();f.point(0,60,15,{r:50000});f.event(1000,'task_started');f.point(45000,85,17,{r:50000});
  f.point(51000,3,17,{r:five+50000});f.point(52000,8,18,{r:five+50000});f.event(53000,'task_complete');
  assert.deepEqual(values(f.row()),[33,3]);assert.deepEqual(f.row().fiveHour.notes,['reset-gap']);assert.deepEqual(f.row().weekly.notes,[]);
  const g=setup();g.point(0,60,75,{s:10000});g.event(1000,'task_started');g.point(9000,60,100,{s:10000});
  g.point(11000,61,5,{s:week+10000});g.event(12000,'task_complete');assert.deepEqual(values(g.row()),[1,30]);assert.deepEqual(g.row().weekly.notes,[]);
});

test('expiry before a turn, repeated resets, and an old-cycle sample arriving late',()=>{
  const f=setup();f.point(0,90,10,{r:1000});f.event(2000,'task_started');f.point(3000,9,10,{r:five+1000});
  f.point(3500,99,10,{r:1000});f.point(4000,11,10,{r:five+1000});f.event(5000,'task_complete');
  assert.deepEqual(values(f.row()),[2,0]);assert.ok(f.row().fiveHour.notes.includes('start'));
  const g=setup();g.point(0,90,10,{r:10000});g.event(1000,'task_started');g.point(9000,100,10,{r:10000});
  g.point(11000,8,10,{r:five+10000});g.point(five+9000,100,11,{r:five+10000});
  g.point(five+11000,5,12,{r:2*five+10000});g.event(five+12000,'task_complete');
  assert.deepEqual(values(g.row()),[115,2]);
});

test('official correction recalculates net change and rejects stale rebounds; absent windows are independent',()=>{
  const f=setup();f.point(0,10,30);f.event(100,'task_started');f.point(1000,15,31);f.point(2000,12,31,{official:true});
  f.point(3000,15,31);assert.deepEqual(values(f.row()),[2,1]);f.point(4000,16,32);
  assert.deepEqual(values(f.row()),[6,2]);assert.ok(f.row().fiveHour.notes.includes('correction'));
  const g=setup();g.point(0,null,30,{official:true});g.event(100,'task_started');g.point(2000,null,31,{official:true});
  assert.equal(g.row().fiveHour.reason,'unavailable');assert.equal(g.row().weekly.percent,1);
});

test('end read is bounded, and cannot absorb another turn, a reset or a request begun before completion',()=>{
  const run=(extra,req=2100,delay=3000)=>{
    const f=setup();f.point(0,20,30);f.event(100,'task_started');f.event(2000,'task_complete');extra?.(f);
    f.point(delay,22,30,{official:true,req});return f.row();
  };
  assert.deepEqual(values(run()),[2,0]);assert.ok(run().fiveHour.notes.includes('after-end'));
  assert.deepEqual(values(run(f=>f.event(2500,'task_started','two','b'))),[null,null]);
  assert.deepEqual(values(run(f=>f.event(1500,'task_started','two','b'))),[null,null]);
  assert.deepEqual(values(run(null,1500)),[null,null]);assert.deepEqual(values(run(null,2100,16000)),[null,null]);
  const g=setup();g.point(0,99,30,{r:2600});g.event(100,'task_started');g.event(2000,'task_complete');
  g.point(3000,2,30,{official:true,req:2200,r:five+2600});assert.deepEqual(values(g.row()),[null,0]);
});

test('an in-flight query cannot undo newer progress or block a subsequent end reading',()=>{
  const f=setup();f.point(0,10,30);f.event(100,'task_started');f.point(1500,15,31);
  f.point(2000,12,30,{official:true,req:500});assert.deepEqual(values(f.row()),[5,1]);
  f.event(5000,'task_complete');f.point(5200,15,31,{official:true,req:4900});
  f.point(6000,16,31,{official:true,req:5500});assert.deepEqual(values(f.row()),[6,1]);
  const g=setup();g.event(0,'task_started');g.point(1000,1,1);g.point(1000,2,1,{official:true});
  g.event(2000,'task_complete');assert.deepEqual(values(g.row()),[null,null]);
});

test('the activation boundary and new evidence survive a process restart; old turns keep legacy behavior',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quota-cache-'));
  try{
    const first=new QuotaJournal(dir,start);const f=setup({journal:first});
    f.point(-2000,5,8);f.event(-1000,'task_started','old');f.point(-500,6,9);f.ledger.gap(start-700,start-550);f.event(-100,'task_complete','old');
    assert.equal(f.row('old').fiveHour.reason,'incomplete');
    f.point(0,81,31,{official:true});f.event(1000,'task_started');f.point(2000,82,31);f.event(2500,'task_complete');
    const next=new QuotaJournal(dir,start+60000);assert.equal(next.since,start);
    const after=new QuotaLedger({now:()=>start+60000,since:next.since,journal:next});
    assert.deepEqual(values(after.snapshot(undefined,'a').rounds[0]),[1,0]);assert.equal(after.tasks.size,1);
    assert.equal(after.snapshot(undefined,'a').rounds[0].status,'completed');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('oversized tool output does not erase quota in the emitting or a concurrent session',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quota-large-output-'));let now=start;
  const m=new QuotaMonitor(dir,{now:()=>now});
  const a=path.join(dir,'a.jsonl'),b=path.join(dir,'b.jsonl');
  const append=(file,type,payload)=>fs.appendFileSync(file,JSON.stringify({type,payload,timestamp:new Date(now).toISOString()})+'\n');
  const entries=[{id:'a',file:a},{id:'b',file:b}];
  try{
    append(a,'event_msg',{type:'token_count',rate_limits:limits(89,32)});fs.writeFileSync(b,'');await m.poll(entries,'a');
    now+=1000;for(const f of [a,b])append(f,'event_msg',{type:'task_started',turn_id:'run'});await m.poll(entries,'a');
    now+=2000;append(b,'response_item',{type:'custom_tool_call_output',output:'x'.repeat(2_650_000)});
    append(a,'event_msg',{type:'token_count',rate_limits:limits(92,33)});await m.poll(entries,'a');
    now+=100;for(const f of [a,b])append(f,'event_msg',{type:'task_complete',turn_id:'run'});await m.poll(entries,'a');
    for(const id of ['a','b']){const r=m.snapshot(id).rounds[0];assert.deepEqual(values(r),[3,1]);assert.equal(r.overlap,true);}
    assert.deepEqual(m.ledger.gaps,[]);
  }finally{m.stop();fs.rmSync(dir,{recursive:true,force:true});}
});

test('partial and pending values are visible in both languages in history and the folded panel',()=>{
  const el=()=>({textContent:'',dataset:{},style:{setProperty(){}},children:[],appendChild(n){this.children.push(n);},replaceChildren(...args){this.children=args;}});
  const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,el());return nodes.get(id);};
  const ctx=vm.createContext({document:{createElement:el,documentElement:{},querySelectorAll:()=>[],getElementById:()=>null,addEventListener(){}},addEventListener(){}});
  for(const file of ['i18n.js','quota-ui.js'])vm.runInContext(fs.readFileSync(new URL(file,import.meta.url),'utf8'),ctx);
  const ui=new ctx.CodexMonitorQuotaView(get,ctx.CodexMonitorI18n),f=setup();f.event(0,'task_started');
  for(const lang of ['en','zh-CN']){
    ctx.CodexMonitorI18n.setLanguage(lang);ui.render(f.ledger.snapshot(start,'a'));
    assert.equal(get('quota-current-value').textContent,lang==='en'?'Sampling…':'待采样');
  }
  f.point(10000,20,30);f.point(20000,25,30);f.event(21000,'task_complete');
  for(const lang of ['en','zh-CN']){
    ctx.CodexMonitorI18n.setLanguage(lang);ui.render(f.ledger.snapshot(start+22000,'a'));
    assert.equal(get('quota-current-value').textContent,'5%*');
    const row=get('quota-history').children[0];assert.equal(row.children[1].textContent,'5%*');
    assert.match(row.children[1].title,lang==='en'?/No opening reading/:/缺少开始读数/);
    assert.equal(row.children[2].textContent,'0%*');
  }
});

test('new turns request boundary reads, coalescing bursts without polling once per log event',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quota-boundary-'));let now=start,calls=0;
  const m=new QuotaMonitor(dir,{now:()=>now,reader:{read:async()=>{calls++;return {rateLimits:limits(20,30)};},stop(){}}});
  try{
    const file=path.join(dir,'events.jsonl');fs.writeFileSync(file,'');const entries=[{id:'a',file}];
    const event=type=>fs.appendFileSync(file,JSON.stringify({type:'event_msg',timestamp:new Date(now).toISOString(),payload:{type,turn_id:'one'}})+'\n');
    await m.poll(entries);await m.refreshing;assert.equal(calls,1);
    now+=4000;event('task_started');await m.poll(entries);await m.refreshing;assert.equal(calls,2);
    now+=500;event('task_complete');await m.poll(entries);assert.equal(calls,2);
    now+=2600;await m.poll(entries);await m.refreshing;assert.equal(calls,3);assert.equal(m.snapshot('a').rounds[0].fiveHour.percent,0);
  }finally{m.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
