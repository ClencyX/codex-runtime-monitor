import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {blankState,reduceRecord,reduceLog,SessionTail} from './monitor-core.mjs';
const base=Date.parse('2026-11-01T00:00:00Z');
const record=(type,payload,ms=0)=>({type,payload,timestamp:new Date(base+ms).toISOString()});
const start=s=>reduceRecord(s,record('event_msg',{type:'task_started',turn_id:'turn-one'}));
const call=(s,id,ms=1000,type='function_call')=>reduceRecord(s,record('response_item',{type,name:'exec_command',call_id:id,arguments:'private-command',input:'private-input'},ms));
const returned=(s,id,ms=6000,type='function_call_output')=>reduceRecord(s,record('response_item',{type,call_id:id,output:'private-output'},ms));

test('one call retains one row and its original start time through return',()=>{
 const s=blankState();start(s);call(s,'one');const event=s.events.find(e=>e.callId==='one'),key=event.key;
 assert.equal(event.status,'running');assert.equal(event.durationMs,null);assert.equal(s.pending.length,1);
 returned(s,'one');assert.equal(s.events.filter(e=>e.callId==='one').length,1);assert.strictEqual(s.events.find(e=>e.callId==='one'),event);
 assert.equal(event.key,key);assert.equal(event.at,base+1000);assert.equal(event.endedAt,base+6000);assert.equal(event.durationMs,5000);assert.equal(event.status,'returned');assert.equal(s.pending.length,0);
 assert.equal(s.lastActivityAt,base+6000);assert.equal(s.lastAction,event.label);
 assert.ok(!JSON.stringify(s).includes('private-command'));assert.ok(!JSON.stringify(s).includes('private-output'));
});
test('simultaneous same-name calls pair by ID even when returning in reverse order',()=>{
 const s=blankState();start(s);call(s,'a');call(s,'b');assert.equal(s.pending.length,2);
 returned(s,'b',3000);assert.equal(s.events.find(e=>e.callId==='a').status,'running');assert.equal(s.events.find(e=>e.callId==='b').durationMs,2000);
 returned(s,'a',7000);assert.equal(s.events.find(e=>e.callId==='a').durationMs,6000);assert.equal(s.events.filter(e=>e.operation).length,2);
});
test('duplicate lifecycle messages are idempotent and custom calls use the same row',()=>{
 const s=blankState();start(s);call(s,'custom',1000,'custom_tool_call');call(s,'custom',1000,'custom_tool_call');
 assert.equal(s.pending.length,1);returned(s,'custom',4000,'custom_tool_call_output');returned(s,'custom',4500,'custom_tool_call_output');
 assert.equal(s.events.filter(e=>e.callId==='custom').length,1);assert.equal(s.events.find(e=>e.callId==='custom').durationMs,3000);
});
test('more than twenty outstanding calls remain independently tracked',()=>{
 const s=blankState();start(s);for(let i=0;i<30;i++)call(s,'call-'+i,1000+i);
 assert.equal(s.pending.length,30);for(let i=29;i>=0;i--)returned(s,'call-'+i,5000+i);
 assert.equal(s.pending.length,0);assert.equal(s.events.filter(e=>e.status==='running').length,0);assert.equal(s.events.filter(e=>e.operation).length,30);
});
test('missing or reversed bounds stay unknown, while a measured zero remains zero',()=>{
 const sample=payload=>{const s=blankState();start(s);reduceRecord(s,record('event_msg',{type:'item_completed',item:{type:'commandExecution'},...payload},2000));return s;};
 for(const payload of [{},{started_at_ms:base+1000},{completed_at_ms:base+2000},{started_at_ms:0,completed_at_ms:0},{started_at_ms:base+3000,completed_at_ms:base+2000}]){
  const s=sample(payload),event=s.events.find(e=>e.operation);assert.equal(s.lastTool.durationMs,null);assert.equal(event.durationMs,null);assert.equal(event.status,'returned');
 }
 assert.equal(sample({started_at_ms:base+1000,completed_at_ms:base+1000}).lastTool.durationMs,0);
 assert.equal(sample({started_at_ms:base+1000,completed_at_ms:base+2000}).lastTool.durationMs,1000);
});
test('an item completion with the same call ID updates the existing operation',()=>{
 const s=blankState();start(s);call(s,'same');
 reduceRecord(s,record('event_msg',{type:'item_completed',item:{type:'commandExecution',id:'same'}},4000));
 returned(s,'same',4500);assert.equal(s.events.filter(e=>e.operation).length,1);assert.equal(s.events.find(e=>e.callId==='same').durationMs,3000);assert.equal(s.pending.length,0);
});
test('unfinished calls become unconfirmed on turn end and cannot keep a live timer',()=>{
 for(const type of ['task_complete','turn_aborted','turn_failed']){
  const s=blankState();start(s);call(s,'pending');reduceRecord(s,record('event_msg',{type,turn_id:'turn-one'},4000));
  const event=s.events.find(e=>e.callId==='pending');assert.equal(event.status,'unknown');assert.equal(event.durationMs,null);assert.equal(event.endedAt,null);assert.equal(s.pending.length,0);
 }
 const s=blankState();start(s);call(s,'old');reduceRecord(s,record('event_msg',{type:'task_started',turn_id:'turn-two'},5000));returned(s,'old',6000);assert.equal(s.events.filter(e=>e.operation).length,0);
});
test('late old logs cannot replace the latest operation-return summary',()=>{
 const s=blankState();start(s);call(s,'one');returned(s,'one');const action=s.lastAction;
 reduceLog(s,{ts:(base+3000)/1000,feedback_log_body:'Compressed request body post_compression_bytes=123'});
 assert.equal(s.lastAction,action);assert.equal(s.lastActivityAt,base+6000);
});
test('incremental replay updates the same operation instead of adding an end row',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-activity-row-')),file=path.join(dir,'session.jsonl');
 try{
  const begin=record('response_item',{type:'function_call',name:'exec_command',call_id:'tail'},1000);fs.writeFileSync(file,JSON.stringify(begin)+'\n');
  const s=blankState(),tail=new SessionTail(file,s);tail.poll();const event=s.events[0];assert.equal(event.status,'running');
  fs.appendFileSync(file,JSON.stringify(record('response_item',{type:'function_call_output',call_id:'tail'},4000))+'\n');tail.poll();
  assert.equal(s.events.length,1);assert.strictEqual(s.events[0],event);assert.equal(event.durationMs,3000);assert.equal(event.status,'returned');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
