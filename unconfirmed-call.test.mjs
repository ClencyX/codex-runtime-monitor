import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {blankState,reduceRecord,reduceLog,SessionTail} from './monitor-core.mjs';

const base=Date.parse('2026-11-06T15:00:00Z');
const record=(type,payload,ms=0)=>({type,payload,timestamp:new Date(base+ms).toISOString()});
const start=(turn='one',ms=0)=>record('event_msg',{type:'task_started',turn_id:turn},ms);
const call=(id='outer',ms=1000,name='exec')=>record('response_item',{type:'custom_tool_call',name,call_id:id,input:'PRIVATE_COMMAND'},ms);
const returned=(id='outer',ms=41000)=>record('response_item',{type:'custom_tool_call_output',call_id:id,output:'PRIVATE_OUTPUT'},ms);
function hostLog(id='outer',outcome='interrupted',extra={}){
 return {id:1,ts:(base+32000)/1000,ts_nanos:123000000,target:'codex_code_mode::timing',feedback_log_body:`code_mode.handler.execute{turn_id="one" call_id="${id}" outcome="${outcome}"}: code-mode host operation completed event.name="codex.code_mode.host_timing" call_id=${id} tool_name="exec" code_mode_host_duration_ns=31020737900 PRIVATE_TOKEN`,...extra};
}
function state(){const s=blankState('session');reduceRecord(s,start());reduceRecord(s,call());return s;}
function frontend(){
 const nodes=new Map();
 function element(){return {children:[],dataset:{},hidden:false,textContent:'',title:'',attrs:{},style:{setProperty(){}},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v;},getAttribute(k){return this.attrs[k]??null;}};}
 const c=vm.createContext({Date,Event,Map,Set,JSON,Number,Boolean,Array,String,online:true,offset:0,current:{discoveryError:null},renderedRows:[],eventNodes:new Map(),$:id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);}});
 vm.runInContext(fs.readFileSync(new URL('./i18n.js',import.meta.url),'utf8'),c);
 vm.runInContext(fs.readFileSync(new URL('./activity-tree.js',import.meta.url),'utf8'),c);
 vm.runInContext('const I18n=CodexMonitorI18n,t=I18n.translate;function short(ms){return CodexMonitorActivity.formatDuration(ms);}function text(id,value){$(id).textContent=t(value);}',c);
 const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
 vm.runInContext(app.slice(app.indexOf('function operationWarning('),app.indexOf('function taskStatusText(')),c);
 vm.runInContext(app.slice(app.indexOf('function updateEventRow('),app.indexOf('function renderEvents(')),c);
 c.$('threshold').value='60';
 function rowFor(event){const li=element(),time=element(),elapsed=element(),statusCell=element(),model=element(),label=element(),control=element(),body=element(),summary=element(),operation=element();control.children=[element(),element()];body.firstElementChild=operation;label.children=[control,body,summary];statusCell.children=[element(),element()];li.children=[time,elapsed,statusCell,model,label];return {li,row:{depth:1,isLast:true,expanded:false,node:{event,children:[],childCount:0,descendantRecords:0,runningChildren:0,groupRunning:false}}};}
 return {c,rowFor};
}

