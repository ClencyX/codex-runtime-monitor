import test from 'node:test';
import assert from 'node:assert/strict';
import './activity-tree.js';
import {blankState,reduceRecord} from './monitor-core.mjs';
const {buildTree,visibleRows}=globalThis.CodexMonitorActivity;
const base=Date.parse('2026-11-01T01:00:00Z');
const event=(id,at,status='returned',extra={})=>({key:'call:'+id,callId:id,at:base+at,startedAt:base+at,endedAt:status==='running'?null:base+at+1000,status,label:id,toolLabel:id,operation:true,kind:'tool',durationMs:status==='running'?null:1000,...extra});
const record=(type,payload,ms=0,metadata)=>({type,payload,timestamp:new Date(base+ms).toISOString(),metadata});

test('model column follows each retained turn and leaves missing model data unknown',()=>{
 const turns=[{id:'s',turnId:'old',model:'gpt-6.1-sol',effort:'high',events:[event('a',100)]},{id:'s',turnId:'new',model:'gpt-6.1-sol',effort:'xhigh',events:[event('b',200)]},{id:'s',turnId:'missing',events:[event('c',300)]}];
 const original=JSON.stringify(turns),tree=globalThis.CodexMonitorActivity.buildTimeline(turns);
 const find=id=>[...tree.nodes.values()].find(node=>node.event.callId===id);
 assert.deepEqual([find('a').model,find('a').effort],['gpt-6.1-sol','high']);assert.equal(find('b').effort,'xhigh');assert.equal(find('c').model,'');assert.equal(find('c').effort,'');assert.equal(JSON.stringify(turns),original);
});

