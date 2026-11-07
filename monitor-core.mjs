import fs from 'node:fs';
import path from 'node:path';
import {StringDecoder} from 'node:string_decoder';

const timestamp=value=>{if(typeof value==='number')return value<1e12?value*1000:value;const n=Date.parse(value);return Number.isFinite(n)?n:null;};
export function blankState(id=''){
 return {id,title:'Codex 会话',cwd:'',model:'',effort:'',turnId:null,taskTitle:null,status:'unknown',terminationCode:null,terminationReason:null,terminationAt:null,startedAt:null,endedAt:null,firstReplyAt:null,lastActivityAt:null,lastAction:'尚未读取到活动',pending:[],lastTool:null,plan:[],retries:0,failures:0,fallbacks:0,requestBytes:null,events:[],readError:null,dbError:null};
}
function activity(s,at,label){
 if(at>=(s.lastActivityAt||0))s.lastAction=label;
 s.lastActivityAt=Math.max(s.lastActivityAt||0,at);
}
export function addEvent(s,at,label,kind='activity',durationMs=null){
 if(!at)return;activity(s,at,label);
 const key=`${at}:${label}`,existing=s.events.find(e=>e.key===key);if(existing)return existing;
 const event={key,at,label,kind,durationMs};s.events.push(event);s.events.sort((a,b)=>a.at-b.at);return event;
}
function identifier(value){return typeof value==='string'&&/^[\w.:-]{1,200}$/.test(value)?value:null;}
export function promptTitle(text){
 const title=String(text).trim().replace(/\s+/g,' ');
 return title?'任务：'+title:null;
}
function userTitle(s,content){
 if(s.taskTitle)return;
 const text=typeof content==='string'?content:Array.isArray(content)?content.map(block=>block.text||'').join('\n'):'';
 if(!text.trim()||/^\s*(?:# AGENTS\.md instructions|<environment_context>|<permissions instructions>|<turn_aborted>|<INSTRUCTIONS>)/.test(text))return;
 s.taskTitle=promptTitle(text);
}
function modelEvent(s,id,at,source){
 const itemId=identifier(id),key=itemId?'model:'+itemId:at+':model:'+source;
 const existing=s.events.find(event=>event.key===key);
 if(existing){
  if(!existing.sources.includes(source))existing.sources.push(source);
  // A session timestamp is more precise than the second-resolution SQL log.
  if(source==='response'&&!existing.fromResponse){existing.at=at;existing.fromResponse=true;s.events.sort((a,b)=>a.at-b.at);}
  return;
 }
 const event={key,at,label:'收到模型处理事件',kind:'activity',durationMs:null,sources:[source],fromResponse:source==='response'};
 if(itemId)event.itemId=itemId;
 s.events.push(event);s.events.sort((a,b)=>a.at-b.at);activity(s,at,event.label);
}
function references(payload={},item={},metadata={}){
 metadata=metadata||{};
 const result={};
 const call=identifier(payload.parent_call_id??payload.parentCallId??item.parent_call_id??metadata.parent_call_id);
 const parentItem=identifier(payload.parent_item_id??item.parent_item_id??metadata.parent_item_id);
 if(call)result.parentCallId=call;if(parentItem)result.parentItemId=parentItem;return result;
}
function completeItem(s,p,item,at,name,kind,duration,startedAt,endedAt,metadata){
 const id=p.call_id??item.call_id??item.id,callId=String(id??'');
 if(finishCall(s,id,at,'已结束',kind)){
  const event=s.events.find(entry=>entry.key==='call:'+callId);
  if(event)Object.assign(event,references(p,item,metadata),identifier(item.id)?{itemId:item.id}:{},kind==='warning'||item.status==='failed'?{status:'failed'}:{});
  if(s.lastTool&&event?.status==='failed')s.lastTool.status='failed';return;
 }
 const itemId=identifier(item.id),key=itemId?'item:'+itemId:null;
 let event=key?s.events.find(entry=>entry.key===key):null;
 if(event){Object.assign(event,references(p,item,metadata));return;}
 if(key){event={key,itemId,at,label:name+'已结束',kind,durationMs:duration};s.events.push(event);s.events.sort((a,b)=>a.at-b.at);activity(s,at,event.label);}
 else event=addEvent(s,at,name+'已结束',kind,duration);
 Object.assign(event,{operation:true,toolLabel:name,status:kind==='warning'||item.status==='failed'?'failed':'returned',startedAt,endedAt},references(p,item,metadata));
 const explicitCall=identifier(p.call_id??item.call_id);if(explicitCall)event.callId=explicitCall;
 s.lastTool={label:name,durationMs:duration,at,status:item.status||'completed'};
}

function beginCall(s,p,at,metadata){
 const id=p.call_id??p.id,label=labelFor(p.name,p.input||p.arguments||'');
 if(id===undefined||id===null||id===''){
  const event=addEvent(s,at,label+'（调用标识缺失）','tool');Object.assign(event,{operation:true,status:'unknown'});return;
 }
 const callId=String(id),key='call:'+callId;
 const existing=s.events.find(e=>e.key===key);if(existing){Object.assign(existing,references(p,{},metadata));return;}
 const event={key,callId,at,startedAt:at,endedAt:null,toolLabel:label,label:label+'（运行中）',kind:'tool',operation:true,status:'running',durationMs:null,...references(p,{},metadata)};
 if(p.name==='exec')event.codeMode=true;
 s.events.push(event);s.events.sort((a,b)=>a.at-b.at);s.pending.push({id:callId,label,startedAt:at,eventKey:key});activity(s,at,event.label);
}
function finishCall(s,id,at,suffix='已返回',kind='tool'){
 if(id===undefined||id===null)return false;
 const callId=String(id),event=s.events.find(e=>e.key==='call:'+callId);
 if(!event)return false;if(event.status==='returned'||event.status==='failed')return true;
 const index=s.pending.findIndex(call=>call.id===callId);if(index>=0)s.pending.splice(index,1);
 const durationMs=Number.isFinite(event.startedAt)&&at>=event.startedAt?at-event.startedAt:null;
 Object.assign(event,{endedAt:at,status:'returned',label:event.toolLabel+suffix,kind,durationMs});
 delete event.unconfirmedReason;delete event.detail;
 s.lastTool={label:event.toolLabel,durationMs,at,status:'completed'};activity(s,at,event.label);return true;
}
function unconfirmedCalls(s){
 for(const event of s.events)if(event.status==='running')Object.assign(event,{status:'unknown',label:event.toolLabel+'（结束未确认）',durationMs:null});
 s.pending=[];
}
export function terminationCause(payload={}){
 const strings=[];
 function collect(value,depth=0){
  if(depth>4)return;if(typeof value==='string'){strings.push(value.slice(0,4096));return;}
  if(value&&typeof value==='object')for(const key of ['code','type','message','reason','error','error_code','codex_error_info'])if(key in value)collect(value[key],depth+1);
 }
 // Only structured error/reason fields are inspected. Normal assistant prose,
 // tool output and a recovered command failure cannot terminate a task.
 for(const key of ['error','reason','error_code','codex_error_info','termination_reason','stop_reason','incomplete_details'])collect(payload[key]);
 const text=strings.join(' ').toLowerCase();
 const causes=[
  [/usage[ _-]?limit|insufficient_quota|quota[ _-]?(?:exceeded|exhausted)|(?:hit|reached|exceeded).{0,30}quota|(?:credits?|budget).{0,20}(?:exhausted|depleted)|到达额度|额度.{0,8}(?:用尽|耗尽|不足|上限)/,'quota','到达额度'],
  [/new[ _-]?(?:user[ _-]?)?(?:message|turn|conversation|input)|superseded|replaced_by|新对话|新消息插入/,'new-input','新对话插入'],
  [/manual[ _-]?(?:pause|stop)|user[ _-]?(?:cancelled|canceled|stop|requested)|cancel(?:led|ed)_by_user|手动暂停|手动停止/,'manual-pause','手动暂停'],
  [/context[ _-]?(?:length|window)|上下文.{0,6}(?:超限|限制)/,'context-limit','上下文超限'],
  [/max[ _-]?(?:output[ _-]?)?tokens|output[ _-]?token[ _-]?limit/,'output-limit','输出长度限制'],
  [/timed?[ _-]?out|timeout|超时/,'timeout','请求超时'],
  [/authentication|unauthori[sz]ed|invalid[ _-]?(?:api[ _-]?)?key|身份验证/,'authentication','身份验证失败'],
  [/approval.{0,50}(?:denied|rejected|failed)|审批.{0,6}(?:拒绝|未通过)/,'approval','审批未通过'],
  [/network|connection.{0,30}(?:failed|closed|reset)|stream.{0,20}(?:failed|disconnected)|网络连接/,'network','网络连接异常'],
  [/interrupt(?:ed|ion)?|用户中断/,'interrupted','用户中断']
 ];
 for(const [pattern,code,reason] of causes)if(pattern.test(text))return {code,reason};
 return {code:payload.type==='turn_failed'||payload.error?'runtime-error':'unknown',reason:payload.type==='turn_failed'||payload.error?'运行错误':'原因未知'};
}
function endTask(s,at,cause=null,endKnown=true){
 if(s.status==='terminated'&&!cause)return;
 s.status=cause?'terminated':'completed';s.terminationCode=cause?.code||null;s.terminationReason=cause?.reason||null;s.terminationAt=cause?at:null;s.endedAt=endKnown?at:null;unconfirmedCalls(s);
 const label=cause?'任务终止（'+cause.reason+'）':'任务已完成';
 let event=s.events.find(entry=>entry.turnEnd);
 if(event)Object.assign(event,{at,label,kind:cause?'warning':'completed'});
 else{event=addEvent(s,at,label,cause?'warning':'completed');event.turnEnd=true;event.key='turn-end:'+(s.turnId||s.startedAt||at);}
 if(cause)Object.assign(event,{terminationCode:cause.code,terminationReason:cause.reason});
 activity(s,at,label);
}
function labelFor(name='',input=''){
 if(name==='exec')return '组合调用';
 if(/exec_command|commandExecution/i.test(name))return '本地命令';
 if(/write_stdin|wait_cell|wait$/i.test(name))return '等待工具结果';
 if(/apply_patch|fileChange/i.test(name))return '修改文件';
 if(/web|search|fetch/i.test(name))return '检索或读取资料';
 if(/view_image|imageView/i.test(name))return '查看图片';
 if(/read_file/i.test(name))return '读取文件';
 return `工具 ${String(name).replace(/[^\w.:-]/g,'').slice(0,70)||'调用'}`;
}
function start(s,p,at){
 const keep={id:s.id,title:s.title,cwd:s.cwd,model:s.model,effort:s.effort};
 Object.assign(s,blankState(s.id),keep,{turnId:p.turn_id||p.turnId||null,status:'running',startedAt:at});
 addEvent(s,at,'任务已记录','start');
}
function plan(s,list){if(Array.isArray(list))s.plan=list.slice(0,30).map(x=>({step:String(x.step||x.content||'任务步骤').slice(0,180),status:/completed/.test(x.status)?'completed':/in.?progress/i.test(x.status)?'inProgress':'pending'}));}
export function reduceRecord(s,r){
 const p=r.payload||{},recordAt=timestamp(r.timestamp),at=Number.isFinite(recordAt)?recordAt:Date.now();
 if(r.type==='session_meta'){s.id=p.id||p.session_id||s.id;s.cwd=p.cwd||'';return;}
 if(r.type==='turn_context'){s.model=p.model||s.model;s.effort=p.effort||p.collaboration_mode?.settings?.reasoning_effort||s.effort;return;}
 if(r.type==='event_msg'){
  // Prefer event timestamps: payload task boundaries may be rounded to seconds.
  if(p.type==='task_started'){if(p.turn_id&&p.turn_id===s.turnId)return;start(s,p,Number.isFinite(recordAt)?recordAt:timestamp(p.started_at)||at);return;}
  if(p.turn_id&&s.turnId&&p.turn_id!==s.turnId)return;
  if(['task_complete','task_completed','turn_aborted','turn_failed'].includes(p.type)){
   if(!s.startedAt)s.startedAt=timestamp(p.started_at);
   const interrupted=p.type==='turn_aborted'||p.type==='turn_failed'||Boolean(p.error)||['failed','cancelled','canceled','incomplete'].includes(p.status);
   endTask(s,Number.isFinite(recordAt)?recordAt:timestamp(p.completed_at)||at,interrupted?terminationCause(p):null);return;
  }
  if(p.type==='plan_update'||p.type==='plan'){plan(s,p.plan);return;}
  if(p.type==='item_completed'){
   const item=p.item||{},type=String(item.type||'').toLowerCase();
   const startedAt=timestamp(p.started_at_ms??item.started_at_ms),endedAt=timestamp(p.completed_at_ms??item.completed_at_ms);
   const duration=Number.isFinite(startedAt)&&startedAt>0&&Number.isFinite(endedAt)&&endedAt>0&&endedAt>=startedAt?endedAt-startedAt:null;
   if(type==='usermessage')userTitle(s,item.content);
   else if(type==='reasoning')modelEvent(s,item.id,at,'item');
   else if(type==='commandexecution'||type==='mcptoolcall'||type==='filechange'){
    const name=type==='commandexecution'?'本地命令':type==='filechange'?'修改文件':labelFor(item.tool||item.name||'MCP');
    const kind=item.exit_code&&item.exit_code!==0?'warning':'tool';
    completeItem(s,p,item,at,name,kind,duration,startedAt,endedAt,r.metadata);
   }else if(type==='extension'&&/web|search/i.test(item.kind||'')){completeItem(s,p,item,at,'检索资料','tool',duration,startedAt,endedAt,r.metadata);}
   return;
  }
  return;
 }
 if(r.type!=='response_item')return;
 if(s.startedAt&&at<s.startedAt)return;
 if(p.type==='message'&&p.role==='user'){userTitle(s,p.content);return;}
 if(p.type==='message'&&p.role==='assistant'){
  if(!s.firstReplyAt)s.firstReplyAt=at;
  addEvent(s,at,p.phase==='final_answer'||p.channel==='final'?'收到最终回复':'收到工作进度');return;
 }
 if(p.type==='reasoning'){modelEvent(s,p.id,at,'response');return;}
 if(p.type==='function_call'||p.type==='custom_tool_call'){
  if(/update_plan$/.test(p.name||'')){try{plan(s,JSON.parse(p.arguments||p.input||'{}').plan);}catch{} }
  beginCall(s,p,at,r.metadata);return;
 }
 if(p.type==='function_call_output'||p.type==='custom_tool_call_output'){
  if(finishCall(s,p.call_id,at)){const event=s.events.find(entry=>entry.key==='call:'+String(p.call_id));if(event)Object.assign(event,references(p,{},r.metadata));}
 }
}

// Only derived labels and numbers leave this reducer. Never expose log bodies,
// model reasoning, commands, tool arguments, output, images, or HTTP headers.
function connectionEvent(s,row,at,type,label,detail){
 const key=Number.isSafeInteger(row.id)?'connection:'+row.id:`connection:${at}:${type}:${detail}`;
 if(s.events.some(event=>event.key===key))return;
 s.events.push({key,at,label,detail,kind:'warning',connectionType:type,durationMs:null});
 s.events.sort((a,b)=>a.at-b.at);activity(s,at,label);
 s[{retry:'retries',failure:'failures',fallback:'fallbacks'}[type]]++;
}
function connectionReason(body){
 const reasons=[
  [/request timed out|timed out|timeout/i,'请求超时'],
  [/certificate|invalid peer|tls|ssl/i,'TLS 或证书错误'],
  [/dns|failed to lookup|name resolution/i,'DNS 解析失败'],
  [/connection reset|connection refused|connect error|connection closed/i,'连接中断或无法建立'],
  [/stream disconnected/i,'响应流断开']
 ];
 return reasons.find(([pattern])=>pattern.test(body))?.[1]||null;
}
export function logTimestamp(row){
 const seconds=Number(row.ts),nanos=row.ts_nanos;
 return seconds*1000+(Number.isInteger(nanos)&&nanos>=0&&nanos<1e9?nanos/1e6:0);
}
function logResolution(row){return Number.isInteger(row.ts_nanos)&&row.ts_nanos>=0&&row.ts_nanos<1e9?0:999.999;}
function logTurn(row){return (row.feedback_log_body||'').match(/(?:turn\.id|turn_id)[=\s]+["']?([\w-]+)/)?.[1]||null;}
export function interruptedHost(row){
 if(row.target!=='codex_code_mode::timing')return null;
 const body=row.feedback_log_body||'',marker='code-mode host operation completed',index=body.lastIndexOf(marker);
 if(index<0||!/\boutcome="interrupted"/.test(body.slice(0,index)))return null;
 const fields=body.slice(index);
 if(!/\bevent\.name="codex\.code_mode\.host_timing"/.test(fields)||!/\btool_name="exec"/.test(fields))return null;
 const callId=identifier(fields.match(/\bcall_id=(?:"([\w.:-]+)"|([\w.:-]+))/)?.slice(1).find(Boolean));
 if(!callId)return null;
 const nanos=Number(fields.match(/\bcode_mode_host_duration_ns=(\d+)\b/)?.[1]);
 return {callId,durationMs:Number.isSafeInteger(nanos)&&nanos>=0?nanos/1e6:null};
}
function markHostInterrupted(s,host,at){
 const event=s.events.find(entry=>entry.callId===host.callId&&entry.codeMode);
 if(!event||event.status==='returned'||event.status==='failed'||event.unconfirmedReason)return;
 // This is a host-stage observation, not an authoritative call/turn completion.
 Object.assign(event,{status:'unknown',kind:'warning',durationMs:null,endedAt:null,hostInterruptedAt:at,hostDurationMs:host.durationMs,unconfirmedReason:'host-interrupted',label:event.toolLabel+'（结束未确认）',detail:'脚本执行环境记录中断，但外层调用缺少返回记录；该调用总耗时未知。'});
 s.pending=s.pending.filter(call=>call.id!==host.callId);
 if(!s.lastTool||at>=s.lastTool.at)s.lastTool={label:event.toolLabel,durationMs:null,at,status:'unknown'};
 activity(s,at,event.label);
}
export function reduceLog(s,row){
 const at=logTimestamp(row);if(!Number.isFinite(at)||s.startedAt&&at+logResolution(row)<s.startedAt)return;
 if(s.endedAt&&at>s.endedAt)return;
 const body=row.feedback_log_body||'';
 const turn=logTurn(row);
 if(turn&&s.turnId&&turn!==s.turnId)return;
 const host=interruptedHost(row);if(host){markHostInterrupted(s,host,at);return;}
 const diagnostic=row.target!=='feedback_tags'&&!/Output item item_type=/.test(body),reason=connectionReason(body);
 if(diagnostic&&/falling back to HTTP/i.test(body)){
  connectionEvent(s,row,at,'fallback','传输回退至 HTTP','传输回退：从 WebSocket 切换到 HTTP/HTTPS'+(reason?'；原因：'+reason:''));
 }else if(diagnostic&&/stream disconnected.*retrying|retrying request after delay/i.test(body)){
  const retry=body.match(/retries=(\d+).*max_retries=(\d+)/),delay=body.match(/(?:\bin\s+|after delay[:= ]+)(\d{1,8}(?:\.\d{1,6})?)\s*(ms|s)\b/i);
  const label=`连接重试${retry?`（本组 ${retry[1]}/${retry[2]}）`:''}`;
  const detail=[label,reason?'原因：'+reason:null,delay?`等待 ${delay[1]} ${delay[2].toLowerCase()==='ms'?'毫秒':'秒'}后重试`:null].filter(Boolean).join('；');
  connectionEvent(s,row,at,'retry',label,detail);
 }else if(diagnostic&&/Request failed.*(?:responses|compact)|request timed out|stream.*failed/i.test(body)){
  const label=/timed out|timeout/i.test(body)?'日志记录请求超时':'日志记录请求失败',status=body.match(/\bstatus[=: ]+(\d{3})\b/i);
  const detail=[label,reason&&!label.includes(reason)?'原因：'+reason:null,status?'HTTP 状态 '+status[1]:null].filter(Boolean).join('；');
  connectionEvent(s,row,at,'failure',label,detail);
 }
 else if(/Compressed request body/.test(body)){
  const bytes=body.match(/post_compression_bytes=(\d+)/);if(bytes)s.requestBytes=Number(bytes[1]);
  addEvent(s,at,'模型请求体已准备；传输进度未知','request');
 }else if(/Request completed.*\/responses.*status=200/.test(body))addEvent(s,at,'模型接口已返回响应头','response');
 else if(/Output item item_type="reasoning"/.test(body))modelEvent(s,body.match(/item_id="([\w.:-]+)"/)?.[1],at,'log');
}

export class SessionTail{
 constructor(file,state){this.file=file;this.state=state;this.turns=new Map();this.offset=0;this.buffer='';this.decoder=new StringDecoder('utf8');this.initialized=false;this.dropping=false;this.logRevision=0;this.pendingLogs=new Map();this.logRoutes=null;}
 logStates(){if(!this.logRoutes)this.logRoutes=[...this.turns.values(),this.state].sort((a,b)=>(a.startedAt||0)-(b.startedAt||0));return this.logRoutes;}
 acceptLog(row,queue=true){
  const at=logTimestamp(row),turn=logTurn(row),states=this.logStates();
  if(!Number.isFinite(at))return true;
  const candidates=turn?states.filter(s=>s.turnId===turn):states.filter((s,index)=>{
   const nextStart=states[index+1]?.startedAt??Infinity;
   return (!s.startedAt||at+logResolution(row)>=s.startedAt)&&(!s.endedAt||at<=s.endedAt)&&at<nextStart;
  });
  // Without an explicit turn ID, overlapping coarse timestamps are ambiguous.
   if(candidates.length===1){
    const host=interruptedHost(row),state=candidates[0];
    // SQL may be written before the matching JSONL call has been consumed.
    if(!host||state.status!=='running'||state.events.some(event=>event.callId===host.callId)){reduceLog(state,row);return true;}
   }
  if(queue){
   this.pendingLogs.set(row.id,{row,receivedAt:Date.now()});
   while(this.pendingLogs.size>2000)this.pendingLogs.delete(this.pendingLogs.keys().next().value);
  }
  return false;
 }
 flushLogs(){for(const [id,entry] of this.pendingLogs)if(this.acceptLog(entry.row,false)||Date.now()-entry.receivedAt>300000)this.pendingLogs.delete(id);}
 getTurns(since=Date.now(),initialTurn=null){
  return [...this.turns.values(),this.state].filter(turn=>turn===this.state||turn.turnId===initialTurn||turn.startedAt>=since);
 }
 accept(record){
  this.logRoutes=null;
  const p=record.payload||{};
  if(record.type==='event_msg'&&p.turn_id&&p.turn_id!==this.state.turnId&&p.type!=='task_started'&&this.turns.has(p.turn_id)){
   reduceRecord(this.turns.get(p.turn_id),record);return;
  }
  if(record.type==='event_msg'&&p.type==='task_started'&&this.state.turnId&&p.turn_id!==this.state.turnId){
   const previous=structuredClone(this.state);
   if(previous.status==='running')endTask(previous,timestamp(record.timestamp)||Date.now(),{code:'new-input',reason:'新对话插入'},false);
   this.turns.set(previous.turnId,previous);
  }
  reduceRecord(this.state,record);
 }
 consume(text){
  this.buffer+=text;let end;
  while((end=this.buffer.indexOf('\n'))>=0){const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1);if(this.dropping){this.dropping=false;continue;}try{this.accept(JSON.parse(line));}catch{} }
  if(this.buffer.length>32*1024*1024){this.buffer='';this.dropping=true;}
 }
 poll(){
  try{
   const size=fs.statSync(this.file).size;
    if(size<this.offset){const keep={id:this.state.id,title:this.state.title};Object.assign(this.state,blankState(this.state.id),keep);this.offset=0;this.buffer='';this.decoder=new StringDecoder('utf8');this.initialized=false;this.turns.clear();this.pendingLogs.clear();this.logRoutes=null;this.logRevision++;}
   if(!this.initialized){this.offset=Math.max(0,size-8*1024*1024);this.dropping=this.offset>0;this.initialized=true;}
   if(size>this.offset){const fd=fs.openSync(this.file,'r');try{let budget=12*1024*1024;while(this.offset<size&&budget>0){const b=Buffer.alloc(Math.min(1024*1024,size-this.offset,budget));const n=fs.readSync(fd,b,0,b.length,this.offset);if(!n)break;this.offset+=n;budget-=n;this.consume(this.decoder.write(b.subarray(0,n)));}}finally{fs.closeSync(fd);}}
   this.state.readError=null;
  }catch(e){this.state.readError=e.code==='EACCES'?'会话日志读取权限不足':'暂时无法读取会话日志';}
 }
}


const classificationCache=new Map();
function guardianSession(file){
 if(classificationCache.has(file))return classificationCache.get(file);
 let fd;
 try{
  fd=fs.openSync(file,'r');const chunks=[];let size=0;
  while(size<1024*1024){const b=Buffer.alloc(8192),n=fs.readSync(fd,b,0,b.length,size);if(!n)break;const end=b.subarray(0,n).indexOf(10);chunks.push(b.subarray(0,end>=0?end:n));size+=n;if(end>=0)break;}
  const record=JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''));
  if(record.type!=='session_meta')return false;
  const source=record.payload?.source;
  const internal=String(source?.subagent?.other||'').toLowerCase()==='guardian';
  classificationCache.set(file,internal);return internal;
 }catch{return false;}finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function visibleSessions(sessions,includeInternal=false){
 const normal=sessions.filter(s=>!s.isGuardianReview).slice(0,50);
 if(!includeInternal)return normal;
 // Internal entries cannot crowd normal chats out of the selector.
 return [...normal,...sessions.filter(s=>s.isGuardianReview).slice(0,50)].sort((a,b)=>b.mtime-a.mtime);
}

export function discoverSessions(home){
 const root=path.join(home,'sessions');let files=[];
 try{files=fs.readdirSync(root,{recursive:true}).filter(x=>/(?:^|[\\/])rollout-[^\\/]+\.jsonl$/.test(x));}catch{return [];}
 const names=new Map();try{for(const line of fs.readFileSync(path.join(home,'session_index.jsonl'),'utf8').split('\n')){try{const v=JSON.parse(line);if(v.id&&v.thread_name)names.set(v.id,String(v.thread_name).slice(0,100));}catch{}}}catch{}
 const recent=files.flatMap(f=>{const id=path.basename(f).match(/([\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})\.jsonl$/i)?.[1];if(!id)return [];try{const file=path.join(root,f),stat=fs.statSync(file);return [{id,file,mtime:stat.mtimeMs,title:names.get(id)||`会话 ${id.slice(0,8)}`}];}catch{return [];}}).sort((a,b)=>b.mtime-a.mtime);
 const selected=[];let normal=0,internal=0;
 // Creation dates and internal traffic cannot displace recently active chats.
 for(const entry of recent){
  const isGuardianReview=guardianSession(entry.file);
  if(isGuardianReview?internal>=500:normal>=500)continue;
  selected.push({...entry,isGuardianReview});
  if(isGuardianReview)internal++;else normal++;
  if(normal>=500&&internal>=500)break;
 }
 return selected;
}