test('an interrupted host marks only its own outer call unconfirmed, without ending the task',()=>{
 const s=state(),event=s.events.find(e=>e.callId==='outer');reduceRecord(s,call('parallel',2000,'exec_command'));
 reduceLog(s,hostLog());reduceLog(s,hostLog());
 assert.equal(event.status,'unknown');assert.equal(event.unconfirmedReason,'host-interrupted');assert.equal(event.durationMs,null);assert.equal(event.endedAt,null);
 assert.equal(event.hostDurationMs,31020.7379);assert.equal(event.hostInterruptedAt,base+32123);
 assert.equal(s.events.filter(e=>e.callId==='outer').length,1);assert.deepEqual(s.pending.map(p=>p.id),['parallel']);
 assert.equal(s.events.find(e=>e.callId==='parallel').status,'running');assert.equal(s.status,'running');assert.equal(s.endedAt,null);assert.equal(s.terminationReason,null);
 assert.doesNotMatch(JSON.stringify(s),/PRIVATE_COMMAND|PRIVATE_OUTPUT|PRIVATE_TOKEN|code-mode host operation/);
});
test('slow calls and unrelated, quoted, successful or yielded host records do not trigger the alert',()=>{
 for(const row of [hostLog('other'),hostLog('outer','success'),hostLog('outer','yielded'),hostLog('outer','interrupted',{target:'feedback_tags'}),hostLog('outer','interrupted',{target:'codex_api::retry'}),hostLog('outer','interrupted',{feedback_log_body:'request body: outcome="interrupted"'}),hostLog('outer','interrupted',{feedback_log_body:hostLog().feedback_log_body.replace('turn_id="one"','turn_id="other"')})]){
  const s=state();reduceLog(s,row);assert.equal(s.events.find(e=>e.callId==='outer').status,'running');assert.equal(s.pending.length,1);
 }
 const s=blankState();reduceRecord(s,start());reduceRecord(s,call('outer',1000,'exec_command'));reduceLog(s,hostLog());assert.equal(s.events.find(e=>e.callId==='outer').status,'running');
});
test('a late call return repairs the same row and clears its warning, even if old host logs are replayed',()=>{
 const s=state();reduceLog(s,hostLog());const event=s.events.find(e=>e.callId==='outer');
 reduceRecord(s,returned());assert.strictEqual(s.events.find(e=>e.callId==='outer'),event);assert.equal(event.status,'returned');assert.equal(event.durationMs,40000);assert.equal(event.unconfirmedReason,undefined);assert.equal(event.detail,undefined);
 reduceLog(s,hostLog());assert.equal(event.status,'returned');assert.equal(s.pending.length,0);assert.equal(s.lastTool.status,'completed');
});
test('host logs arriving before the JSONL call wait for the exact call ID',()=>{
 const tail=new SessionTail('',blankState('session'));tail.accept(start());assert.equal(tail.acceptLog(hostLog()),false);assert.equal(tail.pendingLogs.size,1);
 tail.accept(call('other'));tail.flushLogs();assert.equal(tail.pendingLogs.size,1);assert.equal(tail.state.events.find(e=>e.callId==='other').status,'running');
 tail.accept(call());tail.flushLogs();assert.equal(tail.pendingLogs.size,0);assert.equal(tail.state.events.find(e=>e.callId==='outer').status,'unknown');
});
test('closed and archived turns do not create a fresh alert or corrupt the active turn',()=>{
 const {c}=frontend();const s=state();reduceRecord(s,record('event_msg',{type:'task_complete',turn_id:'one'},40000));reduceLog(s,hostLog());assert.equal(s.status,'completed');assert.equal(s.events.find(e=>e.callId==='outer').unconfirmedReason,'host-interrupted');assert.equal(c.operationWarning(s),'');
 const tail=new SessionTail('',blankState('session'));tail.accept(start());tail.accept(call());tail.accept(start('two',60000));tail.acceptLog(hostLog());
 assert.equal(tail.state.turnId,'two');assert.equal(tail.state.events.some(e=>e.unconfirmedReason),false);assert.equal(tail.turns.get('one').status,'terminated');assert.equal(tail.turns.get('one').events.find(e=>e.callId==='outer').unconfirmedReason,'host-interrupted');assert.equal(c.operationWarning(tail.state),'');assert.equal(c.operationWarning(tail.turns.get('one')),'');
});
test('an old host record cannot replace a more recent completed-tool summary',()=>{
 const s=state();reduceRecord(s,call('later',33000,'exec_command'));reduceRecord(s,returned('later',35000));const summary=s.lastTool;
 reduceLog(s,hostLog());assert.strictEqual(s.lastTool,summary);assert.equal(s.lastTool.status,'completed');
});
test('the warning box prioritizes the anomaly, gives a stop suggestion and clears on late return',()=>{
 const s=state();reduceLog(s,hostLog());const {c}=frontend();s.dbError='连接日志读取暂缓，稍后自动重试';
 c.renderWarning(s,true,900000);assert.equal(c.$('warning').hidden,false);assert.equal(c.$('warning').getAttribute('role'),'alert');
 assert.match(c.$('warning').textContent,/结束未确认/);assert.match(c.$('warning').textContent,/终止当前任务/);assert.match(c.$('warning').textContent,/连接日志读取暂缓/);assert.doesNotMatch(c.$('warning').textContent,/已连续/);
 c.CodexMonitorI18n.setLanguage('en');c.renderWarning(s,true,900000);assert.match(c.$('warning').textContent,/Completion unconfirmed/);assert.match(c.$('warning').textContent,/stopping the current task/);assert.doesNotMatch(c.$('warning').textContent,/[\u3400-\u9fff]/);
 c.CodexMonitorI18n.setLanguage('zh-CN');c.renderWarning(s,true,900000);assert.match(c.$('warning').textContent,/结束未确认/);
 reduceRecord(s,returned());s.dbError=null;c.renderWarning(s,true,0);assert.equal(c.$('warning').hidden,true);assert.equal(c.$('warning').getAttribute('role'),'status');
});
test('an unconfirmed row has unknown duration, an amber status and no ticking clock; late return restores it',()=>{
 const s=state();reduceLog(s,hostLog());const event=s.events.find(e=>e.callId==='outer');const {c,rowFor}=frontend(),{li,row}=rowFor(event);
 c.updateEventRow(li,row,base+300000);assert.equal(li.children[1].textContent,'耗时未知');assert.equal(li.children[2].children[0].dataset.status,'unconfirmed');assert.equal(li.children[2].children[0].textContent,'结束未确认');
 assert.match(li.children[4].children[1].firstElementChild.title,/31 秒/);assert.match(li.children[4].children[1].firstElementChild.title,/外层调用缺少返回记录/);
 c.renderedRows=[row];c.eventNodes.set(event.key,li);c.tickActivityClocks();assert.equal(li.children[1].textContent,'耗时未知');
 c.CodexMonitorI18n.setLanguage('en');c.updateEventRow(li,row,base+300000);assert.doesNotMatch(li.children[4].children[1].firstElementChild.title,/[\u3400-\u9fff]/);
 reduceRecord(s,returned());c.updateEventRow(li,row,base+300000);assert.equal(li.children[1].textContent,'40s');assert.equal(li.children[2].children[0].dataset.status,'returned');assert.equal(li.children[2].children[0].title,'');
});
