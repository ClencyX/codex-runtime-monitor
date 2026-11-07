import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {QuotaLedger,QuotaMonitor} from './quota.mjs';
import {QuotaReader} from './quota-reader.mjs';

const base=Date.parse('2026-11-07T08:00:00Z'),reset=base+18000000,weeklyReset=base+6*86400000;
const limits=(five=23,week=78,r=reset)=>({limit_id:'codex',primary:five===null?null:{used_percent:five,window_minutes:300,resets_at:r/1000},secondary:week===null?null:{used_percent:week,window_minutes:10080,resets_at:weeklyReset/1000}});
const rec=(type,payload,ms)=>({type,payload,timestamp:new Date(base+ms).toISOString()});
const begin=(id,ms)=>rec('event_msg',{type:'task_started',turn_id:id},ms),end=(id,ms)=>rec('event_msg',{type:'task_complete',turn_id:id},ms);
const sample=(five,week,ms)=>rec('event_msg',{type:'token_count',rate_limits:limits(five,week)},ms);
function fixture(){let now=base+100000;const ledger=new QuotaLedger({now:()=>now});return {ledger,clock:ms=>now=base+ms,put:(r,s='a',internal=false)=>ledger.observe(s,r,internal),snapshot:s=>ledger.snapshot(now,s)};}

