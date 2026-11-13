import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import vm from 'node:vm';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {blankState,reduceRecord,reduceLog,SessionTail} from './monitor-core.mjs';
import {CodexTrafficCounters} from './network.mjs';
import {NetworkHistory} from './network-history.mjs';
const base=Date.parse('2026-11-01T00:00:00Z');
const rec=(type,payload,delta=0)=>({type,payload,timestamp:new Date(base+delta).toISOString()});
const start=(id,delta=0)=>rec('event_msg',{type:'task_started',turn_id:id},delta);
const log=(id,delta,body,precise=true)=>({id,ts:Math.floor((base+delta)/1000),...(precise?{ts_nanos:delta%1000*1e6}:{}),target:'codex_api::retry',feedback_log_body:body});
function activity(){const c=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('./activity-tree.js',import.meta.url),'utf8'),c);return c.CodexMonitorActivity;}

test('task start and all terminal events preserve record milliseconds instead of coarse payload seconds',()=>{
 const {buildTree,formatDuration,liveDuration}=activity();
 for(const type of ['task_complete','task_completed','turn_aborted','turn_failed']){
  const state=blankState('s');
  reduceRecord(state,rec('event_msg',{type:'task_started',turn_id:'precise',started_at:base/1000},524));
  assert.equal(state.startedAt,base+524);assert.equal(liveDuration(state.startedAt,base+5246),'4 秒');
  reduceRecord(state,rec('event_msg',{type,turn_id:'precise',started_at:base/1000,completed_at:base/1000+5},5246));
  assert.equal(state.endedAt,base+5246);
  const root=buildTree(state).roots[0];assert.equal(root.event.durationMs,4722);assert.equal(formatDuration(root.event.durationMs),'4 秒');
  assert.equal(state.status,type.startsWith('task_complete')?'completed':'terminated');
 }
});

test('task timing falls back to payload fields when event timestamps are missing or invalid',()=>{
 for(const recordTimestamp of [undefined,'invalid']){
  const state=blankState('s');
  reduceRecord(state,{type:'event_msg',timestamp:recordTimestamp,payload:{type:'task_started',turn_id:'fallback',started_at:base/1000}});
  reduceRecord(state,{type:'event_msg',timestamp:recordTimestamp,payload:{type:'task_complete',turn_id:'fallback',completed_at:base/1000+5}});
  assert.equal(state.startedAt,base);assert.equal(state.endedAt,base+5000);
 }
 const endedOnly=blankState('s');
 reduceRecord(endedOnly,rec('event_msg',{type:'task_complete',started_at:base/1000,completed_at:base/1000+5},5246));
 assert.equal(endedOnly.startedAt,base);assert.equal(endedOnly.endedAt,base+5246);
});

test('archived and replayed tasks keep millisecond boundaries when the next turn starts',()=>{
 const tail=new SessionTail('',blankState('s'));
 tail.consume([
  rec('event_msg',{type:'task_started',turn_id:'old',started_at:base/1000},524),
  rec('event_msg',{type:'task_complete',turn_id:'old',completed_at:base/1000+5},5246),
  rec('event_msg',{type:'task_started',turn_id:'next',started_at:base/1000+6},6789)
 ].map(JSON.stringify).join('\n')+'\n');
 const old=tail.getTurns(base,'old').find(turn=>turn.turnId==='old');
 assert.equal(old.startedAt,base+524);assert.equal(old.endedAt,base+5246);assert.equal(tail.state.startedAt,base+6789);
 const {buildTree}=activity();assert.equal(buildTree(old).roots[0].event.durationMs,4722);
});

