import test from 'node:test';
import assert from 'node:assert/strict';
import {UpdateChecker,compareVersions,releaseApi} from './update.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
const release={tag_name:'v0.1.5',draft:false,prerelease:false,published_at:'2026-11-10T00:00:00Z'};
test('update comparisons use numeric stable versions and reject ambiguous tags',()=>{
 assert.equal(compareVersions('v0.1.10','0.1.9'),1);assert.equal(compareVersions('v1.0.0','0.99.9'),1);
 assert.equal(compareVersions('v0.1.4','0.1.4'),0);assert.equal(compareVersions('0.1.3','0.1.4'),-1);
 for(const value of ['v0.1.5-beta','0.1','latest','01.2.3','<script>'])assert.equal(compareVersions(value,'0.1.4'),null);
});
test('construction never fetches; explicit check has fixed anonymous GET and no local data',async()=>{
 let calls=0;const checker=new UpdateChecker('0.1.4',{fetchImpl:async(url,options)=>{
  calls++;assert.equal(url,releaseApi);assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.body,undefined);assert.deepEqual(Object.keys(options.headers).sort(),['Accept','User-Agent']);return Response.json({...release,html_url:'https://attacker.invalid',body:'private payload ignored'});
 }});assert.equal(calls,0);const result=await checker.check();assert.equal(calls,1);assert.equal(result.comparison,1);assert.equal(result.url,'https://github.com/ClencyX/codex-runtime-monitor/releases/tag/v0.1.5');assert.equal(result.body,undefined);
});
test('concurrent checks share one request and repeated clicks are rate limited',async()=>{
 let calls=0,now=0,finish;const checker=new UpdateChecker('0.1.4',{now:()=>now,fetchImpl:()=>{calls++;return new Promise(resolve=>{finish=()=>resolve(Response.json(release));});}});
 const a=checker.check(),b=checker.check();assert.equal(a,b);finish();const value=await a;assert.equal(await checker.check(),value);assert.equal(calls,1);now=30000;const next=checker.check();finish();await next;assert.equal(calls,2);
});
test('errors, timeouts, oversized and malformed releases never report up to date',async()=>{
 for(const [fetchImpl,error] of [
  [async()=>new Response('',{status:403}),'rate-limit'],[async()=>new Response('',{status:404}),'unavailable'],
  [async()=>{throw Error('secret raw error');},'unavailable'],[async()=>Response.json({...release,prerelease:true}),'invalid'],
  [async()=>Response.json({...release,published_at:'unknown'}),'invalid'],[async()=>Response.json({...release,tag_name:'dev'}),'invalid'],
  [async()=>new Response('x'.repeat(131073)),'unavailable'],
  [(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')))),'timeout']
 ]){const result=await new UpdateChecker('0.1.4',{fetchImpl,timeoutMs:20}).check();assert.deepEqual(result,{ok:false,error});}
});
test('local version is readable but update checks require same-origin explicit POST',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-update-test-'));let child;
 try{
  child=spawn(process.execPath,['--disable-warning=ExperimentalWarning',path.join(import.meta.dirname,'server.mjs'),'--port','0'],{env:{...process.env,CODEX_MONITOR_HOME:dir,CODEX_MONITOR_NETWORK_DISABLED:'1'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  const origin=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),8000);child.stdout.on('data',chunk=>{const match=chunk.toString().match(/"url":"([^"]+)"/);if(match){clearTimeout(timer);resolve(match[1].replace(/\/$/,''));}});child.once('exit',()=>{clearTimeout(timer);reject(Error('early exit'));});});
  assert.deepEqual(await (await fetch(origin+'/api/version')).json(),{version:fs.readFileSync(new URL('./VERSION',import.meta.url),'utf8').trim()});
  assert.equal((await fetch(origin+'/api/update/check')).status,404);
  for(const headers of [{},{Origin:'https://attacker.invalid','X-Monitor-Action':'check-update'},{Origin:origin},{'X-Monitor-Action':'check-update'}])assert.equal((await fetch(origin+'/api/update/check',{method:'POST',headers})).status,403);
  const page=await fetch(origin+'/');assert.match(page.headers.get('Content-Security-Policy'),/connect-src 'self'/);assert.match(await page.text(),/update-ui.js/);assert.equal((await fetch(origin+'/update-ui.js')).status,200);
  await fetch(origin+'/api/shutdown',{method:'POST',headers:{Origin:origin,'X-Monitor-Action':'shutdown'}});await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));
 }finally{if(child&&child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}fs.rmSync(dir,{recursive:true,force:true});}
});
