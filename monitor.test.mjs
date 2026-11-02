import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {blankState,reduceRecord,reduceLog,SessionTail,discoverSessions,visibleSessions} from './monitor-core.mjs';
const base=Date.parse('2026-10-30T10:00:00Z');
const rec=(type,payload,ms=0)=>({type,payload,timestamp:new Date(base+ms).toISOString()});
const start=(s,id='turn-a')=>reduceRecord(s,rec('event_msg',{type:'task_started',turn_id:id,started_at:base/1000}));

test('task lifecycle: tool timing, first reply, completion clears pending',()=>{
 const s=blankState('session');start(s);
 reduceRecord(s,rec('response_item',{type:'message',role:'assistant',content:[{text:'secret prompt'}]},1200));
 reduceRecord(s,rec('response_item',{type:'function_call',name:'exec_command',call_id:'c',arguments:'secret=abcdef'},2000));
 assert.equal(s.pending.length,1);
 reduceRecord(s,rec('response_item',{type:'function_call_output',call_id:'c',output:'private output'},3500));
 assert.equal(s.lastTool.durationMs,1500);assert.equal(s.firstReplyAt,base+1200);
 reduceRecord(s,rec('event_msg',{type:'task_complete',turn_id:'turn-a',completed_at:(base+8000)/1000},8000));
 assert.equal(s.status,'completed');assert.equal(s.endedAt,base+8000);assert.equal(s.pending.length,0);
 assert.ok(!JSON.stringify(s).includes('private output'));assert.ok(!JSON.stringify(s).includes('abcdef'));
});
test('old cancellation cannot cancel a newer turn; new turn clears counts',()=>{
 const s=blankState();start(s);s.retries=3;
 reduceRecord(s,rec('event_msg',{type:'task_started',turn_id:'turn-b',started_at:(base+10000)/1000},10000));
 reduceRecord(s,rec('event_msg',{type:'turn_aborted',turn_id:'turn-a'},11000));assert.equal(s.status,'running');assert.equal(s.retries,0);
 reduceRecord(s,rec('event_msg',{type:'turn_aborted',turn_id:'turn-b'},12000));assert.equal(s.status,'terminated');assert.equal(s.endedAt,base+12000);
});
test('retry logs are scoped to the current turn and exclude headers/secrets',()=>{
 const s=blankState();start(s);
 reduceLog(s,{ts:base/1000+1,feedback_log_body:'turn_id=turn-old stream disconnected - retrying sampling request retries=1 max_retries=5'});assert.equal(s.retries,0);
 reduceLog(s,{ts:base/1000+2,feedback_log_body:'turn_id=turn-a stream disconnected - retrying sampling request retries=1 max_retries=5 Bearer secret-token'});assert.equal(s.retries,1);
 reduceLog(s,{ts:base/1000+3,feedback_log_body:'turn_id=turn-a Compressed request body post_compression_bytes=123456'});assert.equal(s.requestBytes,123456);
 assert.ok(!JSON.stringify(s).includes('secret-token'));
 reduceRecord(s,rec('event_msg',{type:'task_complete',turn_id:'turn-a'},4000));
 reduceLog(s,{ts:base/1000+5,feedback_log_body:'request timed out'});assert.equal(s.failures,0);
});
test('structured plans have explicit completed count, no inferred percent',()=>{
 const s=blankState();start(s);reduceRecord(s,rec('response_item',{type:'function_call',name:'update_plan',call_id:'p',arguments:JSON.stringify({plan:[{step:'读取',status:'completed'},{step:'制作',status:'in_progress'}]})},1000));
 assert.equal(s.plan.length,2);assert.equal(s.plan[1].status,'inProgress');assert.equal(s.plan.filter(x=>x.status==='completed').length,1);
});
test('incremental tail survives partial UTF-8 lines and does not reread events',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-monitor-tail-')),file=path.join(dir,'session.jsonl');
 try{const line=Buffer.from(JSON.stringify(rec('event_msg',{type:'task_started',turn_id:'turn-a',note:'中文测试'}))+'\n');const split=line.indexOf(Buffer.from('中'))+1;
 fs.writeFileSync(file,line.subarray(0,split));const s=blankState(),tail=new SessionTail(file,s);tail.poll();assert.equal(s.status,'unknown');
 fs.appendFileSync(file,line.subarray(split));tail.poll();assert.equal(s.status,'running');assert.equal(s.events.length,1);tail.poll();assert.equal(s.events.length,1);
 fs.appendFileSync(file,'broken json\n'+JSON.stringify(rec('event_msg',{type:'turn_aborted',turn_id:'turn-a'},2000))+'\n');tail.poll();assert.equal(s.status,'terminated');
 fs.writeFileSync(file,JSON.stringify(rec('event_msg',{type:'task_started',turn_id:'b'}))+'\n');tail.poll();assert.equal(s.turnId,'b');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('server: read-only SQLite, live tail, error isolation, origin protection and shutdown',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-monitor-integration-'));let child,origin;const id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
 try{
 const sessions=path.join(dir,'sessions','2026','10','30');fs.mkdirSync(sessions,{recursive:true});const file=path.join(sessions,`rollout-2026-10-30T10-00-00-${id}.jsonl`);
 fs.writeFileSync(file,JSON.stringify(rec('event_msg',{type:'task_started',turn_id:'turn-a',started_at:base/1000}))+'\n');
 const db=new DatabaseSync(path.join(dir,'logs_2.sqlite'));db.exec('CREATE TABLE logs(id INTEGER PRIMARY KEY,ts INTEGER,level TEXT,target TEXT,feedback_log_body TEXT,thread_id TEXT)');
 db.prepare('INSERT INTO logs VALUES(1,?,?,?,?,?)').run(base/1000+1,'WARN','retry','turn_id=turn-a stream disconnected - retrying retries=1 max_retries=5 Bearer HIDDEN',id);db.close();
 const original=fs.readFileSync(path.join(dir,'logs_2.sqlite'));
 child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',path.join(import.meta.dirname,'server.mjs'),'--port','0'],{env:{...process.env,CODEX_MONITOR_HOME:dir,CODEX_MONITOR_NETWORK_DISABLED:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});
 origin=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('Server start timeout')),8000);child.stdout.on('data',b=>{const match=b.toString().match(/"url":"([^"]+)"/);if(match){clearTimeout(timeout);resolve(match[1].replace(/\/$/,''));}});child.on('exit',code=>{clearTimeout(timeout);reject(Error('Exited '+code));});});
 let r=await fetch(origin+'/api/state'),d=await r.json();assert.equal(d.state.status,'running');assert.equal(d.state.retries,1);assert.equal(d.network.status,'disabled');assert.equal(d.network.scope,'codex-proxy');assert.equal(d.network.receivedPerSecond,null);assert.ok(!JSON.stringify(d).includes('HIDDEN'));
 r=await fetch(origin+'/api/state?session=../../auth.json');assert.equal(r.status,404);
 r=await fetch(origin+'/api/shutdown',{method:'POST',headers:{Origin:'https://foreign.example','X-Monitor-Action':'shutdown'}});assert.equal(r.status,403);
 fs.appendFileSync(file,JSON.stringify(rec('event_msg',{type:'turn_aborted',turn_id:'turn-a'},2000))+'\n');
 d=await (await fetch(origin+'/api/state?session='+id)).json();assert.equal(d.state.status,'terminated');
 assert.deepEqual(fs.readFileSync(path.join(dir,'logs_2.sqlite')),original);
 r=await fetch(origin+'/api/shutdown',{method:'POST',headers:{Origin:origin,'X-Monitor-Action':'shutdown'}});assert.equal(r.status,200);
 await new Promise((resolve,reject)=>{if(child.exitCode!==null)return resolve();const t=setTimeout(()=>reject(Error('Shutdown timeout')),4000);child.on('exit',()=>{clearTimeout(t);resolve();});});
 }finally{if(child&&child.exitCode===null)child.kill();fs.rmSync(dir,{recursive:true,force:true});}
});

