import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({});vm.runInContext(fs.readFileSync(new URL('./panel-order.js',import.meta.url),'utf8'),context);
const {normalizeOrder,moveOrder}=context.CodexMonitorPanelOrder;
const defaults=['task-panel','quota-panel','tools-panel','network-panel','plan-panel','activity-panel'];
const plain=value=>JSON.parse(JSON.stringify(value));
test('saved order cannot include the fixed session selector or arbitrary elements',()=>{
 assert.deepEqual(plain(normalizeOrder(['sessions','warning','activity-panel','__proto__','quota-panel','activity-panel'],defaults)),['activity-panel','quota-panel','task-panel','tools-panel','network-panel','plan-panel']);
});
test('missing and malformed saved settings recover defaults; newly introduced panels are appended',()=>{
 for(const value of [null,{},'quota-panel',5])assert.deepEqual(plain(normalizeOrder(value,defaults)),defaults);
 assert.deepEqual(plain(normalizeOrder(['quota-panel','task-panel'],defaults)),['quota-panel','task-panel','tools-panel','network-panel','plan-panel','activity-panel']);
});
test('moving forward and backward inserts on the intended side of the destination',()=>{
 assert.deepEqual(plain(moveOrder(defaults,'task-panel','network-panel',true)),['quota-panel','tools-panel','network-panel','task-panel','plan-panel','activity-panel']);
 assert.deepEqual(plain(moveOrder(defaults,'activity-panel','quota-panel')),['task-panel','activity-panel','quota-panel','tools-panel','network-panel','plan-panel']);
});
test('every valid movement preserves all panels once and never mutates the original order',()=>{
 for(const id of defaults)for(const target of defaults)for(const after of [false,true]){const input=[...defaults],result=moveOrder(input,id,target,after);assert.deepEqual(input,defaults);assert.equal(result.length,defaults.length);assert.deepEqual(plain([...result].sort()),[...defaults].sort());if(id!==target){const index=result.indexOf(target)+(after?1:-1);assert.equal(result[index],id);}}
});
test('unknown or identical drag targets leave the layout unchanged',()=>{
 for(const [id,target] of [['task-panel','task-panel'],['sessions','quota-panel'],['quota-panel','footer']])assert.deepEqual(plain(moveOrder(defaults,id,target)),defaults);
});
