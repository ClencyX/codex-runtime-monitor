import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {blankState,reduceRecord,reduceLog,SessionTail,promptTitle} from './monitor-core.mjs';
import './activity-tree.js';
const {buildTimeline,visibleRows,branchFor,WindowHistory,liveDuration}=globalThis.CodexMonitorActivity;
const base=Date.parse('2026-11-01T01:00:00Z');
const rec=(type,payload,ms=0)=>({type,payload,timestamp:new Date(base+ms).toISOString()});
const start=(id,ms=0)=>rec('event_msg',{type:'task_started',turn_id:id},ms);
const user=(text,ms=10)=>rec('response_item',{type:'message',role:'user',content:[{type:'input_text',text}]},ms);
const storage=()=>{const data=new Map();return {getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)};};

test('49 distinct model items are 49 rows across all three duplicate streams',()=>{
 const s=blankState();reduceRecord(s,start('t'));
 for(let i=0;i<49;i++){
  const id='rs_'+i,at=2000+i*1000;
  reduceRecord(s,rec('response_item',{type:'reasoning',id,summary:'PRIVATE_REASONING'},at));
  reduceRecord(s,rec('event_msg',{type:'item_completed',item:{type:'Reasoning',id,raw_content:'PRIVATE_REASONING'}},at+3));
  for(let n=0;n<2;n++)reduceLog(s,{ts:(base+at)/1000,feedback_log_body:`Output item item_type="reasoning" item_id="${id}" PRIVATE_BODY`});
 }
 const rows=s.events.filter(e=>e.key.startsWith('model:'));
 assert.equal(rows.length,49);assert.ok(rows.every(e=>e.sources.length===3));
 assert.ok(!JSON.stringify(s).includes('PRIVATE_'));
});
test('model ID remains stable when a low precision connection log arrives first',()=>{
 const s=blankState();reduceRecord(s,start('t'));
 reduceLog(s,{ts:(base+2000)/1000,feedback_log_body:'Output item item_type="reasoning" item_id="rs_a"'});
 const event=s.events.at(-1);
 reduceRecord(s,rec('response_item',{type:'reasoning',id:'rs_a'},2345));
 assert.strictEqual(s.events.at(-1),event);assert.equal(event.at,base+2345);assert.equal(s.events.length,2);
});
test('prompt titles preserve full text for width-based browser ellipsis',()=>{
 assert.equal(promptTitle('中'.repeat(80)+'😀'),'任务：'+'中'.repeat(80)+'😀');
 assert.equal(promptTitle('a'.repeat(100)),'任务：'+'a'.repeat(100));
 assert.equal(promptTitle('我同意'),'任务：我同意');
 assert.equal(promptTitle('抱歉取60个字节吧'),'任务：抱歉取60个字节吧');
 assert.equal(promptTitle('中'.repeat(18)+'a'),'任务：'+'中'.repeat(18)+'a');
 assert.equal(promptTitle('1'.repeat(51)+'😀'),'任务：'+'1'.repeat(51)+'😀');
 assert.equal(promptTitle('a'.repeat(55)),'任务：'+'a'.repeat(55));
 assert.equal(promptTitle('a'.repeat(56)),'任务：'+'a'.repeat(56));
 assert.equal(promptTitle('  第一行\n 第二行\t第三行  '),'任务：第一行 第二行 第三行');
 assert.equal(promptTitle('   '),null);
});
test('injected environment instructions are skipped and the first user prompt is retained',()=>{
 const s=blankState();reduceRecord(s,start('t'));
 reduceRecord(s,user('# AGENTS.md instructions\nINJECTED'));assert.equal(s.taskTitle,null);
 reduceRecord(s,user('<environment_context>INJECTED'));assert.equal(s.taskTitle,null);
 const prefix='1234567890'.repeat(5)+'12345';reduceRecord(s,user(prefix+'PRIVATE_REMAINDER'));
 reduceRecord(s,rec('event_msg',{type:'item_completed',item:{type:'UserMessage',content:[{type:'text',text:'later content'}]}},20));
 assert.equal(s.taskTitle,'任务：'+prefix+'PRIVATE_REMAINDER');assert.ok(!JSON.stringify(s).includes('INJECTED'));
 const native=blankState();reduceRecord(native,start('native'));
 reduceRecord(native,rec('event_msg',{type:'item_completed',item:{type:'UserMessage',content:[{type:'text',text:'原生消息'}]}},20));
 assert.equal(native.taskTitle,'任务：原生消息');
});
test('tail archives a whole completed turn even when end and next start arrive in one poll',()=>{
 const tail=new SessionTail('',blankState('s'));
 const consume=records=>tail.consume(records.map(JSON.stringify).join('\n')+'\n');
 consume([start('one'),user('第一轮'),rec('response_item',{type:'function_call',name:'apply_patch',call_id:'a'},1000)]);
 consume([rec('response_item',{type:'function_call_output',call_id:'a'},3000),rec('event_msg',{type:'task_complete',turn_id:'one'},4000),start('two',5000),user('第二轮',5100)]);
 const turns=tail.getTurns(base+100,'one');assert.equal(turns.length,2);
 assert.equal(turns[0].status,'completed');assert.equal(turns[0].endedAt,base+4000);assert.equal(turns[0].events.find(e=>e.callId==='a').durationMs,2000);
 assert.equal(turns[1].taskTitle,'任务：第二轮');
 // A late terminal notification with a known old turn ID updates that archive.
 tail.accept(rec('event_msg',{type:'turn_failed',turn_id:'one'},4500));assert.equal(turns[0].status,'terminated');assert.equal(turns[0].terminationReason,'运行错误');
 assert.equal(tail.state.status,'running');
});
test('missing previous end does not leave archived clocks running; repeated starts are idempotent',()=>{
 const tail=new SessionTail('',blankState('s'));tail.accept(start('one'));tail.accept(user('一'));
 tail.accept(rec('response_item',{type:'function_call',name:'exec_command',call_id:'a'},1000));
 tail.accept(start('one',1100));assert.equal(tail.state.events.length,2);
 tail.accept(start('two',2000));
 const old=tail.getTurns(base,'one')[0];assert.equal(old.status,'terminated');assert.equal(old.terminationReason,'新对话插入');assert.equal(old.events.find(e=>e.callId==='a').status,'unknown');
 assert.equal(old.events.find(e=>e.callId==='a').durationMs,null);
});
test('window keeps rounds across refresh/session switch and a new window begins with current round',()=>{
 const store=storage(),window=new WindowHistory(store,base+500);
 const first={...blankState('s'),turnId:'one',startedAt:base,status:'running'};
 window.remember(first);
 window.remember({...first,turnId:'two',startedAt:base+2000},[{...first,status:'completed',endedAt:base+1000}]);
 window.remember({...blankState('other'),turnId:'x',startedAt:base});
 const refreshed=new WindowHistory(store,base+3000);
 assert.equal(refreshed.since,base+500);assert.equal(refreshed.initial.s,'one');
 assert.equal(refreshed.remember({...first,turnId:'two',startedAt:base+2000}).length,2);
 const reopened=new WindowHistory(storage(),base+4000);
 assert.equal(reopened.remember({...first,turnId:'two',startedAt:base+2000},[first]).length,1);
});
test('timeline keeps task and operation keys distinct across turns without fabricating branches',()=>{
 const turn=id=>({id:'s',turnId:id,taskTitle:'任务：'+id+'...',status:'completed',startedAt:base,endedAt:base+5000,events:[
  {key:'start',at:base,kind:'start'},
  {key:'call:outer',callId:'outer',at:base+1000,startedAt:base+1000,operation:true,status:'returned'},
  {key:'call:child',callId:'child',parentCallId:'outer',at:base+2000,operation:true,status:'returned'}
 ]});
 const input=[turn('one'),turn('two')],original=JSON.stringify(input),tree=buildTimeline(input);
 const rows=visibleRows(tree,new Map([...tree.nodes.keys()].map(key=>[key,true])));
 assert.equal(tree.nodes.size,6);assert.equal(tree.roots.length,2);assert.equal(JSON.stringify(input),original);
 assert.ok(rows.filter(row=>row.depth===1).every(row=>branchFor(row)===''));
 assert.ok(rows.filter(row=>row.depth===2).every(row=>branchFor(row)==='└─'));
 assert.equal(visibleRows(tree,new Map([[tree.roots[0].event.key,false]])).filter(row=>row.node.event.groupRoot).length,2);
});
test('authoritative termination replaces a legacy cached success notice without losing other events',()=>{
 const window=new WindowHistory(storage(),base),first={...blankState('s'),turnId:'t',startedAt:base,status:'completed',events:[{key:'legacy',at:base+1000,kind:'completed',label:'任务已完成'},{key:'operation',at:base+500,operation:true,status:'failed',label:'本地命令已结束'}]};
 window.remember(first);
 const current={...first,status:'terminated',terminationReason:'到达额度',events:[{key:'turn-end:t',turnEnd:true,at:base+1000,kind:'warning',label:'任务终止（到达额度）'}]};
 const saved=window.remember(current)[0];assert.equal(saved.events.some(e=>e.label==='任务已完成'),false);assert.equal(saved.events.some(e=>e.key==='operation'),true);assert.equal(saved.events.filter(e=>e.turnEnd).length,1);
});
test('operation names are separate from status and native failures remain visible',()=>{
 const s=blankState();reduceRecord(s,start('t'));
 reduceRecord(s,rec('event_msg',{type:'item_completed',started_at_ms:base+1000,completed_at_ms:base+2000,item:{type:'FileChange',id:'file-a',status:'completed'}},2100));
 const file=s.events.find(e=>e.itemId==='file-a');assert.equal(file.toolLabel,'修改文件');assert.equal(file.status,'returned');
 reduceRecord(s,rec('event_msg',{type:'item_completed',item:{type:'CommandExecution',id:'exec-b',exit_code:1,status:'failed'}},3000));
 assert.equal(s.events.find(e=>e.itemId==='exec-b').status,'failed');
 reduceRecord(s,rec('response_item',{type:'custom_tool_call',name:'exec',call_id:'batch',input:'await tools.apply_patch(...)'},4000));
 assert.equal(s.events.find(e=>e.callId==='batch').toolLabel,'组合调用');
});
test('live clock truncates elapsed seconds and catches up after delayed ticks',()=>{
 assert.deepEqual([100,200,300,900,1000,1100].map(ms=>liveDuration(base,base+ms)),['100 毫秒','200 毫秒','300 毫秒','900 毫秒','1 秒','1 秒']);
 assert.equal(liveDuration(base,base+3570),'3 秒');assert.equal(liveDuration(base,base-100),'0 毫秒');
});
test('API preserves a completed turn through a switch and filters earlier rounds for new windows',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-monitor-history-'));let child;
 const id='aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb',other='aaaaaaaa-1111-2222-3333-cccccccccccc';
 try{
  const folder=path.join(dir,'sessions');fs.mkdirSync(folder);
  const file=path.join(folder,'rollout-2026-11-01-'+id+'.jsonl');
  fs.writeFileSync(file,[start('one'),user('第一轮')].map(JSON.stringify).join('\n')+'\n');
  fs.writeFileSync(path.join(folder,'rollout-2026-11-01-'+other+'.jsonl'),[start('other'),user('其他会话')].map(JSON.stringify).join('\n')+'\n');
  child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',path.join(import.meta.dirname,'server.mjs'),'--port','0'],{env:{...process.env,CODEX_MONITOR_HOME:dir,CODEX_MONITOR_NETWORK_DISABLED:'1'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  const origin=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('start timeout')),8000);child.stdout.on('data',b=>{const match=b.toString().match(/"url":"([^"]+)"/);if(match){clearTimeout(timer);resolve(match[1].replace(/\/$/,''));}});child.once('exit',()=>{clearTimeout(timer);reject(Error('early exit'));});});
  const get=async(session=id,initial='one')=>(await fetch(`${origin}/api/state?session=${session}&historySince=${base+500}&initialTurn=${initial}`)).json();
  await get();
  fs.appendFileSync(file,[rec('event_msg',{type:'task_complete',turn_id:'one'},1000),start('two',2000),user('第二轮',2010)].map(JSON.stringify).join('\n')+'\n');
  let d=await get();assert.equal(d.turns.length,2);assert.equal(d.turns[0].status,'completed');
  await get(other);d=await get();assert.equal(d.turns.length,2);assert.equal(d.turns[0].taskTitle,'任务：第一轮');
  d=await (await fetch(`${origin}/api/state?session=${id}&historySince=${base+3000}`)).json();assert.equal(d.turns.length,1);assert.equal(d.turns[0].turnId,'two');
  await fetch(origin+'/api/shutdown',{method:'POST',headers:{Origin:origin,'X-Monitor-Action':'shutdown'}});
  await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));
 }finally{if(child&&child.exitCode===null)child.kill();fs.rmSync(dir,{recursive:true,force:true});}
});
