import test from 'node:test';
import assert from 'node:assert/strict';
import {blankState,reduceRecord,reduceLog} from './monitor-core.mjs';

const base=Date.parse('2026-11-01T09:00:00Z');
function state(){const s=blankState('session');reduceRecord(s,{type:'event_msg',timestamp:new Date(base).toISOString(),payload:{type:'task_started',turn_id:'turn-a'}});return s;}
function log(s,id,body,extra={}){reduceLog(s,{id,ts:base/1000+1,target:'codex_api::retry',feedback_log_body:body,...extra});}

test('connection counters match unique records, even within the same second',()=>{
 const s=state(),body='stream disconnected - retrying request retries=1 max_retries=5';
 log(s,10,body);log(s,11,body);log(s,11,body);
 assert.equal(s.retries,2);assert.equal(s.events.filter(e=>e.connectionType==='retry').length,2);
 assert.deepEqual(s.events.filter(e=>e.connectionType==='retry').map(e=>e.key),['connection:10','connection:11']);
});
test('retry details include recorded attempt, cause and delay without raw payloads',()=>{
 const s=state();log(s,1,'stream disconnected - retrying request retries=2 max_retries=5 in 188ms request timed out Bearer SECRET_TOKEN command=PRIVATE_COMMAND');
 const event=s.events.find(e=>e.connectionType==='retry');
 assert.equal(event.label,'连接重试（本组 2/5）');assert.match(event.detail,/原因：请求超时/);assert.match(event.detail,/188 毫秒后重试/);
 assert.ok(!JSON.stringify(s).includes('SECRET_TOKEN'));assert.ok(!JSON.stringify(s).includes('PRIVATE_COMMAND'));
 assert.equal(event.durationMs,null);assert.equal(s.failures,0);
});
test('failure and fallback details expose only fixed reasons and safe numbers',()=>{
 const s=state();log(s,1,'Request failed /responses TLS certificate error status=502 Authorization: SECRET');
 log(s,2,'falling back to HTTP WebSocket secret.example/path?key=SECRET');
 assert.equal(s.failures,1);assert.equal(s.fallbacks,1);
 assert.equal(s.events.find(e=>e.connectionType==='failure').detail,'日志记录请求失败；原因：TLS 或证书错误；HTTP 状态 502');
 assert.equal(s.events.find(e=>e.connectionType==='fallback').detail,'传输回退：从 WebSocket 切换到 HTTP/HTTPS');
 assert.ok(!JSON.stringify(s).includes('SECRET'));assert.ok(!JSON.stringify(s).includes('secret.example'));
});
test('quoted model output and feedback tags do not create connection records',()=>{
 const s=state();log(s,1,'Output item item_type="message" body="request timed out; falling back to HTTP"');
 log(s,2,'stream disconnected - retrying request retries=1 max_retries=5',{target:'feedback_tags'});
 assert.equal(s.retries+s.failures+s.fallbacks,0);assert.equal(s.events.filter(e=>e.connectionType).length,0);
});
test('a fallback warning containing its timeout cause remains a fallback record',()=>{
 const s=state();log(s,1,'WebSocket request timed out; falling back to HTTP');
 assert.equal(s.fallbacks,1);assert.equal(s.failures,0);assert.match(s.events.find(e=>e.connectionType==='fallback').detail,/原因：请求超时/);
 log(s,2,'retrying request after delay: 0.5s');assert.match(s.events.find(e=>e.connectionType==='retry').detail,/0.5 秒后重试/);
});
test('connection details stay within the current turn and reset with it',()=>{
 const s=state();log(s,1,'turn_id=old-turn request timed out');log(s,2,'request timed out',{ts:base/1000-1});
 assert.equal(s.failures,0);log(s,3,'turn_id=turn-a request timed out');assert.equal(s.failures,1);
 reduceRecord(s,{type:'event_msg',timestamp:new Date(base+2000).toISOString(),payload:{type:'task_complete',turn_id:'turn-a'}});
 log(s,4,'request timed out',{ts:base/1000+3});assert.equal(s.failures,1);
 reduceRecord(s,{type:'event_msg',timestamp:new Date(base+4000).toISOString(),payload:{type:'task_started',turn_id:'turn-b'}});
 assert.equal(s.failures,0);assert.equal(s.events.filter(e=>e.connectionType).length,0);
});