test('activity history retains older events beyond the former 45-entry cap',()=>{
 const s=blankState();start(s);
 for(let i=1;i<=240;i++)reduceRecord(s,rec('response_item',{type:'message',role:'assistant'},i*1000));
 assert.equal(s.events.length,241);assert.equal(s.events[0].label,'任务已记录');assert.equal(s.events.at(-1).at,base+240000);
 reduceRecord(s,rec('response_item',{type:'message',role:'assistant'},240000));assert.equal(s.events.length,241);
 reduceRecord(s,rec('event_msg',{type:'task_started',turn_id:'new-turn',started_at:(base+241000)/1000},241000));assert.equal(s.events.length,1);
});

test('Guardian sessions are identified by metadata, not a user-visible title',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-monitor-classification-'));
 try{
  const folder=path.join(dir,'sessions','2026','10','30');fs.mkdirSync(folder,{recursive:true});
  const guardian='11111111-1111-1111-1111-111111111111',normal='22222222-2222-2222-2222-222222222222';
  fs.writeFileSync(path.join(folder,'rollout-2026-10-30T10-00-00-'+guardian+'.jsonl'),JSON.stringify({type:'session_meta',payload:{source:{subagent:{other:'guardian'}}}})+'\n');
  fs.writeFileSync(path.join(folder,'rollout-2026-10-30T10-00-00-'+normal+'.jsonl'),JSON.stringify({type:'session_meta',payload:{source:'cli'}})+'\n');
  fs.writeFileSync(path.join(dir,'session_index.jsonl'),[guardian,normal].map(id=>JSON.stringify({id,thread_name:'Guardian review'})).join('\n'));
  const all=discoverSessions(dir);assert.equal(all.find(s=>s.id===guardian).isGuardianReview,true);assert.equal(all.find(s=>s.id===normal).isGuardianReview,false);
  assert.deepEqual(visibleSessions(all).map(s=>s.id),[normal]);assert.equal(visibleSessions(all,true).length,2);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('recent Guardian traffic cannot crowd ordinary sessions out',()=>{
 const list=Array.from({length:80},(_,i)=>({id:'review-'+i,isGuardianReview:true,mtime:1000+i}));
 list.push({id:'main',isGuardianReview:false,mtime:1});
 assert.deepEqual(visibleSessions(list).map(s=>s.id),['main']);assert.ok(visibleSessions(list,true).some(s=>s.id==='main'));
});

test('discovery keeps active old chats and ordinary chats beyond 500 newer Guardian files',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-monitor-discovery-'));
 try{
  const folder=path.join(dir,'sessions');fs.mkdirSync(folder);
  const write=(id,date,guardian,mtime)=>{const file=path.join(folder,`rollout-${date}-${id}.jsonl`);fs.writeFileSync(file,JSON.stringify({type:'session_meta',payload:{source:guardian?{subagent:{other:'guardian'}}:'cli'}})+'\n');fs.utimesSync(file,mtime/1000,mtime/1000);};
  const active='11111111-1111-1111-1111-111111111111',older='22222222-2222-2222-2222-222222222222';
  write(active,'2020-01-01',false,base+10000);write(older,'2020-01-02',false,base-10000);
  for(let i=0;i<510;i++)write(`aaaaaaaa-bbbb-cccc-dddd-${i.toString(16).padStart(12,'0')}`,'2026-11-01',true,base+i);
  const all=discoverSessions(dir);
  assert.equal(all[0].id,active);assert.equal(all.filter(s=>s.isGuardianReview).length,500);
  assert.deepEqual(visibleSessions(all).map(s=>s.id),[active,older]);
  assert.equal(visibleSessions(all,true).length,52);
  const guardians=all.filter(s=>s.isGuardianReview);assert.equal(guardians[0].mtime,base+509);assert.equal(guardians.at(-1).mtime,base+10);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('ordinary discovery limit is applied after activity sorting, independently of creation date',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-monitor-discovery-limit-'));
 try{
  const folder=path.join(dir,'sessions');fs.mkdirSync(folder);
  const active='11111111-1111-1111-1111-111111111111',activeFile=path.join(folder,`rollout-2020-01-01-${active}.jsonl`);
  fs.writeFileSync(activeFile,JSON.stringify({type:'session_meta',payload:{source:'cli'}})+'\n');fs.utimesSync(activeFile,(base+10000)/1000,(base+10000)/1000);
  for(let i=0;i<500;i++){
   const file=path.join(folder,`rollout-2026-11-01-aaaaaaaa-bbbb-cccc-dddd-${i.toString(16).padStart(12,'0')}.jsonl`);
   fs.writeFileSync(file,JSON.stringify({type:'session_meta',payload:{source:'cli'}})+'\n');fs.utimesSync(file,(base+i)/1000,(base+i)/1000);
  }
  const all=discoverSessions(dir);assert.equal(all.length,500);assert.equal(all[0].id,active);assert.equal(all.at(-1).mtime,base+1);
  assert.equal(visibleSessions(all).length,50);assert.equal(visibleSessions(all)[0].id,active);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
