// Documentation fixture only. Never reads Codex records or contacts remote services.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {blankState} from '../monitor-core.mjs';
const root=path.resolve(import.meta.dirname,'..');
export async function startDemo(){
 const started=Date.now()-195000;let returned=false,returnedAt=null,checks=0,language='zh-CN',updateError=false;
 const words=(zh,en)=>language==='en'?en:zh;
 function snapshot(){
  const now=Date.now(),s={...blankState('demo-session'),title:words('演示：排查连接并验证修改','Demo: investigate a connection and verify changes'),model:'gpt-6.1-sol',effort:'high',turnId:'demo-turn',taskTitle:'任务：'+words('检查连接记录，修复问题并运行验证','Inspect connection records, fix the issue and run verification'),status:'running',startedAt:started,firstReplyAt:started+4000,lastActivityAt:now-2000,lastAction:words('正在运行验证','Running verification'),retries:2,failures:1,fallbacks:1,requestBytes:124000,pending:returned?[]:[{id:'verify',label:words('本地命令','Local command'),startedAt:started+160000}],plan:[{step:words('检查连接记录','Inspect connection records'),status:'completed'},{step:words('修复并验证','Apply and verify the fix'),status:'inProgress'},{step:words('整理检查结果','Summarize findings'),status:'pending'}]};
  const op=(id,label,start,duration,status='returned',parent)=>({key:'call:'+id,callId:id,parentCallId:parent,at:started+start,startedAt:started+start,endedAt:duration===null?null:started+start+duration,toolLabel:label,label,operation:true,status,durationMs:duration,kind:status==='failed'?'warning':'tool'});
  s.events=[{key:'start',at:started,kind:'start',label:'任务开始'},op('read',words('检索或读取文件','Search or read files'),6000,543),
   {key:'retry1',at:started+12000,label:'连接重试',kind:'warning',connectionType:'retry',detail:'等待 500 毫秒后重试'},
   {key:'retry2',at:started+14000,label:'连接重试',kind:'warning',connectionType:'retry',detail:'等待 1 秒后重试'},
   {key:'failure',at:started+16000,label:'日志记录请求超时',kind:'warning',connectionType:'failure',detail:'请求超时'},
   {key:'fallback',at:started+18000,label:'传输回退至 HTTP',kind:'warning',connectionType:'fallback',detail:'WebSocket → HTTPS'},
   op('edit',words('修改文件','File change'),30000,1400),op('failed',words('本地命令','Local command'),40000,3100,'failed'),
   {...op('batch',words('组合调用','Combined call'),155000,returned?returnedAt-started-155000:null,returned?'returned':'running'),codeMode:true},
   op('verify',words('本地命令','Local command'),160000,returned?returnedAt-started-160000:null,returned?'returned':'running','batch'),
   op('read2',words('检索或读取文件','Search or read files'),157000,760,'returned','batch')];
  s.lastTool={label:words('修改文件','File change'),durationMs:1400,status:'completed'};
  const window=(remaining,hours)=>({available:true,remainingPercent:remaining,updatedAt:now,resetAt:now+hours*3600000,source:'official'});
  const round=(id,title,percent,status)=>({id,title,startAt:started-(id==='current'?0:300000),status,fiveHour:{percent},weekly:{percent:id==='current'?0:1},overlap:false});
  return {serverNow:now,lastCheckedAt:now,pollMs:4,source:'本机会话 JSONL + 只读 SQLite',discoveryError:null,latestSessionId:s.id,internalSessionCount:3,sessions:[{id:s.id,title:s.title,mtime:now}],state:s,turns:[],
   quota:{windows:{fiveHour:window(76,2.4),weekly:window(9,59)},rounds:[round('current',words('检查连接并运行验证','Inspect connection and run verification'),1,'running'),round('previous',words('检查并整理活动记录','Review and organize activity records'),3,'completed')],refreshAvailable:true},
   network:{scope:'codex-proxy',status:'ready',sampledAt:now,receivedPerSecond:28560,sentPerSecond:3210,totalReceived:6357400,totalSent:762300,processes:[{id:'4242:demo',pid:4242,running:true,status:'ready',receivedPerSecond:28560,sentPerSecond:3210,totalReceived:6357400,totalSent:762300}]}};
 }
 const server=http.createServer((req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');const json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  if(u.pathname==='/demo/config'){language=u.searchParams.get('lang')==='en'?'en':'zh-CN';returned=u.searchParams.get('returned')==='1';returnedAt=returned?Date.now():null;updateError=u.searchParams.get('updateError')==='1';return json({checks});}
  if(u.pathname==='/api/state')return json(snapshot());
  if(u.pathname==='/api/version')return json({version:fs.readFileSync(path.join(root,'VERSION'),'utf8').trim()});
  if(u.pathname==='/api/update/check'){checks++;return json(updateError?{ok:false,error:'timeout'}:{ok:true,current:fs.readFileSync(path.join(root,'VERSION'),'utf8').trim(),latest:'v0.1.7',comparison:1,publishedAt:'2026-11-10T00:00:00Z',url:'https://github.com/ClencyX/codex-runtime-monitor/releases/latest'});}
  if(u.pathname==='/api/network-history'){
   const now=Date.now(),range=Number(u.searchParams.get('range'))||600;const points=Array.from({length:601},(_,i)=>({seq:i,at:now-600000+i*1000,receivedPerSecond:i>=310&&i<=330?null:12000+16000*Math.abs(Math.sin(i*.018))+6000*Math.abs(Math.sin(i*.13)),sentPerSecond:i>=310&&i<=330?null:1800+4000*Math.abs(Math.cos(i*.026)),partial:false}));
   return json({scope:'codex-proxy',status:'ready',epoch:'demo',reset:true,seq:600,serverNow:now,rangeSeconds:range,processId:u.searchParams.get('process')||'',points});
  }
  const name=u.pathname==='/'?'index.html':u.pathname.slice(1);
  if(!/^[\w.-]+\.(?:html|css|js)$/.test(name)){res.statusCode=404;return res.end();}
  try{res.setHeader('Content-Type',name.endsWith('.css')?'text/css':name.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(root,name)));}catch{res.statusCode=404;res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {server,url:'http://127.0.0.1:'+server.address().port,get checks(){return checks;}};
}
