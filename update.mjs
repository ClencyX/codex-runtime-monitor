export const releasePage='https://github.com/ClencyX/codex-runtime-monitor/releases/latest';
export const releaseApi='https://api.github.com/repos/ClencyX/codex-runtime-monitor/releases/latest';

function versionParts(value){
 const match=String(value).trim().match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
 if(!match)return null;
 const parts=match.slice(1).map(Number);return parts.every(Number.isSafeInteger)?parts:null;
}
export function compareVersions(latest,current){
 const a=versionParts(latest),b=versionParts(current);if(!a||!b)return null;
 for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]>b[i]?1:-1;return 0;
}

// Only an explicit user action calls check(). No local records or credentials enter this request.
export class UpdateChecker{
 constructor(current,{fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=8000,cooldownMs=30000}={}){
  this.current=current;this.fetch=fetchImpl;this.now=now;this.timeoutMs=timeoutMs;this.cooldownMs=cooldownMs;this.pending=null;this.lastAttempt=null;this.result=null;this.controller=null;
 }
 check(){
  if(this.pending)return this.pending;
  if(this.lastAttempt!==null&&this.now()-this.lastAttempt<this.cooldownMs)return Promise.resolve(this.result);
  this.lastAttempt=this.now();
  this.pending=this.read().then(result=>(this.result=result)).finally(()=>{this.pending=null;});return this.pending;
 }
 async read(){
  const controller=new AbortController();this.controller=controller;const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
  try{
   const response=await this.fetch(releaseApi,{method:'GET',headers:{Accept:'application/vnd.github+json','User-Agent':'codex-runtime-monitor'},credentials:'omit',redirect:'error',signal:controller.signal});
   if(!response.ok)return {ok:false,error:response.status===403||response.status===429?'rate-limit':'unavailable'};
   const reader=response.body.getReader(),chunks=[];let size=0;
   try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>131072){await reader.cancel();throw Error('size');}chunks.push(value);}}finally{reader.releaseLock();}
   const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
   const comparison=compareVersions(data.tag_name,this.current);
   if(comparison===null||data.draft!==false||data.prerelease!==false||!Number.isFinite(Date.parse(data.published_at)))return {ok:false,error:'invalid'};
   return {ok:true,current:this.current,latest:data.tag_name,comparison,publishedAt:new Date(data.published_at).toISOString(),url:'https://github.com/ClencyX/codex-runtime-monitor/releases/tag/'+encodeURIComponent(data.tag_name),checkedAt:this.now()};
  }catch{return {ok:false,error:controller.signal.aborted?'timeout':'unavailable'};}
  finally{clearTimeout(timer);if(this.controller===controller)this.controller=null;}
 }
 stop(){this.controller?.abort();}
}
