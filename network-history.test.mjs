import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {NetworkHistory} from './network-history.mjs';
import './network-chart.js';
const {formatRate,segments,gapBridges,inspectPoint,nearestPoint,HistoryBuffer}=globalThis.CodexMonitorNetworkChart;
const base=Date.parse('2026-11-01T02:00:00Z');
const sample=(at,extra={})=>({scope:'codex-proxy',status:'ready',sampledAt:at,receivedPerSecond:100,sentPerSecond:20,processes:[{id:'100:1',pid:100,receivedPerSecond:30,sentPerSecond:5},{id:'200:1',pid:200,receivedPerSecond:70,sentPerSecond:15}],...extra});
function fixture(){let now=base;const history=new NetworkHistory({now:()=>now,epoch:'one'});return {history,at:value=>now=base+value};}

test('history records Codex aggregate and individual process rates without proxy metadata',()=>{
 const {history}=fixture();history.capture(sample(base,{host:'PRIVATE_HOST',token:'PRIVATE_TOKEN',processes:[{id:'100:1',receivedPerSecond:30,sentPerSecond:5,command:'PRIVATE_COMMAND'}]}));
 assert.equal(history.read().points[0].receivedPerSecond,100);assert.equal(history.read({processId:'100:1'}).points[0].receivedPerSecond,30);
 assert.equal(history.read({processId:'missing'}).points[0].receivedPerSecond,null);assert.ok(!JSON.stringify(history.read()).includes('PRIVATE_'));
});
test('zero is measured data; duplicate source samples, errors and stale samples create gaps',()=>{
 const {history,at}=fixture();history.capture(sample(base,{receivedPerSecond:0,sentPerSecond:0}));
 at(1000);history.capture(sample(base));at(2000);history.capture(sample(base+2000,{status:'error'}));at(10000);history.capture(sample(base+2000));
 const values=history.read().points.map(point=>point.receivedPerSecond);assert.deepEqual(values,[0,null,null,null]);
 at(11000);history.capture(sample(base+11000));assert.equal(history.read().points.at(-1).receivedPerSecond,100);
});
test('partial samples keep known rates and unknown values do not turn into zero',()=>{
 const {history}=fixture();history.capture(sample(base,{status:'partial',receivedPerSecond:Infinity,sentPerSecond:15}));
 const point=history.read().points[0];assert.equal(point.partial,true);assert.equal(point.receivedPerSecond,null);assert.equal(point.sentPerSecond,15);
});
test('retention is bounded to 30 minutes and cursor polling sends only new samples',()=>{
 const {history,at}=fixture();for(let i=0;i<=1900;i++){at(i*1000);history.capture(sample(base+i*1000));}
 assert.equal(history.frames.length,1801);assert.equal(history.read({rangeSeconds:600}).points.length,601);
 const full=history.read({rangeSeconds:60}),delta=history.read({rangeSeconds:60,epoch:full.epoch,after:full.seq});assert.equal(delta.reset,false);assert.equal(delta.points.length,0);
 at(1901000);history.capture(sample(base+1901000));assert.equal(history.read({epoch:full.epoch,after:full.seq}).points.length,1);
 assert.equal(history.read({epoch:'old',after:full.seq}).reset,true);assert.equal(history.read({epoch:'one',after:1e8}).reset,true);
});
test('reused PID identities remain separate; range and identifier inputs are validated',()=>{
 const {history,at}=fixture();history.capture(sample(base));at(1000);history.capture(sample(base+1000,{processes:[{id:'100:2',receivedPerSecond:900,sentPerSecond:10}]}));
 assert.deepEqual(history.read({processId:'100:1'}).points.map(p=>p.receivedPerSecond),[30,null]);
 assert.deepEqual(history.read({processId:'100:2'}).points.map(p=>p.receivedPerSecond),[null,900]);
 for(const input of [{rangeSeconds:7},{processId:'../../auth.json'},{after:NaN},{after:-1}])assert.throws(()=>history.read(input));
});
test('curve segments break at missing readings and sampling gaps while retaining zero',()=>{
 const point=(at,value)=>({at,receivedPerSecond:value});
 const result=segments([point(0,0),point(1000,5),point(2000,null),point(3000,0),point(7000,9)],'receivedPerSecond');
 assert.deepEqual(result.map(row=>row.map(p=>p.at)),[[0,1000],[3000],[7000]]);
 assert.equal(formatRate(0),'0 B/s');assert.equal(formatRate(null),'—');assert.equal(formatRate(1024),'1.00 KiB/s');assert.equal(formatRate(1048576),'1.00 MiB/s');
});
test('hover lookup does not invent a sample in an unrecorded time interval',()=>{
 const points=[{at:10000},{at:11000},{at:20000}];assert.equal(nearestPoint(points,10700).at,11000);assert.equal(nearestPoint(points,1000),null);assert.equal(nearestPoint(points,15500),null);
});
test('dashed bridges join only bounded gaps and leave measured zero and missing data unchanged',()=>{
 const p=(at,value)=>({at,receivedPerSecond:value}),points=[p(0,null),p(1000,0),p(2000,5),p(3000,null),p(4000,10),p(8000,0),p(9000,null)],original=JSON.stringify(points);
 assert.deepEqual(gapBridges(points,'receivedPerSecond').map(line=>line.map(point=>point.at)),[[2000,4000],[4000,8000]]);
 assert.equal(JSON.stringify(points),original);assert.deepEqual(gapBridges([p(0,null),p(1000,null)],'receivedPerSecond'),[]);
});
test('hovering dashed regions never invents a rate or snaps onto a measured endpoint',()=>{
 const points=[{at:1000,receivedPerSecond:100,sentPerSecond:50},{at:5000,receivedPerSecond:200,sentPerSecond:100}];
 const gap=inspectPoint(points,1800);assert.equal(gap.bridged,true);assert.equal(gap.point,null);assert.equal(gap.at,1800);
 const endpoint=inspectPoint(points,1000);assert.equal(endpoint.bridged,false);assert.equal(endpoint.point.receivedPerSecond,100);
});

