import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {blankState,SessionTail,discoverSessions,visibleSessions} from './monitor-core.mjs';
import {NetworkMonitor} from './network.mjs';
import {NetworkHistory} from './network-history.mjs';
import {QuotaMonitor} from './quota.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const home=path.resolve(process.env.CODEX_MONITOR_HOME||process.env.CODEX_HOME||path.join(os.homedir(),'.codex'));
const args=process.argv.slice(2),pi=args.indexOf('--port');
const port=pi>=0?Number(args[pi+1]):47831;
if(!Number.isInteger(port)||port<0||port>65535)throw new Error('Invalid port');
let sessions=[],selectedId=null,tail=null,state=null,db=null,hasLogNanos=false,lastDbId=0,dbRevision=null,lastDiscovery=0,lastCheckedAt=null,pollMs=0,discoveryError=null;
const clients=new Set();
const sessionContexts=new Map();
const network=new NetworkMonitor();
const networkHistory=new NetworkHistory();
const quota=new QuotaMonitor(home,{live:process.env.CODEX_MONITOR_QUOTA_DISABLED!=='1'&&process.env.CODEX_MONITOR_NETWORK_DISABLED!=='1'});
const historyTimer=setInterval(()=>networkHistory.capture(network.snapshot()),1000);
function discover(){const found=discoverSessions(home);if(found.length){sessions=found;discoveryError=null;}else discoveryError='未找到可读取的 Codex 会话';lastDiscovery=Date.now();}
function select(id){
 const entry=sessions.find(x=>x.id===id);if(!entry)return false;
 if(selectedId&&tail)sessionContexts.set(selectedId,{state,tail,lastDbId,dbRevision});
 selectedId=id;const saved=sessionContexts.get(id);
 if(saved){({state,tail,lastDbId,dbRevision}=saved);}else{state=blankState(id);tail=new SessionTail(entry.file,state);lastDbId=0;dbRevision=null;}
 state.title=entry.title;return true;
}
function database(){
 if(db)return;
 try{const files=fs.readdirSync(home).filter(x=>/^logs_\d+\.sqlite$/.test(x)).sort((a,b)=>Number(b.match(/\d+/)[0])-Number(a.match(/\d+/)[0]));
  if(!files.length)throw new Error('missing');db=new DatabaseSync(path.join(home,files[0]),{readOnly:true});db.exec('PRAGMA busy_timeout=50');hasLogNanos=db.prepare('PRAGMA table_info(logs)').all().some(column=>column.name==='ts_nanos');state.dbError=null;
 }catch{state.dbError='连接日志暂不可读；会话计时仍可用';}
}
function poll(){const before=performance.now();
 if(Date.now()-lastDiscovery>5000)discover();
 if(!state){const first=sessions.find(s=>!s.isGuardianReview);if(first)select(first.id);}
 quota.poll(sessions,selectedId).catch(()=>{});
 if(tail){tail.poll();const entry=sessions.find(x=>x.id===selectedId);if(entry)state.title=entry.title;
  tail.flushLogs();database();if(db){try{
   if(tail.logRevision!==dbRevision){lastDbId=0;dbRevision=tail.logRevision;}
   const starts=tail.logStates().map(turn=>turn.startedAt).filter(Number.isFinite);
   const since=Math.floor((starts.length?starts.reduce((a,b)=>Math.min(a,b)):Date.now()-6*3600000)/1000);
   const rows=db.prepare('SELECT id,ts,'+(hasLogNanos?'ts_nanos,':'')+'level,target,feedback_log_body FROM logs WHERE thread_id=? AND ts>=? AND id>? ORDER BY id LIMIT 2000').all(selectedId,since,lastDbId);
   for(const row of rows){tail.acceptLog(row);lastDbId=Math.max(lastDbId,row.id);}state.dbError=null;
  }catch{state.dbError='连接日志读取暂缓，稍后自动重试';}}
 }
 pollMs=Math.round(performance.now()-before);lastCheckedAt=Date.now();
}
discover();poll();const timer=setInterval(poll,1000);
const page=fs.readFileSync(path.join(root,'index.html'));
const appJs=fs.readFileSync(path.join(root,'app.js'));
const activityTreeJs=fs.readFileSync(path.join(root,'activity-tree.js'));
const networkChartJs=fs.readFileSync(path.join(root,'network-chart.js'));
const quotaUiJs=fs.readFileSync(path.join(root,'quota-ui.js'));
const panelOrderJs=fs.readFileSync(path.join(root,'panel-order.js'));
const themeJs=fs.readFileSync(path.join(root,'theme.js'));
const i18nJs=fs.readFileSync(path.join(root,'i18n.js'));
const css=fs.readFileSync(path.join(root,'style.css'));
let closing=false;
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
const server=http.createServer((req,res)=>{
 const address=server.address(),origin=`http://127.0.0.1:${address.port}`;
 if(req.headers.host!==`127.0.0.1:${address.port}`){json(res,403,{error:'仅允许本机地址'});return;}
 res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'");
 res.setHeader('Referrer-Policy','no-referrer');
 let url;try{url=new URL(req.url,origin);}catch{json(res,400,{error:'请求地址不正确'});return;}
 if(req.method==='GET'&&url.pathname==='/api/health'){json(res,200,{app:'codex-local-monitor',version:1});return;}
 if(req.method==='GET'&&url.pathname==='/api/network-history'){
  try{json(res,200,networkHistory.read({processId:url.searchParams.get('process')||'',rangeSeconds:url.searchParams.has('range')?Number(url.searchParams.get('range')):600,after:url.searchParams.has('after')?Number(url.searchParams.get('after')):null,epoch:url.searchParams.get('epoch')}));}
  catch{json(res,400,{error:'流量历史查询参数不正确'});}return;
 }
 if(req.method==='GET'&&url.pathname==='/api/state'){
  const includeInternal=url.searchParams.get('includeInternal')==='1';
  const choices=visibleSessions(sessions,includeInternal),latestNormal=sessions.find(s=>!s.isGuardianReview);
  const requested=url.searchParams.get('session');
  if(requested&&!sessions.some(s=>s.id===requested)){json(res,404,{error:'会话不存在'});return;}
  const desired=choices.find(s=>s.id===(requested||selectedId))||latestNormal||(includeInternal?choices[0]:null);
  if(desired){if(desired.id!==selectedId)select(desired.id);poll();}else{state=null;tail=null;selectedId=null;}
  const since=Number(url.searchParams.get('historySince'));
  const turns=tail?tail.getTurns(Number.isFinite(since)&&since>0?since:Date.now(),url.searchParams.get('initialTurn')):[];
  json(res,200,{turns,network:network.snapshot(),quota:quota.snapshot(selectedId),serverNow:Date.now(),lastCheckedAt,pollMs,source:'本机会话 JSONL + 只读 SQLite',discoveryError,
   latestSessionId:latestNormal?.id||null,internalSessionCount:sessions.filter(s=>s.isGuardianReview).length,
   sessions:choices.map(({id,title,mtime,isGuardianReview})=>({id,title,mtime,isGuardianReview})),state});return;
 }
 if(req.method==='POST'&&url.pathname==='/api/quota/refresh'){
  if(req.headers.origin!==origin||req.headers['x-monitor-action']!=='refresh-quota'){json(res,403,{error:'请求来源不允许'});return;}
  if(Date.now()-quota.lastAttempt<5000&&!quota.refreshing){json(res,429,{ok:false});return;}
  quota.refresh().catch(()=>{});json(res,202,{ok:true});return;
 }
 if(req.method==='POST'&&url.pathname==='/api/shutdown'){
  if(req.headers.origin!==origin||req.headers['x-monitor-action']!=='shutdown'){json(res,403,{error:'请求来源不允许'});return;}
  json(res,200,{ok:true});setTimeout(shutdown,100);return;
 }
 const asset=req.method==='GET'?({'/':[page,'text/html; charset=utf-8'],'/app.js':[appJs,'text/javascript; charset=utf-8'],'/activity-tree.js':[activityTreeJs,'text/javascript; charset=utf-8'],'/network-chart.js':[networkChartJs,'text/javascript; charset=utf-8'],'/quota-ui.js':[quotaUiJs,'text/javascript; charset=utf-8'],'/panel-order.js':[panelOrderJs,'text/javascript; charset=utf-8'],'/theme.js':[themeJs,'text/javascript; charset=utf-8'],'/i18n.js':[i18nJs,'text/javascript; charset=utf-8'],'/style.css':[css,'text/css; charset=utf-8']})[url.pathname]:null;
 if(asset){res.writeHead(200,{'Content-Type':asset[1],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(asset[0]);return;}
 res.writeHead(404);res.end();
});
server.on('connection',socket=>{clients.add(socket);socket.on('close',()=>clients.delete(socket));});
function openWindow(url){
 if(process.platform==='win32'){
  const edge=[process.env['PROGRAMFILES(X86)'],process.env.PROGRAMFILES].filter(Boolean).map(x=>path.join(x,'Microsoft','Edge','Application','msedge.exe')).find(x=>fs.existsSync(x));
  const child=edge?spawn(edge,[`--app=${url}`,'--window-size=530,930'],{detached:true,stdio:'ignore',windowsHide:false}):spawn('powershell.exe',['-NoProfile','-Command',`Start-Process '${url}'`],{detached:true,stdio:'ignore',windowsHide:true});child.unref();
 }else console.log(`Open ${url}`);
}
function shutdown(){if(closing)return;closing=true;clearInterval(timer);clearInterval(historyTimer);network.stop();quota.stop();try{db?.close();}catch{}for(const socket of clients)socket.destroy();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),800).unref();}
server.on('error',async error=>{
 clearInterval(timer);clearInterval(historyTimer);network.stop();quota.stop();try{db?.close();}catch{}
 if(error.code==='EADDRINUSE'){
  try{const r=await fetch(`http://127.0.0.1:${port}/api/health`,{signal:AbortSignal.timeout(1500)});const info=await r.json();if(info.app==='codex-local-monitor'){if(args.includes('--open'))openWindow(`http://127.0.0.1:${port}/`);console.log('监控已运行，已复用窗口入口。');process.exit(0);}}catch{}
  console.error(`本机端口 ${port} 已被其他程序占用；可用 --port 指定其他端口。`);
 }else console.error(`监控启动失败：${error.code||error.message}`);process.exit(1);
});
server.listen(port,'127.0.0.1',()=>{network.start();networkHistory.capture(network.snapshot());const url=`http://127.0.0.1:${server.address().port}/`;console.log(JSON.stringify({app:'codex-local-monitor',url,pid:process.pid,readOnly:true}));if(args.includes('--open'))openWindow(url);});
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
