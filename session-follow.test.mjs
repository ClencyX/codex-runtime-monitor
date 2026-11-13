import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {latestStartedSession,visibleSessions} from './monitor-core.mjs';
import {QuotaMonitor} from './quota.mjs';
const base=Date.now()-60000;
const record=(type,payload,ms=0)=>JSON.stringify({timestamp:new Date(base+ms).toISOString(),type,payload})+'\n';
test('latest means latest recorded task start, not file touch or background activity',()=>{
 const sessions=[{id:'prepared',mtime:9000},{id:'old',mtime:8000},{id:'new',mtime:1},{id:'guardian',mtime:9999,isGuardianReview:true}];
 const starts=new Map([['old',100],['new',200],['guardian',300]]);
 assert.equal(latestStartedSession(sessions,starts).id,'new');
 assert.equal(latestStartedSession(sessions,new Map()),null);
 starts.set('old',400);assert.equal(latestStartedSession(sessions,starts).id,'old');
 const tied=new Map([['old',500],['new',500]]);assert.equal(latestStartedSession(sessions,tied).id,latestStartedSession([...sessions].reverse(),tied).id);
});
test('latest real session remains selectable beyond fifty more recently touched chats',()=>{
 const sessions=Array.from({length:70},(_,i)=>({id:'prepared-'+i,mtime:100-i}));sessions.push({id:'running',mtime:1});
 const choices=visibleSessions(sessions,false,'running');assert.equal(choices.length,50);assert.equal(choices[0].id,'running');
 sessions.push({id:'guardian',isGuardianReview:true,mtime:200});assert.ok(!visibleSessions(sessions,false,'guardian').some(s=>s.id==='guardian'));
});
test('following reuses local starts with official quota disabled and ignores non-start events',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-session-starts-'));const file=path.join(dir,'a.jsonl'),monitor=new QuotaMonitor(dir,{reader:{enabled:false,read:async()=>{throw Error('disabled');},stop(){}}});
 try{
  fs.writeFileSync(file,record('event_msg',{type:'task_started',turn_id:'a'}));
  const entry={id:'one',file};await monitor.poll([entry]);assert.equal(monitor.sessionStarts().get('one'),base);
  fs.appendFileSync(file,record('session_meta',{source:'cli'},2000)+record('turn_context',{model:'demo'},3000)+record('event_msg',{type:'token_count'},4000));
  await monitor.poll([entry]);assert.equal(monitor.sessionStarts().get('one'),base);
  fs.appendFileSync(file,record('event_msg',{type:'task_started',turn_id:'b'},5000));await monitor.poll([entry]);assert.equal(monitor.sessionStarts().get('one'),base+5000);
 }finally{monitor.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
test('API does not follow a prepared chat or a chat merely reopened after another task starts',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-session-follow-'));let child;
 const a='11111111-1111-1111-1111-111111111111',b='22222222-2222-2222-2222-222222222222';
 try{
  const folder=path.join(dir,'sessions');fs.mkdirSync(folder);const file=id=>path.join(folder,'rollout-demo-'+id+'.jsonl');
  fs.writeFileSync(file(a),record('event_msg',{type:'task_started',turn_id:'a'}));fs.writeFileSync(file(b),record('session_meta',{source:'cli'},1000));
  child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',path.join(import.meta.dirname,'server.mjs'),'--port','0'],{env:{...process.env,CODEX_MONITOR_HOME:dir,CODEX_MONITOR_NETWORK_DISABLED:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  const origin=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),8000);child.stdout.on('data',chunk=>{const match=chunk.toString().match(/"url":"([^"]+)"/);if(match){clearTimeout(timer);resolve(match[1].replace(/\/$/,''));}});child.once('exit',()=>{clearTimeout(timer);reject(Error('early exit'));});});
  const get=async id=>(await fetch(origin+'/api/state'+(id?'?session='+id:''))).json();
  const wait=async expected=>{for(let i=0;i<50;i++){const value=await get();if(value.latestSessionId===expected)return value;await new Promise(resolve=>setTimeout(resolve,100));}assert.fail('latest session did not update');};
  let data=await wait(a);assert.equal(data.state.id,a);
  data=await get(b);assert.equal(data.state.id,b);assert.equal(data.latestSessionId,a,'manual selection remains available');
  fs.appendFileSync(file(b),record('event_msg',{type:'task_started',turn_id:'b'},10000));await wait(b);
  fs.appendFileSync(file(a),record('turn_context',{model:'demo'},20000));data=await wait(b);assert.equal(data.latestSessionId,b);
  await new Promise(resolve=>setTimeout(resolve,1100));assert.equal((await get()).latestSessionId,b);
  await fetch(origin+'/api/shutdown',{method:'POST',headers:{Origin:origin,'X-Monitor-Action':'shutdown'}});await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));
 }finally{if(child&&child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}fs.rmSync(dir,{recursive:true,force:true});}
});
