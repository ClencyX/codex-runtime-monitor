import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import readline from 'node:readline';

export function findCodex(env=process.env){
 if(env.CODEX_MONITOR_CODEX_BIN&&fs.existsSync(env.CODEX_MONITOR_CODEX_BIN))return env.CODEX_MONITOR_CODEX_BIN;
 const exe=process.platform==='win32'?'codex.exe':'codex';for(const folder of (env.PATH||'').split(path.delimiter)){const file=path.join(folder,exe);try{if(fs.statSync(file).isFile())return file;}catch{}}
 const local=env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),roots=[path.join(local,'OpenAI','Codex','bin')];
 try{for(const dir of fs.readdirSync(path.join(local,'JetBrains')).filter(d=>/^PyCharm/.test(d))){const root=path.join(local,'JetBrains',dir,'acp-agents','codex-acp');try{for(const version of fs.readdirSync(root))roots.push(path.join(root,version,'node_modules','@openai','codex-win32-x64','vendor','x86_64-pc-windows-msvc','bin'));}catch{}}}catch{}
 const candidates=[];for(const root of roots){try{for(const dir of ['',...fs.readdirSync(root)]){const file=path.join(root,dir,exe);try{const stat=fs.statSync(file);if(stat.isFile())candidates.push({file,mtime:stat.mtimeMs});}catch{}}}catch{}}
 return candidates.sort((a,b)=>b.mtime-a.mtime)[0]?.file??null;
}

// Request only account metadata. Never initialize a thread or invoke a model.
export class QuotaReader{
 constructor(home,{enabled=true,binary=null,spawnProcess=spawn,timeoutMs=15000}={}){this.home=home;this.enabled=enabled;this.binary=binary;this.spawnProcess=spawnProcess;this.timeoutMs=timeoutMs;this.child=null;this.pending=null;this.cancel=null;}
 read(){
  if(this.pending)return this.pending;if(!this.enabled)return Promise.reject(Error('disabled'));
  const binary=this.binary||findCodex();if(!binary)return Promise.reject(Error('not-found'));
  this.pending=new Promise((resolve,reject)=>{
   let settled=false,rl,timer;const child=this.spawnProcess(binary,['app-server','--listen','stdio://'],{cwd:this.home,env:{...process.env,CODEX_HOME:this.home},windowsHide:true,stdio:['pipe','pipe','ignore']});this.child=child;
   const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);rl?.close();child.stdin?.end();const kill=setTimeout(()=>{if(child.exitCode===null)child.kill();},1000);kill.unref();child.once('close',()=>clearTimeout(kill));error?reject(Error(error)):resolve(result);};this.cancel=()=>finish('unavailable');
   const send=message=>child.stdin.write(JSON.stringify(message)+'\n');child.stdin.on('error',()=>finish('unavailable'));child.once('error',()=>finish('unavailable'));child.once('exit',()=>finish('unavailable'));
   rl=readline.createInterface({input:child.stdout});rl.on('line',line=>{if(line.length>2097152){finish('unavailable');return;}let m;try{m=JSON.parse(line);}catch{return;}
    if(m.id===0){if(m.error||!m.result){finish('unavailable');return;}send({method:'initialized',params:{}});send({method:'account/rateLimits/read',id:1});}
    if(m.id===1)finish(m.error?'unavailable':null,m.result);
   });timer=setTimeout(()=>finish('timeout'),this.timeoutMs);
   send({method:'initialize',id:0,params:{clientInfo:{name:'codex_runtime_monitor',version:'0.1.6'}}});
  }).finally(()=>{this.pending=null;this.cancel=null;this.child=null;});return this.pending;
 }
 stop(){const child=this.child;this.cancel?.();if(child&&child.exitCode===null)child.kill();}
}
