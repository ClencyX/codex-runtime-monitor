import test from 'node:test';
import assert from 'node:assert/strict';
import {CodexTrafficCounters} from './network.mjs';
const first={id:'100:1',pid:100,name:'codex.exe'},second={id:'200:1',pid:200,name:'codex.exe'};
const binding=(proc=first,address='127.0.0.1',extra={})=>({processId:proc.id,protocol:'udp',localAddress:address,localPort:5000,remoteAddress:'',remotePort:0,ambiguous:false,...extra});
const connection=(id,down,up,network='udp',extra={})=>({id,download:down,upload:up,start:'2000-01-01T00:00:00Z',metadata:{network,sourceIP:'127.0.0.1',sourcePort:5000,inboundIP:'127.0.0.1',inboundPort:7897,type:'Tun',...extra}});
const fixture=()=>{let now=Date.now();const counter=new CodexTrafficCounters(()=>now);return {counter,step:(os,connections)=>{now+=1000;counter.accept(os,{connections},now);return counter.snapshot();}};};

test('confirmed Codex UDP contributes upload/download rates, totals and connection coverage',()=>{
 const {step}=fixture(),os={processes:[first],sockets:[binding()],udpAvailable:true};
 step(os,[connection('udp',100,200)]);const s=step(os,[connection('udp',1100,700)]);
 assert.equal(s.totalReceived,1000);assert.equal(s.totalSent,500);assert.equal(s.receivedPerSecond,1000);assert.equal(s.sentPerSecond,500);assert.equal(s.status,'ready');assert.equal(s.unmatchedConnections,0);assert.equal(s.processes[0].connectionCount,1);
});

test('same address/port TCP and UDP are charged to their own process identities',()=>{
 const {step}=fixture(),tcp=binding(first,'127.0.0.1',{protocol:'tcp',remoteAddress:'127.0.0.1',remotePort:7897});
 const os={processes:[first,second],sockets:[tcp,binding(second)]};
 step(os,[connection('tcp',100,200,'tcp'),connection('udp',500,600)]);
 const s=step(os,[connection('tcp',1100,400,'tcp'),connection('udp',3500,1400)]);
 assert.equal(s.processes.find(p=>p.id===first.id).totalReceived,1000);assert.equal(s.processes.find(p=>p.id===second.id).totalReceived,3000);
 assert.equal(s.processes.find(p=>p.id===first.id).totalSent,200);assert.equal(s.processes.find(p=>p.id===second.id).totalSent,800);assert.equal(s.totalReceived,4000);assert.equal(s.receivedPerSecond,4000);
});

test('IPv4/IPv6 UDP wildcard bindings and IPv4-mapped source addresses are supported',()=>{
 for(const [local,source] of [['0.0.0.0','192.168.1.10'],['::','2001:db8::10'],['2001:db8::10','2001:db8::10'],['127.0.0.1','::ffff:127.0.0.1'],['fe80::1%3','fe80::1%3']]){
  const {step}=fixture(),os={processes:[first],sockets:[binding(first,local)],localAddresses:[source]};step(os,[connection('udp',0,0,'UDP',{sourceIP:source})]);const s=step(os,[connection('udp',1000,200,'UDP',{sourceIP:source})]);assert.equal(s.totalReceived,1000,local+' <- '+source);assert.equal(s.totalSent,200);
 }
});

test('UDP wrong addresses, address families and IPv6 scopes cannot match',()=>{
 for(const [local,source] of [['192.168.1.10','192.168.1.20'],['0.0.0.0','2001:db8::10'],['::','192.168.1.10'],['fe80::1%3','fe80::1%4'],['fe80::1%3','fe80::1']]){
  const {step}=fixture(),os={processes:[first],sockets:[binding(first,local)]};step(os,[connection('udp',0,0,'udp',{sourceIP:source})]);assert.equal(step(os,[connection('udp',1000,200,'udp',{sourceIP:source})]).totalReceived,0);
 }
});

test('idle bound UDP sockets do not falsely mark traffic as missing',()=>{
 const {step}=fixture(),os={processes:[first],sockets:[binding()]};step(os,[]);const s=step(os,[]);assert.equal(s.status,'idle');assert.equal(s.unmatchedConnections,0);assert.equal(s.receivedPerSecond,0);
});

