import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {StringDecoder} from 'node:string_decoder';
import {fileURLToPath} from 'node:url';
import {isIP} from 'node:net';

const sampleMs=250,staleMs=4500;
const address=value=>String(value||'').toLowerCase().replace(/^::ffff:/,'').replace(/%.*/,'');
const localKey=(ip,port)=>address(ip)+':'+String(port);
const protocol=value=>typeof value==='string'&&['tcp','udp'].includes(value.toLowerCase())?value.toLowerCase():null;
const socketKey=socket=>protocol(socket.protocol)+':'+localKey(socket.localAddress,socket.localPort)+'>'+localKey(socket.remoteAddress,socket.remotePort)+':'+socket.processId;
function udpAddressMatches(binding,source,localAddresses){
 const local=address(binding),remote=address(source);if(!isIP(remote))return false;
 if(local==='0.0.0.0')return isIP(remote)===4&&localAddresses.has(remote);
 if(local==='::')return isIP(remote)===6&&localAddresses.has(remote);
 if(local!==remote)return false;
 const zone=value=>String(value).split('%')[1]||'';
 return zone(binding)===zone(source);
}
const codexName=value=>typeof value==='string'&&/(?:^|[\\/])codex(?:\.exe)?$/i.test(value);
const safeBytes=value=>Number.isSafeInteger(value)&&value>=0;
function addHistory(row,at){
 row.history.push({at,received:row.totalReceived,sent:row.totalSent});
 while(row.history.length>2&&row.history[1].at<=at-1000)row.history.shift();
}
function rates(row){
 const first=row.history[0],last=row.history.at(-1),elapsed=last&&first?last.at-first.at:0;
 return elapsed>0?{receivedPerSecond:(last.received-first.received)*1000/elapsed,sentPerSecond:(last.sent-first.sent)*1000/elapsed}:{receivedPerSecond:null,sentPerSecond:null};
}