test('dashed bridges stop above ten seconds independently in each direction',()=>{
 const p=(at,down,up=down)=>({at,receivedPerSecond:down,sentPerSecond:up});
 for(const gap of [9999,10000,10001,60000]){
  const points=[p(0,0),p(gap,50)];
  assert.equal(gapBridges(points,'receivedPerSecond').length,gap<=10000?1:0);
  assert.equal(inspectPoint(points,gap/2).bridged,gap<=10000);
  assert.equal(inspectPoint(points,gap/2).point,null);
 }
 const points=[p(0,0,10),p(5000,20,null),p(10001,40,30)];
 assert.equal(gapBridges(points,'receivedPerSecond').length,2);
 assert.equal(gapBridges(points,'sentPerSecond').length,0);
 assert.equal(inspectPoint(points,5000).point.receivedPerSecond,20);
});
test('upload and download bridges are independent and preserve the other measured direction',()=>{
 const points=[{at:1000,receivedPerSecond:0,sentPerSecond:1},{at:2000,receivedPerSecond:20,sentPerSecond:null},{at:3000,receivedPerSecond:40,sentPerSecond:3}];
 assert.equal(gapBridges(points,'receivedPerSecond').length,0);assert.equal(gapBridges(points,'sentPerSecond').length,1);
 const hover=inspectPoint(points,2000);assert.equal(hover.bridged,true);assert.equal(hover.point.receivedPerSecond,20);assert.equal(hover.point.sentPerSecond,null);
});
test('client buffer deduplicates deltas, prunes the chosen range and resets after a restart',()=>{
 const buffer=new HistoryBuffer(60),point=(seq,at)=>({seq,at,receivedPerSecond:seq,sentPerSecond:0});
 buffer.merge({epoch:'a',seq:2,reset:true,serverNow:base,points:[point(1,base-59000),point(2,base)]});
 buffer.merge({epoch:'a',seq:3,reset:false,serverNow:base+2000,points:[point(2,base),point(3,base+2000)]});assert.deepEqual(buffer.points.map(p=>p.seq),[2,3]);
 buffer.merge({epoch:'b',seq:1,reset:true,serverNow:base+3000,points:[point(1,base+3000)]});assert.deepEqual(buffer.points.map(p=>p.seq),[1]);assert.equal(buffer.epoch,'b');
});
test('history endpoint is local, validates scope and serves the chart without dependencies',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-traffic-history-'));let child;
 try{
  child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',path.join(import.meta.dirname,'server.mjs'),'--port','0'],{env:{...process.env,CODEX_MONITOR_HOME:dir,CODEX_MONITOR_NETWORK_DISABLED:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  const origin=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Start timeout')),8000);child.stdout.on('data',b=>{const match=b.toString().match(/"url":"([^"]+)"/);if(match){clearTimeout(timer);resolve(match[1].replace(/\/$/,''));}});child.once('exit',()=>{clearTimeout(timer);reject(Error('Early exit'));});});
  const response=await fetch(origin+'/api/network-history?range=600'),data=await response.json();assert.equal(data.scope,'codex-proxy');assert.equal(data.status,'disabled');assert.equal(data.points[0].receivedPerSecond,null);assert.equal(data.reset,true);
  assert.equal((await fetch(origin+'/api/network-history?range=99')).status,400);assert.equal((await fetch(origin+'/api/network-history?process=../../auth.json')).status,400);
  const rejected=await new Promise((resolve,reject)=>{const address=new URL(origin);http.get({hostname:address.hostname,port:address.port,path:'/api/network-history',headers:{Host:'foreign.example'}},response=>{response.resume();resolve(response.statusCode);}).on('error',reject);});assert.equal(rejected,403);
  assert.ok((await (await fetch(origin+'/network-chart.js')).text()).includes('TrafficChart'));
  await fetch(origin+'/api/shutdown',{method:'POST',headers:{Origin:origin,'X-Monitor-Action':'shutdown'}});await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));
 }finally{if(child&&child.exitCode===null)child.kill();fs.rmSync(dir,{recursive:true,force:true});}
});
