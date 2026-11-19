import fs from 'node:fs';
import {StringDecoder} from 'node:string_decoder';
import {QuotaReader} from './quota-reader.mjs';
import {boundaryAge, endGrace, measureTurn, turnSeries} from './quota-turns.mjs';
import {QuotaJournal} from './quota-journal.mjs';

const finite=n=>typeof n==='number'&&Number.isFinite(n),stamp=s=>{const n=Date.parse(s);return finite(n)?n:null;};
const identifier=s=>typeof s==='string'&&/^[\w.:-]{1,200}$/.test(s)?s:null;
const kinds={fiveHour:300,weekly:10080},freshMs=boundaryAge;
const pointKey=p=>[p.at,p.origin,p.used,p.resetAt].join('|');

// Quota snapshots are account-wide observations, never per-turn billing data.
export class QuotaLedger{
 constructor({now=Date.now,since=now(),journal=null}={}){
  this.now=now;this.since=since;this.journal=journal;this.samples={fiveHour:[],weekly:[]};
  this.tasks=new Map();this.sources=new Map();this.gaps=[];this.sequence=0;this.lastBoundary=-Infinity;
  this.keys={fiveHour:new Set(),weekly:new Set()};this.timelines=null;
  journal?.restore(now(),record=>this.restore(record));
 }
 restore(record){
  if(record.type==='point'){
   const {kind,at,used,resetAt,origin,requestedAt}=record;
   if(!Object.hasOwn(kinds,kind)||!finite(at)||at<this.since||at>this.now()+5000||!['log','official'].includes(origin))return;
   if(used!==null&&(!finite(used)||used<0||used>100||!finite(resetAt)))return;
   this.addPoint(kind,{at,used,resetAt,origin,requestedAt,available:used!==null},false);
  }else if(record.type==='task'){
   const {source,turn,start,end,status,internal}=record;
   if(!identifier(source)||!identifier(turn)||!finite(start)||start<this.since||start>this.now()+5000)return;
   if(!['running','completed','terminated','unknown'].includes(status)||!(end===null||finite(end)&&end>=start))return;
   const key=source+':'+turn,existing=this.tasks.get(key);
   if(existing&&finite(existing.end)&&end===null)return;
   const task={key,source,turn,start,end,status,internal:!!internal,title:''};
   this.tasks.set(key,task);
   if(start>=(this.sources.get(source)?.start??-Infinity))this.sources.set(source,task);
  }
 }
 recordTask(task){
  if(task.start<this.since)return;
  const {source,turn,start,end,status,internal}=task,at=end??start;
  this.journal?.append(at,{type:'task',source,turn,start,end,status,internal},this.now());
  if(!internal)this.lastBoundary=Math.max(this.lastBoundary,at);
 }
 addPoint(kind,point,save=true){
  const key=pointKey(point);
  if(this.keys[kind].has(key))return;
  this.keys[kind].add(key);
  this.samples[kind].push({...point,order:++this.sequence});
  this.timelines=null;
  if(save&&point.at>=this.since)this.journal?.append(point.at,{type:'point',kind,...point},this.now());
 }
 gap(from,to){if(finite(from)&&finite(to)&&to>from)this.gaps.push([from,to]);}
 observe(source,r,internal=false){
  const at=stamp(r.timestamp),p=r.payload||{};if(at===null||at>this.now()+5000)return;
  if(r.type==='event_msg'&&p.type==='token_count'&&p.rate_limits)this.quota(p.rate_limits,at);
  if(r.type==='event_msg'&&p.type==='task_started'){
   const turn=identifier(p.turn_id??p.turnId);if(!turn)return;const key=source+':'+turn;if(this.tasks.has(key)){this.sources.set(source,this.tasks.get(key));return;}
   const previous=this.sources.get(source);if(previous&&previous.start<at&&!finite(previous.end)){previous.end=at;previous.status='unknown';this.recordTask(previous);}
   const task={key,source,turn,start:at,end:null,status:'running',title:'',internal};this.tasks.set(key,task);this.sources.set(source,task);this.recordTask(task);return;
  }
  if(r.type==='event_msg'&&['task_complete','task_completed','turn_aborted','turn_failed'].includes(p.type)){
   const turn=identifier(p.turn_id??p.turnId),task=turn?this.tasks.get(source+':'+turn):this.sources.get(source);
   const status=['task_complete','task_completed'].includes(p.type)?'completed':'terminated';
   if(task&&at>=task.start&&(task.end!==at||task.status!==status)){task.end=at;task.status=status;this.recordTask(task);}return;
  }
  const task=this.sources.get(source);if(!task||task.title||at<task.start||(finite(task.end)&&at>task.end))return;
  const content=r.type==='response_item'&&p.type==='message'&&p.role==='user'?p.content:r.type==='event_msg'&&p.type==='user_message'?p.message:null;
  let text='';
  if(typeof content==='string')text=content;
  else if(Array.isArray(content))text=content.map(part=>part?.text||'').join('\n');
  if(text.trim()&&!/^\s*(?:# AGENTS\.md instructions|<environment_context>|<permissions instructions>|<turn_aborted>|<INSTRUCTIONS>)/.test(text))task.title=text.trim().replace(/\s+/g,' ').slice(0,240);
 }
 quota(limits,at=this.now(),origin='log',requestedAt=null){
  if(!limits||!finite(at)||at>this.now()+5000)return;
  const bucket=limits.limit_id??limits.limitId??'codex';if(bucket!=='codex')return;
  const complete=Object.hasOwn(limits,'primary')&&Object.hasOwn(limits,'secondary'),windows=[limits.primary,limits.secondary].filter(Boolean);
  for(const [kind,minutes] of Object.entries(kinds)){
   const w=windows.find(w=>(w.window_minutes??w.windowDurationMins)===minutes);if(!w&&!complete)continue;
   let point={at,origin,requestedAt,available:false,used:null,resetAt:null};
   if(w){const used=w.used_percent??w.usedPercent,reset=w.resets_at??w.resetsAt;if(!finite(used)||used<0||used>100||!finite(reset)||reset<=0)continue;point={...point,available:true,used,resetAt:reset*1000};}
   this.addPoint(kind,point);
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
  const cutoff=now-8*86400000;
  if(!this.timelines||this.timelines.oldest<cutoff){
   const balances={},turns={};let oldest=Infinity;
   for(const kind of Object.keys(kinds)){
    this.samples[kind]=this.samples[kind].filter(p=>{
     if(p.at>=cutoff)return true;
     this.keys[kind].delete(pointKey(p));return false;
    }).sort((a,b)=>a.at-b.at||a.order-b.order);
    balances[kind]=this.series(kind);
    turns[kind]=turnSeries(this.samples[kind]);
    oldest=Math.min(oldest,this.samples[kind][0]?.at??Infinity);
   }
   this.timelines={balances,turns,oldest};
  }
  this.gaps=this.gaps.filter(([,b])=>b>=cutoff).slice(-2000);
  for(const [key,task] of this.tasks)if(finite(task.end)&&task.end<cutoff)this.tasks.delete(key);
  if(this.tasks.size>12000){const keep=[...this.tasks.values()].sort((a,b)=>b.start-a.start).slice(0,10000);this.tasks=new Map(keep.map(t=>[t.key,t]));}
  const {balances:series,turns:turnPoints}=this.timelines;
  const windows=Object.fromEntries(Object.keys(kinds).map(k=>{const p=series[k].at(-1);return [k,p?{available:p.available,usedPercent:p.used,remainingPercent:p.available?100-p.used:null,updatedAt:p.at,resetAt:p.resetAt,source:p.origin,status:!p.available?'unavailable':now>=p.resetAt?'reset-pending':now-p.at>freshMs?'stale':'ready'}:null];}));
  const tasks=[...this.tasks.values()],rounds=tasks.filter(t=>!t.internal&&(!selected||t.source===selected)).sort((a,b)=>b.start-a.start).slice(0,100).map(task=>{
   const end=task.end??now,overlap=tasks.some(t=>t.key!==task.key&&t.start<end&&(t.end??now)>task.start);
   const postEndLimit=task.end===null?-Infinity:tasks.reduce((limit,other)=>{
    if(other.key===task.key||(other.end??Infinity)<=task.end)return limit;
    return Math.min(limit,other.start);
   },Infinity);
   const delta=kind=>{
    if(task.start>=this.since)return measureTurn(turnPoints[kind],task,now,postEndLimit,kinds[kind]*60000);
    // Pre-upgrade turns keep their original accounting policy.
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
 constructor(home,{now=Date.now,reader=null,live=false,persist=false}={}){
  this.home=home;this.now=now;this.journal=persist?new QuotaJournal(home,now()):null;
  this.ledger=new QuotaLedger({now,since:this.journal?.since??now(),journal:this.journal});this.files=new Map();this.busy=false;this.closed=false;this.lastPoll=this.now();this.lastCompletedAt=null;this.errors=0;this.limited=false;
  this.reader=reader??new QuotaReader(home,{enabled:live});this.refreshing=null;this.lastAttempt=0;this.refreshError=null;this.refreshAt=null;
 }
 async read(entry,selected=false){
  let handle;try{
   const stat=await fs.promises.stat(entry.file);let cursor=this.files.get(entry.id);
   if(!cursor){cursor={offset:Math.max(0,stat.size-1048576),buffer:'',decoder:new StringDecoder('utf8'),dropping:stat.size>1048576,expanded:false};this.files.set(entry.id,cursor);}
   // Only the selected chat needs the larger history replay, matching SessionTail's bound.
   if(selected&&!cursor.expanded){this.ledger.sources.delete(entry.id);Object.assign(cursor,{offset:Math.max(0,stat.size-8*1048576),buffer:'',decoder:new StringDecoder('utf8'),dropping:stat.size>8*1048576,expanded:true});}
   if(stat.size<cursor.offset){this.ledger.gap(this.lastPoll,this.now());const current=this.ledger.sources.get(entry.id);if(current&&!finite(current.end)){current.end=this.now();current.status='unknown';this.ledger.recordTask(current);}this.ledger.sources.delete(entry.id);Object.assign(cursor,{offset:0,buffer:'',decoder:new StringDecoder('utf8'),dropping:false});}
   if(stat.size<=cursor.offset)return;
   handle=await fs.promises.open(entry.file,'r');let budget=(cursor.expanded?12:4)*1048576;
   while(cursor.offset<stat.size&&budget>0&&!this.closed){const bytes=Buffer.alloc(Math.min(131072,stat.size-cursor.offset,budget)),{bytesRead}=await handle.read(bytes,0,bytes.length,cursor.offset);if(!bytesRead)break;cursor.offset+=bytesRead;budget-=bytesRead;cursor.buffer+=cursor.decoder.write(bytes.subarray(0,bytesRead));let end;
    while((end=cursor.buffer.indexOf('\n'))>=0){const line=cursor.buffer.slice(0,end);cursor.buffer=cursor.buffer.slice(end+1);if(cursor.dropping){cursor.dropping=false;continue;}if(!/"(?:event_msg|response_item)"/.test(line))continue;try{this.ledger.observe(entry.id,JSON.parse(line),entry.isGuardianReview);}catch{this.errors++;this.ledger.gap(this.lastPoll,this.now());}}
    if(cursor.buffer.length>2097152){
     const toolOutput=/"type"\s*:\s*"response_item"\s*,\s*"payload"\s*:\s*\{\s*"type"\s*:\s*"(?:custom_tool_call_output|function_call_output)"/.test(cursor.buffer.slice(0,1024));
     if(!cursor.dropping&&!toolOutput){this.errors++;this.ledger.gap(this.lastPoll,this.now());}
     cursor.buffer='';cursor.dropping=true;
    }await new Promise(r=>setImmediate(r));
   }if(cursor.offset<stat.size){this.errors++;this.ledger.gap(this.lastPoll,this.now());}
  }catch{this.errors++;this.ledger.gap(this.lastPoll,this.now());}finally{await handle?.close();}
 }
 async poll(entries,selected=null){
  if(this.busy||this.closed)return;this.busy=true;const at=this.now();this.errors=0;this.limited=entries.filter(e=>!e.isGuardianReview).length>=500||entries.filter(e=>e.isGuardianReview).length>=500;
  if(at-this.lastPoll>10000||at<this.lastPoll)this.ledger.gap(Math.min(at,this.lastPoll),Math.max(at,this.lastPoll));
  try{for(let i=0;i<entries.length&&!this.closed;i+=4)await Promise.allSettled(entries.slice(i,i+4).map(e=>this.read(e,e.id===selected)));this.lastCompletedAt=this.now();}finally{this.lastPoll=at;this.busy=false;}
  const now=this.now(),boundary=this.ledger.lastBoundary;
  const boundaryDue=boundary>this.lastAttempt&&now-boundary<=endGrace&&now-this.lastAttempt>=3000;
  if(!this.closed&&(boundaryDue||now-this.lastAttempt>=60000))this.refresh().catch(()=>{});
 }
 refresh(){
  if(this.refreshing)return this.refreshing;if(this.closed)return Promise.resolve(false);
  this.lastAttempt=this.now();this.refreshing=(async()=>{try{const result=await this.reader.read();if(this.closed)return false;
    const limits=result?.rateLimitsByLimitId?.codex??result?.rateLimits;
    if(!limits||!['primary','secondary'].some(k=>Object.hasOwn(limits,k))){this.refreshError='unavailable';return false;}
    this.ledger.quota(limits,this.now(),'official',this.lastAttempt);this.refreshError=null;this.refreshAt=this.now();return true;
   }catch(error){this.refreshError=['not-found','disabled','timeout','unavailable'].includes(error.message)?error.message:'unavailable';return false;}finally{this.refreshing=null;}})();return this.refreshing;
 }
 // Reuse already-read local task metadata; following needs no extra file scans or quota request.
 sessionStarts(){
  const starts=new Map();for(const task of this.ledger.tasks.values())if(!task.internal&&finite(task.start)&&task.start>(starts.get(task.source)??-Infinity))starts.set(task.source,task.start);
  return starts;
 }
 snapshot(selected=null){return {...this.ledger.snapshot(this.now(),selected),journalError:!!this.journal?.error,collecting:this.busy&&!this.lastCompletedAt,lastCompletedAt:this.lastCompletedAt,readErrors:this.errors,limited:this.limited,observedSessions:this.files.size,refreshing:!!this.refreshing,refreshAvailable:this.reader.enabled!==false,refreshError:this.refreshError,refreshAt:this.refreshAt};}
 stop(){this.closed=true;this.reader.stop();}
}
