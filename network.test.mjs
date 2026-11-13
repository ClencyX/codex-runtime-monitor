import test from 'node:test';
import assert from 'node:assert/strict';
import {CodexTrafficCounters,readProxyJson} from './network.mjs';
import {NetworkHistory} from './network-history.mjs';
const proc={id:'100:1',pid:100,name:'codex.exe'};
const socket={processId:proc.id,protocol:'tcp',localAddress:'127.0.0.1',localPort:5000,remoteAddress:'127.0.0.1',remotePort:7897};
const os={processes:[proc],sockets:[socket]};
const connection=(id,download,upload,port=5000,extra={})=>({id,download,upload,start:'2000-01-01T00:00:00Z',metadata:{sourceIP:'127.0.0.1',sourcePort:String(port),inboundIP:'127.0.0.1',inboundPort:'7897',network:'tcp',host:'private-host.example',...extra}});
function fixture(){let wall=Date.parse('2026-10-31T00:00:00Z');const counter=new CodexTrafficCounters(()=>wall);return {counter,advance:ms=>wall+=ms};}
test('only Codex-owned endpoints count; global and browser traffic never contribute',()=>{
 const {counter,advance}=fixture();
 counter.accept(os,{connections:[connection('codex',100,200),connection('browser',1000000,2000000,6000)],downloadTotal:1e12,uploadTotal:1e12},0);
 advance(1000);counter.accept(os,{connections:[connection('codex',1100,2200),connection('browser',9000000,9000000,6000)],downloadTotal:9e12,uploadTotal:9e12},1000);
 const result=counter.snapshot();assert.equal(result.scope,'codex-proxy');assert.equal(result.totalReceived,1000);assert.equal(result.totalSent,2000);assert.equal(result.receivedPerSecond,1000);assert.equal(result.processes[0].connectionCount,1);
 assert.ok(!JSON.stringify(result).includes('private-host'));assert.ok(!JSON.stringify(result).includes('127.0.0.1'));
});
test('process name alone cannot attribute unrelated traffic and conflicting names are excluded',()=>{
 const {counter}=fixture();counter.accept(os,{connections:[connection('fake',100,100,6000,{process:'codex.exe'}),connection('conflict',200,200,5000,{process:'notcodex.exe'})]},0);
 assert.equal(counter.snapshot().status,'unmapped');assert.equal(counter.snapshot().processes[0].connectionCount,0);assert.equal(counter.snapshot().receivedPerSecond,null);assert.equal(counter.snapshot().totalReceived,0);
});

test('UDP source-port collisions never count even when TUN has no process identity',()=>{
 for(const network of ['udp','UDP']){
  const {counter,advance}=fixture();
  const udp=connection('udp-collision',1000,2000,5000,{network,type:'Tun',inboundIP:'',inboundPort:0});
  counter.accept(os,{connections:[udp]},0);advance(1000);
  counter.accept(os,{connections:[{...udp,download:1000000,upload:2000000}]},1000);
  const result=counter.snapshot();assert.equal(result.totalReceived,0);assert.equal(result.totalSent,0);assert.equal(result.processes[0].connectionCount,0);
  assert.equal(result.status,'unmapped');assert.equal(result.receivedPerSecond,null);assert.equal(result.sentPerSecond,null);
 }
});

test('unknown protocols stay unattributed instead of being guessed as TCP',()=>{
 for(const network of [undefined,null,'','quic',17]){
  const {counter,advance}=fixture();const unknown=connection('unknown',0,0,5000,{network,inboundIP:'',inboundPort:0});
  counter.accept(os,{connections:[unknown]},0);advance(1000);counter.accept(os,{connections:[{...unknown,download:1000,upload:2000}]},1000);
  assert.equal(counter.snapshot().totalReceived,0);assert.equal(counter.snapshot().processes[0].connectionCount,0);assert.equal(counter.snapshot().receivedPerSecond,null);
 }
});

test('mixed TCP and UDP on one source endpoint retain only legitimate TCP bytes',()=>{
 const {counter,advance}=fixture();const udp=connection('udp',1000000,2000000,5000,{network:'udp',type:'Tun',inboundIP:'',inboundPort:0});
 counter.accept(os,{connections:[connection('tcp',100,200,5000,{network:'TCP'}),udp]},0);advance(1000);
 counter.accept(os,{connections:[connection('tcp',1100,2200,5000,{network:'TCP'}),{...udp,download:9000000,upload:9000000}]},1000);
 const result=counter.snapshot();assert.equal(result.totalReceived,1000);assert.equal(result.totalSent,2000);assert.equal(result.receivedPerSecond,1000);assert.equal(result.sentPerSecond,2000);assert.equal(result.processes[0].connectionCount,1);assert.equal(result.processes[0].totalReceived,1000);
});