export class CodexTrafficCounters{
 constructor(now=Date.now){this.now=now;this.startedAt=now();this.sampledAt=null;this.status='starting';this.error=null;this.processes=new Map();this.connections=new Map();this.totalReceived=0;this.totalSent=0;this.history=[];this.unmatchedConnections=0;}
 fail(message='Codex 代理流量采样暂不可用，正在重试'){
  this.status='error';this.error=message;this.history=[];for(const row of this.processes.values())row.history=[];
 }
 accept(os,snapshot,at=performance.now()){
  if(!Array.isArray(os?.processes)||!Array.isArray(os.sockets)||!Array.isArray(snapshot?.connections))throw Error('Invalid traffic sample');
  const live=new Map();
  for(const row of os.processes){if(typeof row.id!=='string'||!Number.isInteger(row.pid)||row.pid<1||!codexName(row.name))throw Error('Invalid Codex identity');live.set(row.id,row);}
  for(const row of this.processes.values()){row.running=false;row.connectionCount=0;row.unmatchedConnections=0;}
  for(const proc of live.values()){
   let row=this.processes.get(proc.id);
   if(!row){row={id:proc.id,pid:proc.pid,name:'codex.exe',connectionCount:0,unmatchedConnections:0,totalReceived:0,totalSent:0,history:[]};this.processes.set(proc.id,row);}
   row.running=true;
  }
  const sockets=os.sockets.filter(row=>live.has(row.processId)&&protocol(row.protocol)&&Number.isInteger(row.localPort)&&row.localPort>0);
  const byLocal=new Map(),udpByPort=new Map();for(const socket of sockets){const map=protocol(socket.protocol)==='udp'?udpByPort:byLocal,key=map===udpByPort?socket.localPort:localKey(socket.localAddress,socket.localPort);if(!map.has(key))map.set(key,[]);map.get(key).push(socket);}
  const covered=new Set(),expected=new Set(sockets.filter(s=>protocol(s.protocol)==='tcp').map(socketKey)),seen=new Set();let matched=0;
  this.udpAvailable=os.udpAvailable!==false;
  const localAddresses=new Set(['127.0.0.1','::1',...(os.localAddresses||[])].map(address));
  for(const connection of snapshot.connections){
   if(typeof connection.id!=='string'||seen.has(connection.id)||!safeBytes(connection.download)||!safeBytes(connection.upload))continue;
   seen.add(connection.id);
   const metadata=connection.metadata||{};
   const transport=protocol(metadata.network);if(!transport)continue;
   if(transport==='udp'&&!this.udpAvailable)continue;
   const key=localKey(metadata.sourceIP,metadata.sourcePort),cached=this.connections.get(connection.id);
   const named=metadata.processPath||metadata.process;
   if(named&&!codexName(named))continue;
   const candidates=transport==='udp'?(udpByPort.get(Number(metadata.sourcePort))||[]).filter(socket=>udpAddressMatches(socket.localAddress,metadata.sourceIP,localAddresses)):(byLocal.get(key)||[]).filter(socket=>
    (!metadata.inboundPort||Number(metadata.inboundPort)===socket.remotePort)&&
    (!metadata.inboundIP||['0.0.0.0','::'].includes(metadata.inboundIP)||address(metadata.inboundIP)===address(socket.remoteAddress)));
   // A bound UDP socket can be idle. Only observed proxy flows imply expected UDP coverage.
   if(transport==='udp')for(const candidate of candidates)expected.add(socketKey(candidate));
   const owners=new Set(candidates.map(socket=>socket.processId));
   if(candidates.some(socket=>socket.ambiguous)||owners.size>1||transport==='tcp'&&candidates.length>1)continue;
   const socket=owners.size===1?candidates[0]:null;
   // UDP ownership must be confirmed on every sample; an old proxy ID cannot override port reuse.
   if(transport==='udp'&&!socket)continue;
   const compatible=cached?.protocol===transport&&cached.sourceKey===key?cached:null;
   const processId=socket?.processId||compatible?.processId,proc=this.processes.get(processId);
   if(!proc)continue;
   const old=compatible?.processId===processId?compatible:null;
   if(socket)for(const candidate of candidates)covered.add(socketKey(candidate));
   matched++;proc.connectionCount++;
   const started=Date.parse(connection.start),newDuringMonitor=Number.isFinite(started)&&started>=this.startedAt;
   const received=old?Math.max(0,connection.download-old.download):!cached&&newDuringMonitor?connection.download:0;
   const sent=old?Math.max(0,connection.upload-old.upload):!cached&&newDuringMonitor?connection.upload:0;
   proc.totalReceived+=received;proc.totalSent+=sent;this.totalReceived+=received;this.totalSent+=sent;
   this.connections.set(connection.id,{processId,protocol:transport,sourceKey:key,download:connection.download,upload:connection.upload,lastSeen:at});
  }
  for(const [id,row] of this.connections){if(!seen.has(id)&&at-row.lastSeen>600000)this.connections.delete(id);}
  if(this.connections.size>20000){for(const id of this.connections.keys()){if(!seen.has(id))this.connections.delete(id);if(this.connections.size<=20000)break;}}
  for(const socket of sockets)if(expected.has(socketKey(socket))&&!covered.has(socketKey(socket)))this.processes.get(socket.processId).unmatchedConnections++;
  let warming=false;
  for(const row of this.processes.values()){
   if((row.unmatchedConnections||!this.udpAvailable)&&!row.connectionCount)row.history=[];else addHistory(row,at);
   if(row.connectionCount&&row.history.length<2)warming=true;
   row.status=!row.running?'exited':row.unmatchedConnections||!this.udpAvailable?(row.connectionCount?'partial':'unmapped'):!row.connectionCount?'idle':row.history.length<2?'warming':'ready';
  }
  this.unmatchedConnections=sockets.filter(socket=>expected.has(socketKey(socket))&&!covered.has(socketKey(socket))).length;
  // Gap bytes remain in totals; rates resume only after a continuous baseline.
  const unmapped=(this.unmatchedConnections>0||!this.udpAvailable)&&!matched;
  if(unmapped||warming)this.history=[];
  if(!unmapped)addHistory(this,at);
  this.sampledAt=this.now();this.error=null;
  this.status=this.unmatchedConnections||!this.udpAvailable?(matched?'partial':'unmapped'):!live.size?'no-process':!matched?'idle':this.history.length<2?'warming':'ready';
 }
 snapshot(){
  const stale=this.sampledAt!==null&&this.now()-this.sampledAt>staleMs;
  const unknown=stale||['starting','disabled','error','unmapped'].includes(this.status);
  const processes=Array.from(this.processes.values(),row=>({id:row.id,pid:row.pid,name:row.name,running:row.running,status:row.status||'starting',unmatchedConnections:row.unmatchedConnections||0,connectionCount:row.connectionCount,totalReceived:row.totalReceived,totalSent:row.totalSent,...(unknown||row.status==='unmapped'?{receivedPerSecond:null,sentPerSecond:null}:rates(row))}));
  return {scope:'codex-proxy',source:'Mihomo',status:stale?'error':this.status,error:stale?'Codex 流量采样已中断，正在重试':this.error,
   startedAt:this.startedAt,sampledAt:this.sampledAt,intervalMs:sampleMs,udpAvailable:this.udpAvailable??null,unmatchedConnections:this.unmatchedConnections,totalReceived:this.totalReceived,totalSent:this.totalSent,
   ...(unknown?{receivedPerSecond:null,sentPerSecond:null}:rates(this)),processes};
 }
}

