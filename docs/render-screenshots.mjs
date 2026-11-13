// Windows documentation capture using an isolated, temporary headless Edge profile.
// No packages, personal browser profile, Codex logs, or remote requests are used.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {startDemo} from './demo-server.mjs';
const edge=[process.env['PROGRAMFILES(X86)'],process.env.PROGRAMFILES].filter(Boolean).map(p=>path.join(p,'Microsoft/Edge/Application/msedge.exe')).find(p=>fs.existsSync(p));
if(!edge)throw Error('Microsoft Edge is required to render documentation screenshots.');
const out=path.join(import.meta.dirname,'images');fs.mkdirSync(out,{recursive:true});
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'codex-monitor-docs-')),demo=await startDemo();
const child=spawn(edge,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--remote-debugging-port=0','--remote-allow-origins=http://localhost',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));let ws,seq=0;const pending=new Map(),errors=[],remote=[];
try{
 let port;for(let i=0;i<100;i++){try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];break;}catch{await sleep(100);}}if(!port)throw Error('Edge debugging startup timeout');
 const tabs=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id){const task=pending.get(m.id);pending.delete(m.id);if(m.error)task?.reject(Error(JSON.stringify(m.error)));else task?.resolve(m.result);}if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails);if(m.method==='Network.requestWillBeSent'&&/^https?:/.test(m.params.request.url)&&!m.params.request.url.startsWith(demo.url))remote.push(m.params.request.url);};
 const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
 const run=async expression=>{const v=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(v.exceptionDetails)throw Error(JSON.stringify(v.exceptionDetails));return v.result?.value;};
 await send('Page.enable');await send('Runtime.enable');await send('Network.enable');await send('Emulation.setDeviceMetricsOverride',{width:820,height:1100,deviceScaleFactor:1,mobile:false});
 const rect=selector=>run(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+scrollX,y:r.y+scrollY,width:r.width,height:r.height,scale:1};})()`);
 async function shot(name,selector){const clip=selector?await rect(selector):await run('({x:0,y:0,width:innerWidth,height:document.documentElement.scrollHeight,scale:1})');const result=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});fs.writeFileSync(path.join(out,name),Buffer.from(result.data,'base64'));return clip;}
 async function waitFor(expression){for(let i=0;i<80;i++){if(await run(expression))return;await sleep(100);}throw Error('UI readiness timeout: '+expression);}
 for(const [language,theme,suffix] of [['zh-CN','light','zh'],['en','dark','en']]){
  await fetch(demo.url+'/demo/config?lang='+language);await send('Page.navigate',{url:demo.url});await waitFor('!!globalThis.CodexMonitorI18n');
  await run(`localStorage.clear();sessionStorage.clear();localStorage.setItem('codex-monitor-language',${JSON.stringify(language)});localStorage.setItem('codex-monitor-theme',${JSON.stringify(theme)});`);
  await send('Page.reload');await waitFor(`document.getElementById('status')?.textContent===${JSON.stringify(language==='en'?'Running':'运行中')}&&document.querySelector('.traffic-line:not(.traffic-gap)')?.getAttribute('d')?.length>10`);
  await run(`document.querySelector('#retries-toggle').click();for(const b of document.querySelectorAll('#events .event-toggle'))if(b.getAttribute('aria-expanded')==='false')b.click();`);await sleep(150);
  assert.equal(demo.checks,language==='en'?2:0,'page load must not check updates');
  const overflow=await run('({page:document.documentElement.scrollWidth>innerWidth,panels:[...document.querySelectorAll(".panel")].filter(n=>!n.hidden).length})');assert.equal(overflow.page,false);assert.equal(overflow.panels,7);
  await shot('overview-'+suffix+'.png');await shot('activity-'+suffix+'.png','#activity-panel');await shot('connections-'+suffix+'.png','#tools-panel');await shot('traffic-'+suffix+'.png','#network-panel');await shot('quota-expanded-'+suffix+'.png','#quota-panel');
  await run(`document.querySelector('#quota-panel .panel-toggle').click()`);await shot('quota-collapsed-'+suffix+'.png','#quota-panel');await run(`document.querySelector('#quota-panel .panel-toggle').click();document.querySelector('#panel-order-toggle').click()`);await shot('arrange-'+suffix+'.png','#panel-order-settings');await run(`document.querySelector('#panel-order-toggle').click();document.querySelector('#update-check').click()`);await waitFor('!document.querySelector("#update-details").hidden');await shot('updates-'+suffix+'.png','.update-section');
  // Browser UI checks: narrow viewport and a failed update request, then language switching.
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:1000,deviceScaleFactor:1,mobile:false});assert.equal(await run('document.documentElement.scrollWidth>innerWidth'),false);
  await send('Emulation.setDeviceMetricsOverride',{width:820,height:1100,deviceScaleFactor:1,mobile:false});
  // Capture actual rendered activity frames, then return the same running calls in place.
  const frames=[];const clip=await rect('#activity-panel');clip.height=Math.min(clip.height,285);clip.scale=.8;
  for(let i=0;i<10;i++){
   if(i===6)await fetch(demo.url+'/demo/config?lang='+language+'&returned=1');
   await sleep(350);const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip});
   const frame=await run(`(async()=>{const image=new Image();image.src='data:image/png;base64,${data}';await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const x=c.getContext('2d');x.drawImage(image,0,0);const rgba=x.getImageData(0,0,c.width,c.height).data;const rgb=new Uint8Array(c.width*c.height*3);for(let i=0;i<c.width*c.height;i++){rgb[i*3]=rgba[i*4];rgb[i*3+1]=rgba[i*4+1];rgb[i*3+2]=rgba[i*4+2];}let binary='';for(let i=0;i<rgb.length;i+=8192)binary+=String.fromCharCode(...rgb.subarray(i,i+8192));return {width:c.width,height:c.height,pixels:btoa(binary)};})()`);frames.push(frame);
  }
  writeGif(path.join(out,'activity-'+suffix+'.gif'),frames);
  await fetch(demo.url+'/demo/config?lang='+language+'&updateError=1');await run(`document.querySelector('#update-check').click()`);await waitFor(`document.querySelector('#update-status').dataset.state==='error'`);assert.equal(await run(`document.querySelector('#update-details').hidden`),true);
  // English fixtures must not retain Chinese prose in visible text.
  if(language==='en'){
   const chinese=await run(`document.body.innerText.split('\\n').filter(t=>/[\u3400-\u9fff]/.test(t)&&t.trim()!=='中文')`);assert.deepEqual(chinese,[],'English screenshots contain Chinese prose');
  }
 }
 assert.deepEqual(errors,[],'browser exceptions');assert.deepEqual(remote,[],'documentation fixture must stay local');
 console.log(JSON.stringify({screenshots:16,animations:2,updateChecks:demo.checks,browserErrors:errors.length,remoteRequests:remote.length}));
 await send('Browser.close');
}finally{
 ws?.close();if(child.exitCode===null){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),sleep(3000)]);}await new Promise(resolve=>demo.server.close(resolve));
 for(let i=0;i<10;i++){try{fs.rmSync(profile,{recursive:true,force:true});break;}catch{await sleep(300);}}
}
function writeGif(file,frames){
 const histogram=new Map(),key=(r,g,b)=>(r>>3)<<10|(g>>3)<<5|(b>>3),raw=frames.map(f=>Buffer.from(f.pixels,'base64'));
 for(const rgb of raw)for(let i=0;i<rgb.length;i+=3){const k=key(rgb[i],rgb[i+1],rgb[i+2]),entry=histogram.get(k)||[0,0,0,0];entry[0]++;for(let c=0;c<3;c++)entry[c+1]+=rgb[i+c];histogram.set(k,entry);}
 const palette=[...histogram.values()].sort((a,b)=>b[0]-a[0]).slice(0,256).map(e=>e.slice(1).map(v=>Math.round(v/e[0]))),mapping=new Map();
 for(const [k,e] of histogram){const rgb=e.slice(1).map(v=>v/e[0]);let best=0,min=Infinity;for(let i=0;i<palette.length;i++){const d=palette[i].reduce((sum,v,c)=>sum+(v-rgb[c])**2,0);if(d<min){best=i;min=d;}}mapping.set(k,best);}
 const chunks=[],byte=(...v)=>chunks.push(Buffer.from(v)),word=n=>byte(n&255,n>>8);
 chunks.push(Buffer.from('GIF89a'));word(frames[0].width);word(frames[0].height);byte(247,0,0);
 for(let i=0;i<256;i++)byte(...(palette[i]||[0,0,0]));
 byte(33,255,11);chunks.push(Buffer.from('NETSCAPE2.0'));byte(3,1,0,0,0);
 for(const [frameIndex,f] of frames.entries()){
  byte(33,249,4,4,35,0,0,0,44);word(0);word(0);word(f.width);word(f.height);byte(0,8);
  const rgb=raw[frameIndex],pixels=Buffer.alloc(f.width*f.height);for(let i=0;i<pixels.length;i++)pixels[i]=mapping.get(key(rgb[i*3],rgb[i*3+1],rgb[i*3+2]));const data=[];let bits=0,bitCount=0;
  const code=n=>{bits|=n<<bitCount;bitCount+=9;while(bitCount>=8){data.push(bits&255);bits>>>=8;bitCount-=8;}};
  // Clear often to keep the literal stream at nine bits; small and dependency-free.
  for(let i=0;i<pixels.length;i++){if(i%200===0)code(256);code(pixels[i]);}code(257);if(bitCount)data.push(bits&255);
  const buf=Buffer.from(data);for(let i=0;i<buf.length;i+=255){const part=buf.subarray(i,i+255);byte(part.length);chunks.push(part);}byte(0);
 }byte(59);fs.writeFileSync(file,Buffer.concat(chunks));
}