test('cached connection identity and a Codex process label cannot bypass protocol validation',()=>{
 const {counter,advance}=fixture();counter.accept(os,{connections:[connection('cached',100,200)]},0);advance(1000);
 counter.accept(os,{connections:[connection('cached',1000000,2000000,5000,{network:'udp',process:'codex.exe'})]},1000);
 const result=counter.snapshot();assert.equal(result.totalReceived,0);assert.equal(result.totalSent,0);assert.equal(result.processes[0].connectionCount,0);assert.equal(result.receivedPerSecond,null);
});
test('inbound endpoint disambiguates a reused source port and IPv4-mapped addresses match',()=>{
 const {counter,advance}=fixture(),both={processes:[proc],sockets:[socket,{...socket,remotePort:7898}]};
 counter.accept(both,{connections:[connection('one',100,100,5000,{sourceIP:'::ffff:127.0.0.1'})]},0);advance(1000);
 counter.accept(both,{connections:[connection('one',200,200)]},1000);assert.equal(counter.snapshot().totalReceived,100);assert.equal(counter.snapshot().unmatchedConnections,1);
 const {counter:ambiguous}=fixture();ambiguous.accept(both,{connections:[connection('one',100,100,5000,{inboundPort:''})]},0);assert.equal(ambiguous.snapshot().totalReceived,0);assert.equal(ambiguous.snapshot().status,'unmapped');
});
test('new connection bytes count once and closed connections do not subtract totals',()=>{
 const {counter,advance}=fixture();counter.accept(os,{connections:[]},0);advance(1000);
 const fresh={...connection('new',500,200),start:new Date(counter.startedAt+500).toISOString()};
 counter.accept(os,{connections:[fresh]},1000);assert.equal(counter.snapshot().totalReceived,500);
 advance(250);counter.accept(os,{connections:[{...fresh,download:700}]},1250);assert.equal(counter.snapshot().totalReceived,700);
 advance(250);counter.accept({processes:[proc],sockets:[]},{connections:[]},1500);assert.equal(counter.snapshot().totalReceived,700);
});
test('PID reuse keeps process histories separate and counter resets cannot inflate traffic',()=>{
 const {counter,advance}=fixture();counter.accept(os,{connections:[connection('old',1000,1000)]},0);advance(1000);
 counter.accept(os,{connections:[connection('old',20,20)]},1000);assert.equal(counter.snapshot().totalReceived,0);
 advance(1000);counter.accept(os,{connections:[connection('old',120,120)]},2000);assert.equal(counter.snapshot().totalReceived,100);
 const reused={processes:[{...proc,id:'100:2'}],sockets:[{...socket,processId:'100:2'}]};advance(1000);
 counter.accept(reused,{connections:[connection('next',10000,10000)]},3000);assert.equal(counter.snapshot().processes.length,2);assert.equal(counter.snapshot().processes[0].running,false);assert.equal(counter.snapshot().totalReceived,100);
});
test('unmatched Codex connections are reported, never substituted with machine totals',()=>{
 const {counter,advance}=fixture(),partial={processes:[proc],sockets:[socket,{...socket,localPort:6000}]};
 counter.accept(partial,{connections:[connection('own',100,100)]},0);advance(1000);
 counter.accept(partial,{connections:[connection('own',200,200)]},1000);const result=counter.snapshot();assert.equal(result.status,'partial');assert.equal(result.unmatchedConnections,1);assert.equal(result.totalReceived,100);
});
test('sampling errors and stale data return unknown rates but retain observed totals',()=>{
 const {counter,advance}=fixture();counter.accept(os,{connections:[connection('own',100,100)]},0);advance(1000);
 counter.accept(os,{connections:[connection('own',200,200)]},1000);advance(5000);assert.equal(counter.snapshot().receivedPerSecond,null);assert.equal(counter.snapshot().status,'error');
 counter.fail();advance(1000);counter.accept(os,{connections:[connection('own',300,300)]},7000);assert.equal(counter.snapshot().receivedPerSecond,null);assert.equal(counter.snapshot().totalReceived,200);
});
test('process list validation and local read-only API path guard fail closed',async()=>{
 const {counter}=fixture();assert.throws(()=>counter.accept({processes:[{...proc,name:'chrome.exe'}],sockets:[]},{connections:[]},0));
 await assert.rejects(readProxyJson('http://foreign.example','/connections'));
 await assert.rejects(readProxyJson('\\\\.\\pipe\\mihomo','/configs'));
});