test('first-second SQL events retain nanoseconds and respect exact turn bounds',()=>{
 const s=blankState('s');reduceRecord(s,start('one',500));
 reduceLog(s,log(1,700,'request timed out'));assert.equal(s.failures,1);assert.equal(s.events.find(e=>e.connectionType).at,base+700);
 reduceLog(s,log(2,400,'request timed out'));assert.equal(s.failures,1);
 reduceRecord(s,rec('event_msg',{type:'task_complete',turn_id:'one'},800));
 reduceLog(s,log(3,900,'request timed out'));assert.equal(s.failures,1);
 const legacy=blankState('s');reduceRecord(legacy,start('one',500));reduceLog(legacy,log(1,700,'request timed out',false));assert.equal(legacy.failures,1);
});
test('late logs update archived turns; early next-turn logs wait for their JSONL start',()=>{
 const tail=new SessionTail('',blankState('s'));tail.accept(start('one'));tail.accept(rec('event_msg',{type:'task_complete',turn_id:'one'},4000));tail.accept(start('two',5000));
 tail.acceptLog(log(1,3000,'turn_id=one request timed out'));tail.acceptLog(log(2,3500,'falling back to HTTP'));
 assert.equal(tail.turns.get('one').failures,1);assert.equal(tail.turns.get('one').fallbacks,1);assert.equal(tail.state.failures,0);
 tail.acceptLog(log(3,6500,'turn_id=three stream disconnected - retrying retries=1 max_retries=5'));assert.equal(tail.pendingLogs.size,1);
 tail.accept(start('three',6000));tail.flushLogs();assert.equal(tail.pendingLogs.size,0);assert.equal(tail.state.retries,1);
 tail.acceptLog(log(3,6500,'turn_id=three stream disconnected - retrying retries=1 max_retries=5'));assert.equal(tail.state.retries,1);
 tail.acceptLog(log(4,6700,'request timed out'));assert.equal(tail.state.failures,1);assert.equal(tail.turns.get('two').failures,0);
});
test('a truncated session resets log routing and coarse ambiguous boundaries are not guessed',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-truncate-regression-')),file=path.join(dir,'session.jsonl');
 try{
  fs.writeFileSync(file,[start('one',100),rec('event_msg',{type:'task_complete',turn_id:'one'},300),start('two',500)].map(JSON.stringify).join('\n')+'\n');
  const tail=new SessionTail(file,blankState('s'));tail.poll();tail.acceptLog(log(1,600,'request timed out',false));assert.equal(tail.pendingLogs.size,1);assert.equal(tail.state.failures,0);assert.equal(tail.turns.get('one').failures,0);
  tail.acceptLog(log(2,600,'request timed out'));assert.equal(tail.state.failures,1);
  fs.writeFileSync(file,JSON.stringify(start('replacement',1000))+'\n');tail.poll();assert.equal(tail.logRevision,1);assert.equal(tail.turns.size,0);assert.equal(tail.pendingLogs.size,0);assert.equal(tail.logStates().length,1);
  tail.acceptLog(log(1,1100,'request timed out'));assert.equal(tail.state.failures,1);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('cached running turns outside the restart replay window become unconfirmed and can recover',()=>{
 const {WindowHistory,buildTimeline}=activity(),history=new WindowHistory({getItem:()=>null,setItem(){}},base);
 const original={...blankState('s'),turnId:'old',startedAt:base,status:'running',events:[{key:'start',at:base,kind:'start'},{key:'call:1',at:base+500,startedAt:base+500,operation:true,status:'running',toolLabel:'本地命令'}]};history.remember(original);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-replay-regression-')),file=path.join(dir,'session.jsonl');
 try{
  fs.writeFileSync(file,[start('old'),rec('event_msg',{type:'task_complete',turn_id:'old'},1000),start('middle',2000),rec('response_item',{type:'function_call_output',call_id:'large',output:'x'.repeat(9*1024*1024)},3000),rec('event_msg',{type:'task_complete',turn_id:'middle'},4000),start('next',5000)].map(JSON.stringify).join('\n')+'\n');
  const tail=new SessionTail(file,blankState('s'));tail.poll();assert.equal(tail.state.turnId,'next');assert.equal(tail.turns.has('old'),false);
  let rounds=history.remember(tail.state,tail.getTurns(base,'old')),old=rounds.find(t=>t.turnId==='old');
  assert.equal(old.status,'unknown');assert.equal(old.unconfirmed,true);assert.equal(old.events[1].status,'unknown');assert.equal(old.events[1].durationMs,null);
  const tree=buildTimeline(rounds);
  const root=tree.roots.find(n=>n.event.taskStatus==='unconfirmed');assert.ok(root);assert.equal(root.groupRunning,false);
  const completed={...original,status:'completed',endedAt:base+1000,events:[{key:'turn-end:old',at:base+1000,label:'任务已完成',turnEnd:true,kind:'completed'}]};
  rounds=history.remember(tail.state,[completed,tail.state]);old=rounds.find(t=>t.turnId==='old');assert.equal(old.status,'completed');assert.equal(old.unconfirmed,false);assert.equal(old.events[1].status,'unknown');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('unmatched process rates stay unknown independently of another matched process',()=>{
 let wall=base;const counter=new CodexTrafficCounters(()=>wall),p1={id:'100:1',pid:100,name:'codex.exe'},p2={id:'200:1',pid:200,name:'codex.exe'};
 const socket=(p,port)=>({processId:p.id,protocol:'tcp',localAddress:'127.0.0.1',localPort:port,remoteAddress:'127.0.0.1',remotePort:7897});
 const sample={processes:[p1,p2],sockets:[socket(p1,5000),socket(p2,6000)]};
 const conn=(id,port,bytes)=>({id,download:bytes,upload:bytes,start:new Date(base-1000).toISOString(),metadata:{sourceIP:'127.0.0.1',sourcePort:port,inboundIP:'127.0.0.1',inboundPort:7897,network:'tcp'}});
 counter.accept(sample,{connections:[conn('a',5000,0)]},0);wall+=1000;counter.accept(sample,{connections:[conn('a',5000,1000)]},1000);
 let snapshot=counter.snapshot(),a=snapshot.processes[0],b=snapshot.processes[1];assert.equal(a.receivedPerSecond,1000);assert.equal(b.status,'unmapped');assert.equal(b.receivedPerSecond,null);assert.equal(b.sentPerSecond,null);assert.equal(b.totalReceived,0);
 const history=new NetworkHistory({now:()=>wall});history.capture(snapshot);assert.equal(history.read({processId:p2.id}).points[0].receivedPerSecond,null);
 wall+=1000;counter.accept(sample,{connections:[conn('a',5000,2000),conn('b',6000,0)]},2000);assert.equal(counter.snapshot().processes[1].receivedPerSecond,null);
 wall+=1000;counter.accept(sample,{connections:[conn('a',5000,3000),conn('b',6000,500)]},3000);assert.equal(counter.snapshot().processes[1].receivedPerSecond,500);
 wall+=1000;counter.accept(sample,{connections:[conn('a',5000,3000),conn('b',6000,500)]},4000);assert.equal(counter.snapshot().processes[1].receivedPerSecond,0);
});
test('server keeps malformed requests isolated and preserves late logs across round/session switches',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-server-regression-'));let child;const id='aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb',other='aaaaaaaa-1111-2222-3333-cccccccccccc';
 const db=new DatabaseSync(path.join(dir,'logs_2.sqlite'));
 try{
  fs.mkdirSync(path.join(dir,'sessions'));const file=path.join(dir,'sessions','rollout-2026-11-01-'+id+'.jsonl');fs.writeFileSync(file,JSON.stringify(start('one',500))+'\n');fs.writeFileSync(path.join(dir,'sessions','rollout-2026-11-01-'+other+'.jsonl'),JSON.stringify(start('other'))+'\n');
  db.exec('CREATE TABLE logs(id INTEGER PRIMARY KEY,ts INTEGER,ts_nanos INTEGER,level TEXT,target TEXT,feedback_log_body TEXT,thread_id TEXT)');
  const insert=(row,thread=id)=>db.prepare('INSERT INTO logs VALUES(?,?,?,?,?,?,?)').run(row.id,row.ts,row.ts_nanos,'WARN',row.target,row.feedback_log_body,thread);
  insert(log(1,700,'turn_id=one request timed out'));
  child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',path.join(import.meta.dirname,'server.mjs'),'--port','0'],{env:{...process.env,CODEX_MONITOR_HOME:dir,CODEX_MONITOR_NETWORK_DISABLED:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  const origin=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('start timeout')),8000);child.stdout.on('data',b=>{const m=b.toString().match(/"url":"([^"]+)"/);if(m){clearTimeout(timer);resolve(m[1].replace(/\/$/,''));}});child.once('exit',()=>{clearTimeout(timer);reject(Error('early exit'));});});
  const get=async(thread=id)=>(await fetch(origin+'/api/state?session='+thread+'&historySince='+base+'&initialTurn=one')).json();
  let data=await get();assert.equal(data.state.failures,1);assert.equal(data.state.events.find(e=>e.connectionType==='failure').at,base+700);
  fs.appendFileSync(file,[rec('event_msg',{type:'task_complete',turn_id:'one'},4000),start('two',5000)].map(JSON.stringify).join('\n')+'\n');await get();
  insert(log(2,3500,'turn_id=one stream disconnected - retrying retries=1 max_retries=5'));insert(log(3,6000,'turn_id=two falling back to HTTP'));
  data=await get();assert.equal(data.turns.find(t=>t.turnId==='one').retries,1);assert.equal(data.state.fallbacks,1);assert.equal(data.state.retries,0);
  await get(other);data=await get();assert.equal(data.turns.find(t=>t.turnId==='one').retries,1);assert.equal(data.state.fallbacks,1);
  insert(log(4,7500,'turn_id=three request timed out'));await get();fs.appendFileSync(file,JSON.stringify(start('three',7000))+'\n');data=await get();assert.equal(data.state.failures,1);
  const status=await new Promise((resolve,reject)=>{const request=http.get(origin+'//[',response=>{response.resume();resolve(response.statusCode);});request.on('error',reject);});assert.equal(status,400);assert.equal((await (await fetch(origin+'/api/health')).json()).app,'codex-local-monitor');
  await fetch(origin+'/api/shutdown',{method:'POST',headers:{Origin:origin,'X-Monitor-Action':'shutdown'}});await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));
 }finally{db.close();if(child&&child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}fs.rmSync(dir,{recursive:true,force:true});}
});