test('duration display uses milliseconds below one second and whole units thereafter',()=>{
 const {formatDuration,liveDuration}=globalThis.CodexMonitorActivity;
 for(const [ms,label] of [[0,'0 毫秒'],[1,'1 毫秒'],[3.9,'3 毫秒'],[543,'543 毫秒'],[999,'999 毫秒'],[1000,'1 秒'],[1100,'1 秒'],[39543,'39 秒'],[59999,'59 秒'],[60000,'1 分 0 秒'],[65300,'1 分 5 秒'],[99543,'1 分 39 秒'],[195000,'3 分 15 秒'],[1299543,'21 分 39 秒'],[3599999,'59 分 59 秒'],[3600000,'1 小时 0 分 0 秒'],[3639543,'1 小时 0 分 39 秒'],[3939543,'1 小时 5 分 39 秒'],[90000100,'25 小时 0 分 0 秒']]){
  assert.equal(formatDuration(ms),label);assert.equal(liveDuration(base,base+ms),label);
 }
 for(const ms of [null,undefined,NaN,Infinity])assert.equal(formatDuration(ms),'耗时未知');
 assert.equal(liveDuration(null,base),'耗时未知');assert.equal(formatDuration(-10),'0 毫秒');
});
test('known turn is a real parent group and original records remain unmodified',()=>{
 const s=blankState();reduceRecord(s,record('event_msg',{type:'task_started',turn_id:'turn'}));
 reduceRecord(s,record('response_item',{type:'function_call',name:'exec_command',call_id:'a'},1000));
 reduceRecord(s,record('response_item',{type:'message',role:'assistant'},2000));
 const original=JSON.stringify(s),tree=buildTree(s),rows=visibleRows(tree);
 assert.equal(tree.roots.length,1);assert.equal(tree.roots[0].event.groupRoot,true);assert.equal(tree.roots[0].childCount,1);assert.equal(tree.roots[0].runningChildren,1);
 assert.equal(rows.length,3);assert.equal(rows[1].node.event.callId,'a');assert.equal(rows[1].depth,1);assert.equal(JSON.stringify(s),original);
});
test('a returned parent remains pinned with a live descendant without restarting its clock',()=>{
 const parent=event('parent',0,'returned',{durationMs:2000}),child=event('child',1000,'running',{parentCallId:'parent'}),other=event('later',9000);
 for(const order of ['asc','desc']){
  const tree=buildTree({events:[parent,child,other]},order),group=tree.roots[0];
  assert.equal(group.event.callId,'parent');assert.equal(group.groupRunning,true);assert.equal(group.event.status,'returned');assert.equal(group.event.durationMs,2000);assert.equal(group.runningChildren,1);assert.equal(group.childCount,1);
  assert.equal(visibleRows(tree)[1].node.event.callId,'child');
 }
});
test('running groups and their running siblings use start order under either history sort',()=>{
 const events=[event('p2',200),event('c2',500,'running',{parentCallId:'p2'}),event('p1',100),event('late-child',400,'running',{parentCallId:'p1'}),event('early-child',300,'running',{parentCallId:'p1'}),event('old',50)];
 for(const order of ['asc','desc']){const tree=buildTree({events},order);assert.deepEqual(tree.roots.slice(0,2).map(node=>node.event.callId),['p1','p2']);assert.deepEqual(tree.roots[0].children.map(node=>node.event.callId),['early-child','late-child']);}
});
test('time overlap and names never create parent relationships',()=>{
 const first=event('a',100,'running',{label:'本地命令'}),second=event('b',200,'running',{label:'本地命令'});
 const tree=buildTree({events:[first,second]});assert.equal(tree.roots.length,2);assert.ok(tree.roots.every(node=>node.children.length===0));
});
test('missing, conflicting and cyclic parents do not hide records or invent placeholder parents',()=>{
 const events=[event('a',100,'returned',{parentCallId:'b'}),event('b',200,'returned',{parentCallId:'a'}),event('self',300,'returned',{parentCallId:'self'}),event('missing',400,'returned',{parentCallId:'absent'}),event('x',500,'returned',{itemId:'item-x'}),event('y',600,'returned',{itemId:'item-y'}),event('conflict',700,'returned',{parentCallId:'x',parentItemId:'item-y'})];
 const tree=buildTree({events}),rows=visibleRows(tree,new Map(events.map(row=>[row.key,true])));assert.equal(rows.length,events.length);assert.ok(tree.roots.some(node=>node.event.callId==='missing'));assert.ok(tree.roots.some(node=>node.event.callId==='conflict'));assert.ok(tree.roots.some(node=>node.event.callId==='self'));
});
test('late parent arrival establishes an explicit relationship and ambiguous IDs remain independent',()=>{
 const child=event('child',200,'returned',{parentCallId:'parent'});assert.equal(buildTree({events:[child]}).roots.length,1);
 const tree=buildTree({events:[child,event('parent',100)]});assert.equal(tree.roots[0].children[0].event.callId,'child');
 const ambiguous=buildTree({events:[child,event('parent',100),{...event('duplicate',100),callId:'parent'}]});assert.ok(ambiguous.roots.some(node=>node.event.callId==='child'));
});
test('default expansion is one level and explicit collapse survives incoming child updates',()=>{
 const events=[event('p',100),event('c',200,'returned',{parentCallId:'p'}),event('grandchild',300,'running',{parentCallId:'c'})];
 const tree=buildTree({events});assert.equal(visibleRows(tree).length,2);
 const choices=new Map([['call:p',false]]);assert.equal(visibleRows(tree,choices).length,1);
 const changed=buildTree({events:[...events,event('new',400,'running',{parentCallId:'p'})]});assert.equal(visibleRows(changed,choices).length,1);assert.equal(changed.roots[0].runningChildren,2);assert.equal(changed.roots[0].childCount,3);
});
test('deep explicit hierarchies are counted iteratively without recursive stack overflow',()=>{
 const events=Array.from({length:2500},(_,i)=>event('n'+i,i,'returned',i?{parentCallId:'n'+(i-1)}:{}));
 const tree=buildTree({events});assert.equal(tree.roots[0].childCount,2499);assert.equal(visibleRows(tree).length,2);
});
test('parent total duration uses its own recorded interval rather than summed child times',()=>{
 const s={turnId:'known',status:'completed',startedAt:base,endedAt:base+8000,events:[{key:'start',at:base,kind:'start',label:'本轮任务已记录'},event('a',1000,'returned',{durationMs:5000}),event('b',2000,'returned',{durationMs:6000})]};
 const tree=buildTree(s);assert.equal(tree.roots[0].event.durationMs,8000);assert.equal(tree.roots[0].childCount,2);assert.equal(tree.runningCount,0);
 assert.equal(buildTree({...s,turnId:null}).roots.length,3);
});
test('native items keep stable IDs and same-time same-label items remain distinct',()=>{
 const s=blankState();reduceRecord(s,record('event_msg',{type:'task_started',turn_id:'turn'}));
 for(const id of ['exec-a','exec-b'])reduceRecord(s,record('event_msg',{type:'item_completed',item:{type:'CommandExecution',id},parent_call_id:'outer'},2000));
 const items=s.events.filter(row=>row.operation);assert.equal(items.length,2);assert.notEqual(items[0].key,items[1].key);assert.equal(items[0].parentCallId,'outer');
 reduceRecord(s,record('event_msg',{type:'item_completed',item:{type:'CommandExecution',id:'exec-a'}},2500));assert.equal(s.events.filter(row=>row.operation).length,2);
});
test('only whitelisted explicit identifiers leave the reducer, not arguments or output',()=>{
 const s=blankState();reduceRecord(s,record('event_msg',{type:'task_started',turn_id:'turn'}));
 reduceRecord(s,record('response_item',{type:'function_call',name:'exec_command',call_id:'child',parent_call_id:'parent',arguments:'secret-command'},1000));
 reduceRecord(s,record('response_item',{type:'function_call_output',call_id:'child',output:'secret-output'},2000,{parent_item_id:'item-parent'}));
 const row=s.events.find(event=>event.callId==='child');assert.equal(row.parentCallId,'parent');assert.equal(row.parentItemId,'item-parent');assert.ok(!JSON.stringify(s).includes('secret-command'));assert.ok(!JSON.stringify(s).includes('secret-output'));
 reduceRecord(s,record('response_item',{type:'function_call',name:'exec_command',call_id:'bad',parent_call_id:'../private-path'},3000,null));assert.equal(s.events.find(event=>event.callId==='bad').parentCallId,undefined);
});
