import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('function checkStateFreshness(){'),app.indexOf('\nfunction render(){'));
function fixture(){
 let clock=0,nextId=0,mode='success',calls=0;const timers=new Map(),nodes=new Map();
 const ctx=vm.createContext({stopped:false,busy:false,generation:0,selected:'s',current:null,online:false,offset:0,lastOptions:'',stateController:null,lastStateReceivedAt:null,
  performance:{now:()=>clock},AbortController,Date,JSON,
  setTimeout:(fn,ms)=>{timers.set(++nextId,{fn,ms});return nextId;},clearTimeout:id=>timers.delete(id),
  stateUrl:()=>'/api/state',$:id=>{if(!nodes.has(id))nodes.set(id,{checked:false,hidden:true,value:'',replaceChildren(){},classList:{add(){},remove(){}}});return nodes.get(id);},text(){},safeOption(){},render(){},showOffline(){},
  fetch:async(url,options)=>{calls++;if(mode==='hang')return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));if(mode==='ignore-abort')return new Promise(()=>{});return {ok:true,status:200,json:async()=>({sessions:[],state:{id:'s'},serverNow:Date.now()})};}
 });
 vm.runInContext(app.match(/const stateRequestTimeoutMs=[^\n]+/)[0]+'\n'+source,ctx);
 return {ctx,timers,get calls(){return calls;},mode:value=>mode=value,advance:ms=>clock+=ms,expire:()=>{for(const {fn} of [...timers.values()])fn();}};
}
test('pending state fetch aborts on timeout, releases polling and recovers',async()=>{
 const f=fixture();await f.ctx.poll();assert.equal(f.ctx.online,true);f.mode('hang');const pending=f.ctx.poll();assert.equal(f.ctx.busy,true);
 f.expire();await pending;assert.equal(f.ctx.busy,false);assert.equal(f.ctx.online,false);assert.equal(f.timers.size,0);
 f.mode('success');await f.ctx.poll();assert.equal(f.ctx.online,true);assert.equal(f.calls,3);
});
test('freshness watchdog marks stale data offline independently of a pending fetch',async()=>{
 const f=fixture();await f.ctx.poll();f.mode('ignore-abort');f.ctx.poll();f.advance(10000);f.ctx.checkStateFreshness();assert.equal(f.ctx.online,false);assert.equal(f.ctx.busy,true);
});
test('cancelling a superseded request cannot overwrite the new selection with an offline error',async()=>{
 const f=fixture();await f.ctx.poll();f.mode('hang');const pending=f.ctx.poll();f.ctx.generation++;f.ctx.stateController.abort();await pending;
 assert.equal(f.ctx.online,true);assert.equal(f.ctx.busy,false);f.mode('success');await f.ctx.poll();assert.equal(f.ctx.online,true);
});