export function readProxyJson(socketPath,endpoint){return new Promise((resolve,reject)=>{
 if(!/^\\\\\.\\pipe\\(?:verge-mihomo|mihomo)(?:-|$)/i.test(socketPath)||!['/version','/connections'].includes(endpoint)){reject(Error('Invalid local statistics endpoint'));return;}
 const request=http.request({socketPath,path:endpoint,method:'GET',timeout:1500},response=>{
  let body='';response.setEncoding('utf8');
  response.on('data',chunk=>{body+=chunk;if(body.length>8*1024*1024)request.destroy(Error('Statistics too large'));});
  response.on('error',reject);response.on('end',()=>{if(response.statusCode!==200){reject(Error('Statistics unavailable'));return;}try{resolve(JSON.parse(body));}catch(error){reject(error);}});
 });request.on('timeout',()=>request.destroy(Error('Statistics timeout')));request.on('error',reject);request.end();
});}

export class NetworkMonitor{
 constructor(){this.counters=new CodexTrafficCounters();this.child=null;this.retry=null;this.pollTimer=null;this.watchdog=null;this.stopped=false;this.os=null;this.lastMessage=0;this.pipe=null;this.nextDiscovery=0;}
 start(){
  if(this.stopped||this.child)return;
  if(process.platform!=='win32'||process.env.CODEX_MONITOR_NETWORK_DISABLED==='1'){this.counters.status='disabled';return;}
  const root=fileURLToPath(new URL('.',import.meta.url));let command;
  try{command=fs.readFileSync(new URL('./network-sampler.ps1',import.meta.url),'utf8');}catch{this.counters.fail('Codex 连接采样组件不可读');return;}
  const child=spawn(path.join(process.env.SystemRoot||'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoLogo','-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,stdio:['ignore','pipe','ignore'],env:{...process.env,CODEX_MONITOR_PARENT_PID:String(process.pid),CODEX_MONITOR_ROOT:root}});
  this.child=child;this.lastMessage=Date.now();const decoder=new StringDecoder('utf8');let buffer='',finished=false;
  const finish=()=>{
   if(finished)return;finished=true;clearInterval(this.watchdog);clearTimeout(this.pollTimer);this.watchdog=null;this.pollTimer=null;this.os=null;
   if(this.child===child)this.child=null;
   if(!this.stopped){this.counters.fail();this.retry=setTimeout(()=>{this.retry=null;this.start();},2000);}
  };
  child.once('error',finish);child.once('exit',finish);
  child.stdout.on('data',chunk=>{
   if(finished||this.stopped)return;buffer+=decoder.write(chunk);
   if(buffer.length>262144){this.counters.fail();child.kill();return;}
   let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);if(!line)continue;
    try{const message=JSON.parse(line);this.lastMessage=Date.now();if(message.error||!Array.isArray(message.processes)||!Array.isArray(message.sockets)){this.os=null;this.counters.fail('Codex 连接识别暂不可用');}else this.os=message;}catch{this.counters.fail();}
   }
  });
  this.watchdog=setInterval(()=>{if(Date.now()-this.lastMessage>15000){this.counters.fail();child.kill();}},3000);
  const poll=async()=>{
   if(this.stopped||finished)return;
   try{
    if(!this.os||Date.now()-this.lastMessage>1500){if(Date.now()-this.lastMessage>4500)this.counters.fail('Codex 连接识别暂不可用');return;}
    if(!this.pipe&&Date.now()>=this.nextDiscovery){
     this.nextDiscovery=Date.now()+5000;
     const names=fs.readdirSync('\\\\.\\pipe\\').filter(name=>/^(?:verge-mihomo|mihomo)(?:-|$)/i.test(name)).slice(0,4);
     for(const name of names){const candidate='\\\\.\\pipe\\'+name;try{const version=await readProxyJson(candidate,'/version');if(version.meta===true){this.pipe=candidate;break;}}catch{}}
    }
    if(!this.pipe){this.counters.fail('未连接本机 Mihomo 统计接口，无法统计 Codex 流量');return;}
    const data=await readProxyJson(this.pipe,'/connections');
    if(this.stopped||finished)return;
    if(!this.os||Date.now()-this.lastMessage>1500){this.counters.fail('Codex 连接信息已过期');return;}
    this.counters.accept(this.os,data);
   }catch{this.pipe=null;this.counters.fail('Codex 代理统计暂不可用，正在重试');}
   finally{if(!this.stopped&&!finished)this.pollTimer=setTimeout(poll,sampleMs);}
  };
  poll();
 }
 snapshot(){return this.counters.snapshot();}
 stop(){this.stopped=true;clearTimeout(this.retry);clearTimeout(this.pollTimer);clearInterval(this.watchdog);this.child?.kill();this.child=null;}
}
