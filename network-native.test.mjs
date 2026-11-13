import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import dgram from 'node:dgram';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import readline from 'node:readline';
import {CodexTrafficCounters} from './network.mjs';

test('Windows native TCP/UDP ownership supports real sockets and detects a foreign shared UDP port',{skip:process.platform!=='win32',timeout:30000},async t=>{
 const datagrams=[],accepted=new Set();let client,child,lines;
 const server=net.createServer(socket=>{accepted.add(socket);socket.on('data',data=>socket.write(data));socket.once('close',()=>accepted.delete(socket));});
 async function bind(type,address){const socket=dgram.createSocket({type,reuseAddr:true});try{socket.bind(0,address);await once(socket,'listening');datagrams.push(socket);return socket;}catch(error){try{socket.close();}catch{}throw error;}}
 const ps=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
 const script=`$ErrorActionPreference='Stop'; Add-Type -Path $env:CODEX_NETWORK_TEST_SOURCE; $method=[CodexNetworkNative].GetMethod('ReadProcesses',[Reflection.BindingFlags]'NonPublic,Static'); $processes=[Diagnostics.Process[]]@([Diagnostics.Process]::GetProcessById([int]$env:CODEX_NETWORK_TEST_PID)); $snapshot=$method.Invoke($null,[object[]](,$processes)); $times=@(); for($i=0;$i -lt 20;$i++){$watch=[Diagnostics.Stopwatch]::StartNew(); $sample=[CodexNetworkNative]::Read(); $watch.Stop();$times+=$watch.Elapsed.TotalMilliseconds}; [pscustomobject]@{snapshot=$snapshot;meanMs=($times|Measure-Object -Average).Average;maxMs=($times|Measure-Object -Maximum).Maximum} | ConvertTo-Json -Compress -Depth 6`;
 function sample(){const result=spawnSync(ps,['-NoProfile','-NonInteractive','-Command',script],{env:{...process.env,CODEX_NETWORK_TEST_SOURCE:path.join(import.meta.dirname,'process-network.cs'),CODEX_NETWORK_TEST_PID:String(process.pid)},encoding:'utf8',windowsHide:true,timeout:12000,maxBuffer:1048576});assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);}
 try{
  server.listen(0,'127.0.0.1');await once(server,'listening');client=net.createConnection({host:'127.0.0.1',port:server.address().port});await once(client,'connect');
  const udp=await bind('udp4','127.0.0.1'),wildcard=await bind('udp4','0.0.0.0');let ipv6;
  try{ipv6=await bind('udp6','::1');}catch(error){if(!['EAFNOSUPPORT','EADDRNOTAVAIL'].includes(error.code))throw error;t.diagnostic('IPv6 loopback unavailable on this host; IPv6 matcher remains unit-tested.');}
  const source=`import dgram from 'node:dgram';const sockets=[];const bind=port=>new Promise((resolve,reject)=>{const s=dgram.createSocket({type:'udp4',reuseAddr:true});s.once('error',reject);s.on('message',(_data,remote)=>s.send('udp-ok',remote.port,remote.address));s.bind(Number(port),'127.0.0.1',()=>{sockets.push(s);resolve();});});await bind(process.argv[1]);console.log('ready');process.stdin.once('data',async()=>{await bind(process.argv[2]);console.log('shared');});process.stdin.resume();`;
  child=spawn(process.execPath,['--input-type=module','-e',source,String(client.localPort),String(udp.address().port)],{windowsHide:true,stdio:['pipe','pipe','pipe']});lines=readline.createInterface({input:child.stdout});await once(lines,'line');
  // Confirm real traffic before querying the ownership tables, rather than just a connect callback.
  const echoed=once(client,'data');client.write('tcp-ready');assert.equal((await echoed)[0].toString(),'tcp-ready');
  for(const socket of [udp,wildcard]){const reply=once(socket,'message');socket.send('udp-ready',client.localPort,'127.0.0.1');assert.equal((await reply)[0].toString(),'udp-ok');}
  if(ipv6){const reply=once(ipv6,'message');ipv6.send('ipv6-ready',ipv6.address().port,'::1');assert.equal((await reply)[0].toString(),'ipv6-ready');}
  const first=sample(),snapshot=first.snapshot;assert.equal(snapshot.udpAvailable,true);
  const tcp=snapshot.sockets.find(s=>s.protocol==='tcp'&&s.localPort===client.localPort),own=snapshot.sockets.find(s=>s.protocol==='udp'&&s.localPort===udp.address().port);
  assert.ok(tcp,JSON.stringify({pid:process.pid,clientAddress:client.address(),readyState:client.readyState,processes:snapshot.processes,sockets:snapshot.sockets}));assert.ok(own);assert.equal(own.ambiguous,false);
  assert.ok(!snapshot.sockets.some(s=>s.protocol==='udp'&&s.localPort===client.localPort),'foreign UDP must not be exported as owned');
  if(ipv6)assert.ok(snapshot.sockets.some(s=>s.protocol==='udp'&&s.localAddress==='::1'&&s.localPort===ipv6.address().port));
  const rows=[{id:'tcp',network:'tcp',sourceIP:'127.0.0.1',sourcePort:client.localPort,destinationIP:'127.0.0.1',destinationPort:server.address().port},
   {id:'foreign-udp',network:'udp',sourceIP:'127.0.0.1',sourcePort:client.localPort},
   {id:'own-udp',network:'udp',sourceIP:'127.0.0.1',sourcePort:udp.address().port},
   {id:'wildcard-udp',network:'udp',sourceIP:'127.0.0.1',sourcePort:wildcard.address().port}];
  if(ipv6)rows.push({id:'ipv6-udp',network:'udp',sourceIP:'::1',sourcePort:ipv6.address().port});
  const connections=bytes=>rows.map(row=>({id:row.id,download:bytes,upload:bytes/2,start:'2000-01-01T00:00:00Z',metadata:{...row,type:'Tun'}}));
  let wall=Date.now();const counter=new CodexTrafficCounters(()=>wall);counter.accept(snapshot,{connections:connections(0)},0);wall+=1000;counter.accept(snapshot,{connections:connections(1000)},1000);
  assert.equal(counter.snapshot().totalReceived,(rows.length-1)*1000);assert.equal(counter.snapshot().totalSent,(rows.length-1)*500);
  const shared=once(lines,'line');child.stdin.write('share\n');await shared;const second=sample().snapshot;
  assert.equal(second.sockets.find(s=>s.protocol==='udp'&&s.localPort===udp.address().port).ambiguous,true,'foreign owner must make shared endpoint ambiguous');
  wall+=1000;counter.accept(second,{connections:connections(2000)},2000);
  assert.equal(counter.snapshot().totalReceived,(rows.length-1)*1000+(rows.length-2)*1000,'shared UDP must stop contributing');
  t.diagnostic(JSON.stringify({nativeSamplerMeanMs:first.meanMs,nativeSamplerMaxMs:first.maxMs,ipv6LoopbackChecked:!!ipv6,tcpUdpCollisionExcluded:true,ownUdpCounted:true,foreignSharedPortDetected:true}));
 }finally{
  lines?.close();if(child&&child.exitCode===null){child.kill();await once(child,'exit');}client?.destroy();for(const socket of accepted)socket.destroy();for(const socket of datagrams)socket.close();await new Promise(resolve=>server.close(resolve));
 }
});
