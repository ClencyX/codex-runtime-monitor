import test from 'node:test';
import assert from 'node:assert/strict';
import {blankState,reduceRecord,SessionTail,terminationCause} from './monitor-core.mjs';
import './activity-tree.js';
const base=Date.parse('2026-11-01T04:00:00Z'),rec=(payload,ms=0)=>({type:'event_msg',payload,timestamp:new Date(base+ms).toISOString()});
function fixture(){const state=blankState('s');reduceRecord(state,rec({type:'task_started',turn_id:'t'}));return state;}
test('task_complete with a quota error is terminated, even though the event name says complete',()=>{
 const s=fixture();reduceRecord(s,{type:'response_item',timestamp:new Date(base+1000).toISOString(),payload:{type:'function_call',name:'exec_command',call_id:'pending'}});
 const end=rec({type:'task_complete',turn_id:'t',error:{message:'Internal error: You have hit your usage limit. PRIVATE_TOKEN',codex_error_info:'Other'},completed_at:base+5000},5000);
 reduceRecord(s,end);reduceRecord(s,end);
 assert.equal(s.status,'terminated');assert.equal(s.terminationReason,'到达额度');assert.equal(s.endedAt,base+5000);assert.equal(s.pending.length,0);assert.equal(s.events.find(e=>e.callId==='pending').status,'unknown');
 assert.equal(s.events.filter(e=>e.turnEnd).length,1);assert.equal(s.events.at(-1).label,'任务终止（到达额度）');assert.ok(!JSON.stringify(s).includes('PRIVATE_TOKEN'));
 const tree=globalThis.CodexMonitorActivity.buildTree(s);assert.equal(tree.roots[0].event.status,'terminated');assert.equal(tree.roots[0].event.terminationReason,'到达额度');assert.equal(tree.roots[0].event.durationMs,5000);
 reduceRecord(s,rec({type:'task_complete',turn_id:'t'},6000));assert.equal(s.status,'terminated');assert.equal(s.terminationReason,'到达额度');
});
test('normal completion, discussion of quota and recovered command errors remain completed',()=>{
 const s=fixture();reduceRecord(s,rec({type:'item_completed',item:{type:'CommandExecution',id:'bad',exit_code:1}},1000));
 reduceRecord(s,rec({type:'task_complete',turn_id:'t',error:null,last_agent_message:'Discussion of usage limit, not an error field.'},2000));
 assert.equal(s.status,'completed');assert.equal(s.terminationReason,null);assert.equal(s.events.find(e=>e.itemId==='bad').status,'failed');
});
test('explicit stop reasons are classified; ambiguous interruption is not guessed',()=>{
 for(const [reason,expected] of [['manual_pause','手动暂停'],['user_cancelled','手动暂停'],['new_user_message','新对话插入'],['interrupted','用户中断'],['unknown_external_reason','原因未知']]){
  const s=fixture();reduceRecord(s,rec({type:'turn_aborted',turn_id:'t',reason},2000));assert.equal(s.status,'terminated');assert.equal(s.terminationReason,expected);
 }
});
test('other terminal errors have a reason while original error bodies stay private',()=>{
 for(const [code,expected] of [['context_length_exceeded','上下文超限'],['request_timeout','请求超时'],['network_connection_failed','网络连接异常'],['approval_rejected','审批未通过'],['max_output_tokens','输出长度限制'],['authentication_failed','身份验证失败'],['unexpected_internal_error','运行错误']])assert.equal(terminationCause({type:'turn_failed',error:{code,message:'PRIVATE_DETAILS'}}).reason,expected);
});
test('a new turn replacing a running one records insertion without inventing an end timestamp',()=>{
 const tail=new SessionTail('',blankState('s'));tail.accept(rec({type:'task_started',turn_id:'old'}));tail.accept(rec({type:'task_started',turn_id:'new'},5000));
 const old=tail.getTurns(base,'old')[0];assert.equal(old.status,'terminated');assert.equal(old.terminationReason,'新对话插入');assert.equal(old.endedAt,null);assert.equal(old.terminationAt,base+5000);
 const tree=globalThis.CodexMonitorActivity.buildTree(old);assert.equal(tree.roots[0].event.durationMs,null);assert.equal(tail.state.status,'running');assert.equal(tail.state.terminationReason,null);
});
test('a later question does not change an already completed or explicitly stopped turn',()=>{
 for(const event of [{type:'task_complete'},{type:'turn_aborted',reason:'manual_pause'}]){
  const tail=new SessionTail('',blankState('s'));tail.accept(rec({type:'task_started',turn_id:'old'}));tail.accept(rec({...event,turn_id:'old'},1000));tail.accept(rec({type:'task_started',turn_id:'new'},2000));
  const old=tail.getTurns(base,'old')[0];assert.equal(old.status,event.type==='task_complete'?'completed':'terminated');assert.equal(old.terminationReason,event.type==='task_complete'?null:'手动暂停');
 }
});
test('ordinary user steering within the same turn is not task termination',()=>{
 const s=fixture();reduceRecord(s,{type:'response_item',timestamp:new Date(base+1000).toISOString(),payload:{type:'message',role:'user',content:[{text:'请继续，并使用黄色'}]}});assert.equal(s.status,'running');assert.equal(s.terminationReason,null);
});