test('aggregate recovery excludes gap bytes from rates and chart samples while retaining totals',()=>{
 const {counter,advance}=fixture();
 counter.accept(os,{connections:[connection('own',0,0)]},0);
 advance(1000);counter.accept(os,{connections:[connection('own',1000,200)]},1000);
 assert.equal(counter.snapshot().receivedPerSecond,1000);
 for(let second=2;second<=10;second++){advance(1000);counter.accept(os,{connections:[]},second*1000);}
 assert.equal(counter.snapshot().status,'unmapped');
 advance(1000);counter.accept(os,{connections:[connection('own',11000,2200)]},11000);
 const recovered=counter.snapshot();
 assert.equal(recovered.status,'warming');assert.equal(recovered.totalReceived,11000);assert.equal(recovered.totalSent,2200);
 for(const row of [recovered,...recovered.processes]){assert.equal(row.receivedPerSecond,null);assert.equal(row.sentPerSecond,null);}
 const history=new NetworkHistory({now:()=>recovered.sampledAt});history.capture(recovered);
 assert.equal(history.read().points[0].receivedPerSecond,null);assert.equal(history.read().points[0].sentPerSecond,null);
 advance(1000);counter.accept(os,{connections:[connection('own',12000,2400)]},12000);
 assert.equal(counter.snapshot().status,'ready');assert.equal(counter.snapshot().receivedPerSecond,1000);assert.equal(counter.snapshot().sentPerSecond,200);
 advance(1000);counter.accept(os,{connections:[connection('own',12000,2400)]},13000);
 assert.equal(counter.snapshot().receivedPerSecond,0);assert.equal(counter.snapshot().sentPerSecond,0);
});

test('one process recovering during partial coverage resets aggregate rates without hiding other process rates',()=>{
 const {counter,advance}=fixture(),second={id:'200:1',pid:200,name:'codex.exe'};
 const both={processes:[proc,second],sockets:[socket,{...socket,processId:second.id,localPort:6000}]};
 counter.accept(both,{connections:[connection('first',0,0),connection('second',0,0,6000)]},0);
 advance(1000);counter.accept(both,{connections:[connection('first',1000,200),connection('second',1000,200,6000)]},1000);
 for(let second=2;second<=10;second++){advance(1000);counter.accept(both,{connections:[connection('first',second*1000,second*200)]},second*1000);}
 const partial=counter.snapshot();assert.equal(partial.status,'partial');assert.equal(partial.receivedPerSecond,1000);assert.equal(partial.processes[1].receivedPerSecond,null);
 advance(1000);counter.accept(both,{connections:[connection('first',11000,2200),connection('second',11000,2200,6000)]},11000);
 const recovered=counter.snapshot();assert.equal(recovered.totalReceived,22000);assert.equal(recovered.receivedPerSecond,null);
 assert.equal(recovered.processes[0].receivedPerSecond,1000);assert.equal(recovered.processes[1].receivedPerSecond,null);
 advance(1000);counter.accept(both,{connections:[connection('first',12000,2400),connection('second',12000,2400,6000)]},12000);
 assert.equal(counter.snapshot().receivedPerSecond,2000);assert.equal(counter.snapshot().sentPerSecond,400);
});

test('a new connection first matched after a gap contributes to totals without an artificial speed peak',()=>{
 const {counter,advance}=fixture();counter.accept(os,{connections:[]},0);
 for(let second=1;second<=5;second++){advance(1000);counter.accept(os,{connections:[]},second*1000);}
 const fresh={...connection('fresh',5000,1000),start:new Date(counter.startedAt+500).toISOString()};
 advance(1000);counter.accept(os,{connections:[fresh]},6000);
 assert.equal(counter.snapshot().totalReceived,5000);assert.equal(counter.snapshot().receivedPerSecond,null);
 advance(1000);counter.accept(os,{connections:[{...fresh,download:6000,upload:1200}]},7000);
 assert.equal(counter.snapshot().receivedPerSecond,1000);assert.equal(counter.snapshot().sentPerSecond,200);
});
