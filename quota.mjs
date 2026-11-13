import fs from 'node:fs';
import {StringDecoder} from 'node:string_decoder';
import {QuotaReader} from './quota-reader.mjs';

const finite=n=>typeof n==='number'&&Number.isFinite(n),stamp=s=>{const n=Date.parse(s);return finite(n)?n:null;};
const identifier=s=>typeof s==='string'&&/^[\w.:-]{1,200}$/.test(s)?s:null;
const kinds={fiveHour:300,weekly:10080},freshMs=180000;

// Quota snapshots are account-wide observations, never per-turn billing data.
export class QuotaLedger{
 constructor({now=Date.now}={}){this.now=now;this.samples={fiveHour:[],weekly:[]};this.tasks=new Map();this.sources=new Map();this.gaps=[];this.sequence=0;}
 gap(from,to){if(finite(from)&&finite(to)&&to>from)this.gaps.push([from,to]);}
 observe(source,r,internal=false){
  const at=stamp(r.timestamp),p=r.payload||{};if(at===null||at>this.now()+5000)return;
  if(r.type==='event_msg'&&p.type==='token_count'&&p.rate_limits)this.quota(p.rate_limits,at);
  if(r.type==='event_msg'&&p.type==='task_started'){
   const turn=identifier(p.turn_id??p.turnId);if(!turn)return;const key=source+':'+turn;if(this.tasks.has(key)){this.sources.set(source,this.tasks.get(key));return;}
   const previous=this.sources.get(source);if(previous&&!finite(previous.end)){previous.end=at;previous.status='unknown';}
   const task={key,source,turn,start:at,end:null,status:'running',title:'',internal};this.tasks.set(key,task);this.sources.set(source,task);return;
  }
  if(r.type==='event_msg'&&['task_complete','task_completed','turn_aborted','turn_failed'].includes(p.type)){
   const turn=identifier(p.turn_id??p.turnId),task=turn?this.tasks.get(source+':'+turn):this.sources.get(source);
   if(task){task.end=at;task.status=['task_complete','task_completed'].includes(p.type)?'completed':'terminated';}return;
  }
  const task=this.sources.get(source);if(!task||task.title||finite(task.end))return;
  const content=r.type==='response_item'&&p.type==='message'&&p.role==='user'?p.content:r.type==='event_msg'&&p.type==='user_message'?p.message:null;
  let text='';
  if(typeof content==='string')text=content;
  else if(Array.isArray(content))text=content.map(part=>part?.text||'').join('\n');
  if(text.trim()&&!/^\s*(?:# AGENTS\.md instructions|<environment_context>|<permissions instructions>|<turn_aborted>|<INSTRUCTIONS>)/.test(text))task.title=text.trim().replace(/\s+/g,' ').slice(0,240);
 }
 quota(limits,at=this.now(),origin='log'){
  if(!limits||!finite(at)||at>this.now()+5000)return;
  const bucket=limits.limit_id??limits.limitId??'codex';if(bucket!=='codex')return;
  const complete=Object.hasOwn(limits,'primary')&&Object.hasOwn(limits,'secondary'),windows=[limits.primary,limits.secondary].filter(Boolean);
  for(const [kind,minutes] of Object.entries(kinds)){
   const w=windows.find(w=>(w.window_minutes??w.windowDurationMins)===minutes);if(!w&&!complete)continue;
   let point={at,origin,order:++this.sequence,available:false,used:null,resetAt:null};
   if(w){const used=w.used_percent??w.usedPercent,reset=w.resets_at??w.resetsAt;if(!finite(used)||used<0||used>100||!finite(reset)||reset<=0)continue;point={...point,available:true,used,resetAt:reset*1000};}
   const list=this.samples[kind];if(!list.some(p=>p.at===at&&p.used===point.used&&p.resetAt===point.resetAt&&p.origin===origin))list.push(point);
  }
 }
 series(kind){
  const out=[];let current=null,officialAt=-Infinity;
  for(const point of [...this.samples[kind]].sort((a,b)=>a.at-b.at||a.order-b.order)){
   // A fresh account query supersedes cached snapshots from other conversations.
   if(point.origin==='log'&&point.at<officialAt+60000)continue;
   if(point.origin==='official')officialAt=point.at;
   if(point.origin==='log'&&current!==null&&current.available&&point.available){
    if(point.resetAt<current.resetAt-2000)continue;
    if(Math.abs(point.resetAt-current.resetAt)<=2000&&point.used<current.used)continue;
   }
   current=point;out.push(point);
  }return out;
 }
 snapshot(now=this.now(),selected=null){
  const cutoff=now-8*86400000;for(const kind of Object.keys(kinds))this.samples[kind]=this.samples[kind].filter(p=>p.at>=cutoff).sort((a,b)=>a.at-b.at||a.order-b.order).slice(-12000);
  this.gaps=this.gaps.filter(([,b])=>b>=cutoff).slice(-2000);
  for(const [key,task] of this.tasks)if(finite(task.end)&&task.end<cutoff)this.tasks.delete(key);
  if(this.tasks.size>12000){const keep=[...this.tasks.values()].sort((a,b)=>b.start-a.start).slice(0,10000);this.tasks=new Map(keep.map(t=>[t.key,t]));}
  const series=Object.fromEntries(Object.keys(kinds).map(k=>[k,this.series(k)]));
  const windows=Object.fromEntries(Object.keys(kinds).map(k=>{const p=series[k].at(-1);return [k,p?{available:p.available,usedPercent:p.used,remainingPercent:p.available?100-p.used:null,updatedAt:p.at,resetAt:p.resetAt,source:p.origin,status:!p.available?'unavailable':now>=p.resetAt?'reset-pending':now-p.at>freshMs?'stale':'ready'}:null];}));
  const tasks=[...this.tasks.values()],rounds=tasks.filter(t=>!t.internal&&(!selected||t.source===selected)).sort((a,b)=>b.start-a.start).slice(0,100).map(task=>{
   const end=task.end??now,overlap=tasks.some(t=>t.key!==task.key&&t.start<end&&(t.end??now)>task.start);
   const delta=kind=>{
    const list=series[kind],before=at=>{let lo=0,hi=list.length;while(lo<hi){const m=(lo+hi)>>1;if(list[m].at<=at)lo=m+1;else hi=m;}return lo?list[lo-1]:null;};
    const first=before(task.start),last=before(end);let reason=null;
    if(!first||!last)reason='missing';else if(!first.available||!last.available)reason='unavailable';else if(last.at<task.start)reason='missing';
    else if(task.start-first.at>freshMs||end-last.at>freshMs)reason='stale';
    else if(Math.abs(first.resetAt-last.resetAt)>2000||first.resetAt<=end||last.used<first.used||list.some(p=>p.at>task.start&&p.at<=end&&(!p.available||Math.abs(p.resetAt-first.resetAt)>2000||p.used<first.used)))reason='reset';
    else if(this.gaps.some(([a,b])=>a<end&&b>first.at)||task.status==='unknown')reason='incomplete';
    if(!reason){let previous=first;for(const point of list){if(point.at<=task.start||point.at>end)continue;if(!point.available||point.used<previous.used){reason='reset';break;}previous=point;}}
    return {percent:reason?null:last.used-first.used,reason,fromAt:first?.at??null,toAt:last?.at??null};
   };
   return {id:task.key,sessionId:task.source,turnId:task.turn,title:task.title,startAt:task.start,endAt:task.end,status:task.status,overlap,fiveHour:delta('fiveHour'),weekly:delta('weekly')};
  });
  return {scope:'account-quota-observed-turns',computedAt:now,windows,rounds,previousRound:rounds.find(r=>r.status!=='running')??null};
 }
}

export class QuotaMonitor{
 constructor(home,{now=Date.now,reader=null,live=false}={}){
  this.home=home;this.now=now;this.ledger=new QuotaLedger({now});this.files=new Map();this.busy=false;this.closed=false;this.lastPoll=this.now();this.lastCompletedAt=null;this.errors=0;this.limited=false;
  this.reader=reader??new QuotaReader(home,{enabled:live});this.refreshing=null;this.lastAttempt=0;this.refreshError=null;this.refreshAt=null;
 }
 async read(entry,selected=false){
  let handle;try{
   const stat=await fs.promises.stat(entry.file);let cursor=this.files.get(entry.id);
   if(!cursor){cursor={offset:Math.max(0,stat.size-1048576),buffer:'',decoder:new StringDecoder('utf8'),dropping:stat.size>1048576,expanded:false};this.files.set(entry.id,cursor);}
   // Only the selected chat needs the larger history replay, matching SessionTail's bound.
   if(selected&&!cursor.expanded){this.ledger.sources.delete(entry.id);Object.assign(cursor,{offset:Math.max(0,stat.size-8*1048576),buffer:'',decoder:new StringDecoder('utf8'),dropping:stat.size>8*1048576,expanded:true});}
   if(stat.size<cursor.offset){this.ledger.gap(this.lastPoll,this.now());const current=this.ledger.sources.get(entry.id);if(current&&!finite(current.end)){current.end=this.now();current.status='unknown';}this.ledger.sources.delete(entry.id);Object.assign(cursor,{offset:0,buffer:'',decoder:new StringDecoder('utf8'),dropping:false});}
   if(stat.size<=cursor.offset)return;
   handle=await fs.promises.open(entry.file,'r');let budget=(cursor.expanded?12:4)*1048576;
   while(cursor.offset<stat.size&&budget>0&&!this.closed){const bytes=Buffer.alloc(Math.min(131072,stat.size-cursor.offset,budget)),{bytesRead}=await handle.read(bytes,0,bytes.length,cursor.offset);if(!bytesRead)break;cursor.offset+=bytesRead;budget-=bytesRead;cursor.buffer+=cursor.decoder.write(bytes.subarray(0,bytesRead));let end;
    while((end=cursor.buffer.indexOf('\n'))>=0){const line=cursor.buffer.slice(0,end);cursor.buffer=cursor.buffer.slice(end+1);if(cursor.dropping){cursor.dropping=false;continue;}if(!/"(?:event_msg|response_item)"/.test(line))continue;try{this.ledger.observe(entry.id,JSON.parse(line),entry.isGuardianReview);}catch{this.errors++;this.ledger.gap(this.lastPoll,this.now());}}
    if(cursor.buffer.length>2097152){cursor.buffer='';cursor.dropping=true;this.errors++;this.ledger.gap(this.lastPoll,this.now());}await new Promise(r=>setImmediate(r));
   }if(cursor.offset<stat.size){this.errors++;this.ledger.gap(this.lastPoll,this.now());}
  }catch{this.errors++;this.ledger.gap(this.lastPoll,this.now());}finally{await handle?.close();}
 }
 async poll(entries,selected=null){
  if(this.busy||this.closed)return;this.busy=true;const at=this.now();this.errors=0;this.limited=entries.filter(e=>!e.isGuardianReview).length>=500||entries.filter(e=>e.isGuardianReview).length>=500;
  if(at-this.lastPoll>10000||at<this.lastPoll)this.ledger.gap(Math.min(at,this.lastPoll),Math.max(at,this.lastPoll));
  try{for(let i=0;i<entries.length&&!this.closed;i+=4)await Promise.allSettled(entries.slice(i,i+4).map(e=>this.read(e,e.id===selected)));this.lastCompletedAt=this.now();}finally{this.lastPoll=at;this.busy=false;}
  if(!this.closed&&this.now()-this.lastAttempt>=60000)this.refresh().catch(()=>{});
 }
 refresh(){
  if(this.refreshing)return this.refreshing;if(this.closed)return Promise.resolve(false);
  this.lastAttempt=this.now();this.refreshing=(async()=>{try{const result=await this.reader.read();if(this.closed)return false;
    const limits=result?.rateLimitsByLimitId?.codex??result?.rateLimits;
    if(!limits||!['primary','secondary'].some(k=>Object.hasOwn(limits,k))){this.refreshError='unavailable';return false;}
    this.ledger.quota(limits,this.now(),'official');this.refreshError=null;this.refreshAt=this.now();return true;
   }catch(error){this.refreshError=['not-found','disabled','timeout','unavailable'].includes(error.message)?error.message:'unavailable';return false;}finally{this.refreshing=null;}})();return this.refreshing;
 }
 // Reuse already-read local task metadata; following needs no extra file scans or quota request.
 sessionStarts(){
  const starts=new Map();for(const task of this.ledger.tasks.values())if(!task.internal&&finite(task.start)&&task.start>(starts.get(task.source)??-Infinity))starts.set(task.source,task.start);
  return starts;
 }
 snapshot(selected=null){return {...this.ledger.snapshot(this.now(),selected),collecting:this.busy&&!this.lastCompletedAt,lastCompletedAt:this.lastCompletedAt,readErrors:this.errors,limited:this.limited,observedSessions:this.files.size,refreshing:!!this.refreshing,refreshAvailable:this.reader.enabled!==false,refreshError:this.refreshError,refreshAt:this.refreshAt};}
 stop(){this.closed=true;this.reader.stop();}
}