test('UDP wildcard binding cannot claim proxy traffic from another LAN device',()=>{
 for(const [local,source] of [['0.0.0.0','192.168.1.20'],['::','2001:db8::20']]){
  const {step}=fixture(),os={processes:[first],sockets:[binding(first,local)],localAddresses:['192.168.1.10','2001:db8::10']};step(os,[connection('lan',0,0,'udp',{sourceIP:source})]);assert.equal(step(os,[connection('lan',1000,200,'udp',{sourceIP:source})]).totalReceived,0);
 }
});

test('shared UDP endpoints cannot be resolved from a Codex name or a previous cached match',()=>{
 const {step}=fixture(),os={processes:[first],sockets:[binding()]};step(os,[connection('udp',100,200)]);
 const ambiguous={...os,sockets:[binding(first,'127.0.0.1',{ambiguous:true})]};
 const s=step(ambiguous,[connection('udp',1000000,2000000,'udp',{process:'codex.exe'})]);assert.equal(s.totalReceived,0);assert.equal(s.totalSent,0);assert.equal(s.status,'unmapped');assert.equal(s.receivedPerSecond,null);
});

test('multiple possible Codex UDP owners are unknown, while duplicate bindings of one owner count once',()=>{
 const {step}=fixture(),both={processes:[first,second],sockets:[binding(first),binding(second)]};step(both,[connection('udp',0,0)]);assert.equal(step(both,[connection('udp',1000,200)]).totalReceived,0);
 const other=fixture(),one={processes:[first],sockets:[binding(),binding(first,'0.0.0.0')]};other.step(one,[connection('udp',0,0)]);const s=other.step(one,[connection('udp',1000,200)]);assert.equal(s.totalReceived,1000);assert.equal(s.unmatchedConnections,0);assert.equal(s.processes[0].connectionCount,1);
});

test('UDP ownership must remain current and cached IDs do not cross protocols or PID generations',()=>{
 const {step}=fixture(),tcp=binding(first,'127.0.0.1',{protocol:'tcp',remoteAddress:'127.0.0.1',remotePort:7897}),os={processes:[first],sockets:[tcp]};
 step(os,[connection('same',100,200,'tcp')]);assert.equal(step(os,[connection('same',10000,20000)]).totalReceived,0);
 const udp=fixture(),own={processes:[first],sockets:[binding()]};udp.step(own,[connection('id',100,200)]);
 assert.equal(udp.step({processes:[first],sockets:[]},[connection('id',10000,20000)]).totalReceived,0);
 const replacement={...first,id:'100:2'},next={processes:[replacement],sockets:[binding(replacement)]};
 assert.equal(udp.step(next,[connection('id',11000,22000)]).totalReceived,0);assert.equal(udp.step(next,[connection('id',12000,23000)]).totalReceived,1000);
});

test('UDP table failure keeps known TCP traffic but does not claim complete coverage',()=>{
 const {step}=fixture(),os={processes:[first],sockets:[binding(first,'127.0.0.1',{protocol:'tcp',remoteAddress:'127.0.0.1',remotePort:7897})],udpAvailable:false};
 step(os,[connection('tcp',100,200,'tcp')]);const s=step(os,[connection('tcp',1100,700,'tcp')]);assert.equal(s.totalReceived,1000);assert.equal(s.status,'partial');assert.equal(s.udpAvailable,false);assert.equal(s.receivedPerSecond,1000);
 const empty=fixture();empty.step({...os,sockets:[]},[]);assert.equal(empty.step({...os,sockets:[]},[]).receivedPerSecond,null);
});

test('new Codex UDP flows count initial bytes once and counter reset never creates negative totals',()=>{
 const {counter,step}=fixture(),os={processes:[first],sockets:[binding()]};
 const fresh={...connection('new',500,200),start:new Date(counter.startedAt+100).toISOString()};assert.equal(step(os,[fresh]).totalReceived,500);assert.equal(step(os,[{...fresh,download:700}]).totalReceived,700);assert.equal(step(os,[{...fresh,download:1}]).totalReceived,700);
});