test('late lower quota snapshots from another conversation cannot roll the remaining balance back',()=>{
 const f=fixture();f.put(sample(24,78,0),'fast');f.put(sample(23,77,1000),'slow');const q=f.snapshot();assert.equal(q.windows.fiveHour.remainingPercent,76);assert.equal(q.windows.weekly.remainingPercent,22);
});
test('five-hour and weekly windows are recognized by duration regardless of primary/secondary order',()=>{
 const f=fixture(),p=limits(23,78);[p.primary,p.secondary]=[p.secondary,p.primary];f.ledger.quota(p,base);const q=f.snapshot();assert.equal(q.windows.fiveHour.remainingPercent,77);assert.equal(q.windows.weekly.remainingPercent,22);
});
test('fresh official reads can apply genuine corrections and suppress temporarily stale log snapshots',()=>{
 const f=fixture();f.put(sample(24,78,0));f.ledger.quota(limits(23,77),base+1000,'official');f.put(sample(24,78,2000));assert.equal(f.snapshot().windows.fiveHour.remainingPercent,77);assert.equal(f.snapshot().windows.fiveHour.source,'official');
});
test('new reset cycles permit lower usage and old-cycle snapshots cannot revive old balances',()=>{
 const f=fixture();f.ledger.quota(limits(90,78),base);f.ledger.quota(limits(1,78,reset+18000000),base+1000);f.ledger.quota(limits(91,78),base+2000);assert.equal(f.snapshot().windows.fiveHour.remainingPercent,99);
});
test('explicitly absent five-hour quota is hidden; sparse updates do not remove existing windows',()=>{
 const f=fixture();f.put(sample(23,78,0));f.ledger.quota({limit_id:'codex',secondary:limits().secondary},base+1000);assert.equal(f.snapshot().windows.fiveHour.available,true);f.ledger.quota(limits(null,79),base+2000,'official');const q=f.snapshot();assert.equal(q.windows.fiveHour.available,false);assert.equal(q.windows.weekly.remainingPercent,21);
});
test('other model pools, invalid percentages and future records do not replace ordinary Codex quota',()=>{
 const f=fixture();f.put(sample(23,78,0));f.ledger.quota({...limits(99,99),limit_id:'spark'},base+1000);f.ledger.quota(limits(101,NaN),base+2000);f.put(sample(30,80,200000));assert.equal(f.snapshot().windows.fiveHour.remainingPercent,77);
});
test('per-turn records use observed account differences with a real zero preserved',()=>{
 const f=fixture();f.put(sample(23,78,0));f.put(begin('one',1000));f.put(sample(25,78,10000));f.put(end('one',11000));const q=f.snapshot('a');assert.equal(q.rounds[0].fiveHour.percent,2);assert.equal(q.rounds[0].weekly.percent,0);assert.equal(q.previousRound.turnId,'one');assert.ok(!('recent' in q));
});
test('running turns have provisional values but never replace the previous completed turn in the summary',()=>{
 const f=fixture();f.put(sample(23,78,0));f.put(begin('one',1000));f.put(sample(24,79,2000));f.put(end('one',3000));f.put(begin('two',4000));f.put(sample(25,79,5000));const q=f.snapshot('a');assert.equal(q.rounds[0].status,'running');assert.equal(q.rounds[0].fiveHour.percent,1);assert.equal(q.previousRound.turnId,'one');
});
test('selected-session history stays separate while account balances are shared and overlap is explicit',()=>{
 const f=fixture();f.put(sample(23,78,0));f.put(begin('one',1000));f.put(begin('other',2000),'b');f.put(sample(25,79,3000));f.put(end('one',4000));const a=f.snapshot('a'),b=f.snapshot('b');assert.equal(a.rounds.length,1);assert.equal(b.rounds.length,1);assert.equal(a.rounds[0].overlap,true);assert.equal(a.windows.fiveHour.remainingPercent,b.windows.fiveHour.remainingPercent);
});
test('internal review tasks are excluded from records but can mark concurrent account activity',()=>{
 const f=fixture();f.put(sample(23,78,0));f.put(begin('one',1000));f.put(begin('internal',2000),'internal',true);f.put(end('one',4000));const q=f.snapshot();assert.equal(q.rounds.length,1);assert.equal(q.rounds[0].overlap,true);
});
test('cross-reset rounds, missing snapshots, stale boundaries and collection gaps remain unknown',()=>{
 for(const mode of ['reset','missing','stale','gap']){const f=fixture();f.clock(420000);if(mode!=='missing')f.put(sample(23,78,0));f.put(begin('one',mode==='stale'?400000:1000));if(mode==='reset')f.ledger.quota(limits(1,79,reset+18000000),base+2000);if(mode==='gap')f.ledger.gap(base+1500,base+2500);f.put(end('one',mode==='stale'?410000:3000));const row=f.snapshot('a').rounds[0];assert.equal(row.fiveHour.percent,null,mode);}
});
test('a replaced task has an unconfirmed end rather than fabricated per-turn consumption',()=>{
 const f=fixture();f.put(sample(23,78,0));f.put(begin('one',1000));f.put(begin('two',2000));const row=f.snapshot('a').previousRound;assert.equal(row.status,'unknown');assert.equal(row.fiveHour.percent,null);
});
test('no snapshot within a turn is unknown, while an unchanged in-turn snapshot supports an observed zero',()=>{
 const f=fixture();f.put(sample(23,78,0));f.put(begin('one',1000));f.put(end('one',3000));assert.equal(f.snapshot('a').rounds[0].fiveHour.percent,null);f.put(sample(23,78,2000));assert.equal(f.snapshot('a').rounds[0].fiveHour.percent,0);
});
test('an official correction anywhere within a turn invalidates subtraction even after usage rises again',()=>{
 const f=fixture();f.put(sample(10,78,0));f.put(begin('one',1000));f.put(sample(15,78,2000));f.ledger.quota(limits(12,78),base+3000,'official');f.ledger.quota(limits(16,78),base+4000,'official');f.put(end('one',5000));assert.equal(f.snapshot('a').rounds[0].fiveHour.reason,'reset');
});
test('user titles are bounded, injected context is skipped and metadata does not expose tool arguments',()=>{
 const f=fixture();f.put(begin('one',1000));f.put(rec('response_item',{type:'message',role:'user',content:'# AGENTS.md instructions PRIVATE_CONTEXT'},1100));f.put(rec('response_item',{type:'message',role:'user',content:'User task '+ 'a'.repeat(500)},1200));f.put(rec('response_item',{type:'function_call',name:'exec',arguments:'PRIVATE_COMMAND'},1300));const q=f.snapshot();assert.equal(q.rounds[0].title.length,240);assert.doesNotMatch(JSON.stringify(q),/PRIVATE_CONTEXT|PRIVATE_COMMAND/);
});
test('reset countdown boundaries and stale balances retain their honest state',()=>{
 const f=fixture();f.put(sample(23,78,0));f.clock(200000);assert.equal(f.snapshot().windows.fiveHour.status,'stale');f.clock(18000000);assert.equal(f.snapshot().windows.fiveHour.status,'reset-pending');
});
test('collector incrementally reads split records and reconstructs rounds without new model calls',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quota-records-'));let now=base,monitor;const file=path.join(dir,'a.jsonl'),entries=[{id:'a',file}];
 try{fs.writeFileSync(file,JSON.stringify(sample(23,78,0))+'\n');monitor=new QuotaMonitor(dir,{now:()=>now});await monitor.poll(entries);now=base+1000;const text=JSON.stringify(begin('one',1000))+'\n';fs.appendFileSync(file,text.slice(0,12));await monitor.poll(entries);assert.equal(monitor.snapshot('a').rounds.length,0);fs.appendFileSync(file,text.slice(12));await monitor.poll(entries);assert.equal(monitor.snapshot('a').rounds.length,1);
 }finally{monitor?.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
test('selecting a large chat backfills bounded history once without ending an existing live turn',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quota-records-backfill-'));let now=base+3000,monitor;const file=path.join(dir,'a.jsonl'),entries=[{id:'a',file}];
 try{fs.writeFileSync(file,[sample(23,78,0),begin('one',100),{type:'padding',data:'x'.repeat(1200000)},sample(24,79,1000),end('one',2000),begin('two',2100)].map(JSON.stringify).join('\n')+'\n');monitor=new QuotaMonitor(dir,{now:()=>now});await monitor.poll(entries);assert.equal(monitor.snapshot('a').rounds.length,1);await monitor.poll(entries,'a');const q=monitor.snapshot('a');assert.equal(q.rounds.length,2);assert.equal(q.previousRound.fiveHour.percent,1);assert.equal(q.rounds[0].status,'running');await monitor.poll(entries,'a');assert.equal(monitor.snapshot('a').rounds[0].status,'running');
 }finally{monitor?.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
test('manual refresh shares an in-flight query, records official windows, and survives errors',async()=>{
 let resolve,calls=0,now=base;const reader={read(){calls++;return new Promise(r=>resolve=r);},stop(){}};const monitor=new QuotaMonitor('unused',{now:()=>now,reader});const a=monitor.refresh(),b=monitor.refresh();assert.equal(calls,1);resolve({rateLimits:limits(24,79)});assert.equal(await a,true);await b;assert.equal(monitor.snapshot().windows.weekly.remainingPercent,21);reader.read=async()=>{throw Error('PRIVATE_ERROR')};assert.equal(await monitor.refresh(),false);assert.equal(monitor.snapshot().refreshError,'unavailable');assert.doesNotMatch(JSON.stringify(monitor.snapshot()),/PRIVATE_ERROR/);monitor.stop();
});
function fakeSpawn({reply=true,error=false}={}){const methods=[];let process;
 return {methods,get child(){return process;},spawn(){process=new EventEmitter();process.exitCode=null;process.stdout=new PassThrough();process.kill=()=>{process.exitCode=0;process.emit('close',0);};process.stdin=new Writable({write(chunk,encoding,done){const m=JSON.parse(String(chunk));methods.push(m.method);if(reply&&m.id!==undefined)queueMicrotask(()=>process.stdout.write(JSON.stringify({id:m.id,...(error?{error:{code:-1,message:'PRIVATE'}}:{result:m.id===0?{}:{rateLimits:limits(24,79)}})})+'\n'));done();},final(done){process.exitCode=0;process.emit('close',0);done();}});return process;}};
}
test('official reader sends only initialization and quota-read messages, never thread/start or turn/start',async()=>{
 const f=fakeSpawn(),r=new QuotaReader('unused',{binary:'mock',spawnProcess:()=>f.spawn()});const result=await r.read();assert.ok(result.rateLimits);assert.deepEqual(f.methods,['initialize','initialized','account/rateLimits/read']);
});
test('official reader bounds timeouts and never returns raw backend error content',async()=>{
 for(const options of [{reply:false},{error:true}]){const f=fakeSpawn(options),r=new QuotaReader('unused',{binary:'mock',spawnProcess:()=>f.spawn(),timeoutMs:10});await assert.rejects(r.read(),e=>['timeout','unavailable'].includes(e.message));r.stop();}
});
test('quota UI supports both languages, countdowns, rings and no-five-hour accounts without HTML injection',()=>{
 const nodes=new Map(),element=()=>({textContent:'',hidden:false,dataset:{},style:{setProperty(k,v){this[k]=v;}},children:[],appendChild(n){this.children.push(n);},replaceChildren(...n){this.children=n;}}),c=vm.createContext({Date,Number,JSON,Event,document:{createElement:element,documentElement:{},querySelectorAll:()=>[],getElementById:()=>null,addEventListener(){}},addEventListener(){}});
 for(const file of ['i18n.js','quota-ui.js'])vm.runInContext(fs.readFileSync(new URL(file,import.meta.url),'utf8'),c);const get=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);},view=new c.CodexMonitorQuotaView(get,c.CodexMonitorI18n),f=fixture();f.put(sample(23,78,0));f.put(begin('one',1000));f.put(sample(25,79,2000));f.put(end('one',3000));let q=f.snapshot('a');view.render(q,true,base+100000);assert.equal(get('quota-five-value').textContent,'75%');assert.equal(get('quota-current-value').textContent,'2%');assert.equal(get('quota-previous-value').textContent,'—');assert.equal(get('quota-ring-week').style['--quota-fill'],'21%');assert.match(get('quota-five-countdown').textContent,/小时/);
 const running={...q.rounds[0],id:'new-turn',status:'running',fiveHour:{percent:0},weekly:{percent:0}};view.render({...q,rounds:[running,...q.rounds]});assert.equal(get('quota-current-value').textContent,'0%');assert.equal(get('quota-previous-value').textContent,'2%');
 view.render({...q,rounds:[{...running,status:'completed'},...q.rounds]});assert.equal(get('quota-current-value').textContent,'0%');assert.equal(get('quota-previous-value').textContent,'2%');
 view.render({...q,rounds:[{...running,fiveHour:{percent:null,reason:'missing'}},...q.rounds]});assert.equal(get('quota-current-value').textContent,'—');assert.equal(get('quota-previous-value').textContent,'2%');
 c.CodexMonitorI18n.setLanguage('en');view.render(q,true,base+100000);for(const node of nodes.values())assert.doesNotMatch(node.textContent,/[\u3400-\u9fff]/);assert.match(get('quota-week-countdown').textContent,/d/);
 f.ledger.quota(limits(null,80),base+100000,'official');q=f.snapshot('a');view.render(q);assert.equal(get('quota-mini-five').hidden,true);assert.match(get('quota-previous-label').textContent,/weekly/);assert.equal(get('quota-current-value').textContent,'1%');assert.equal(get('quota-previous-value').textContent,'—');assert.equal(get('quota-history').children.length,1);
});
test('both quota warnings appear strictly below ten percent and clear independently on recovery or missing data',()=>{
 const nodes=new Map(),node=()=>({textContent:'',hidden:false,dataset:{},style:{setProperty(){}},replaceChildren(){}}),context=vm.createContext({document:{createElement:node}});vm.runInContext(fs.readFileSync(new URL('./quota-ui.js',import.meta.url),'utf8'),context);
 const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},view=new context.CodexMonitorQuotaView(get,{translate:v=>v,locale:()=> 'zh-CN',language:'zh-CN'});
 for(const [value,available,warning] of [[9,true,true],[9.9,true,true],[10,true,false],[50,true,false],[0,true,true],[null,true,false],[NaN,true,false],[5,false,false]]){
  view.render({windows:{fiveHour:{available,remainingPercent:value},weekly:{available,remainingPercent:value}},rounds:[]});for(const kind of ['five','week']){assert.equal(get('quota-'+kind+'-progress').dataset.low,String(warning));assert.equal(get('quota-ring-'+kind).dataset.low,String(warning));}
 }
 view.render({windows:{fiveHour:{available:true,remainingPercent:9},weekly:{available:true,remainingPercent:10}},rounds:[]});assert.equal(get('quota-five-progress').dataset.low,'true');assert.equal(get('quota-week-progress').dataset.low,'false');
 view.render({windows:{fiveHour:{available:true,remainingPercent:10},weekly:{available:true,remainingPercent:9}},rounds:[]});assert.equal(get('quota-five-progress').dataset.low,'false');assert.equal(get('quota-week-progress').dataset.low,'true');
});
test('server exposes selected round records, protects refresh and removes the former rate-reset endpoint',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'quota-records-server-'));let child;const id='aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb';fs.mkdirSync(path.join(dir,'sessions'));fs.writeFileSync(path.join(dir,'sessions','rollout-'+id+'.jsonl'),JSON.stringify(begin('one',0))+'\n');
 try{child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',path.join(import.meta.dirname,'server.mjs'),'--port','0'],{env:{...process.env,CODEX_MONITOR_HOME:dir,CODEX_MONITOR_NETWORK_DISABLED:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});const origin=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('timeout')),8000);child.stdout.on('data',b=>{const m=b.toString().match(/"url":"([^"]+)"/);if(m){clearTimeout(timer);resolve(m[1].replace(/\/$/,''));}});child.once('exit',()=>{clearTimeout(timer);reject(Error('early exit'));});});
  const state=await(await fetch(origin+'/api/state?session='+id)).json();assert.equal(state.quota.scope,'account-quota-observed-turns');assert.equal((await fetch(origin+'/api/quota/reset',{method:'POST'})).status,404);assert.equal((await fetch(origin+'/api/quota/refresh',{method:'POST',headers:{Origin:'https://other.example','X-Monitor-Action':'refresh-quota'}})).status,403);const response=await fetch(origin+'/api/quota/refresh',{method:'POST',headers:{Origin:origin,'X-Monitor-Action':'refresh-quota'}});assert.ok([202,429].includes(response.status));
  await fetch(origin+'/api/shutdown',{method:'POST',headers:{Origin:origin,'X-Monitor-Action':'shutdown'}});await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));
 }finally{if(child&&child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}fs.rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:50});}
});
