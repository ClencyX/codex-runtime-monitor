const I18n=globalThis.CodexMonitorI18n,t=I18n.translate;
const $=id=>document.getElementById(id);
let current=null,selected='',online=false,stopped=false,offset=0,busy=false,lastEvents='',lastOptions='',generation=0;
const stateRequestTimeoutMs=4500,stateStaleMs=6500;
let stateController=null,lastStateReceivedAt=null;
let windowStorage;try{windowStorage=sessionStorage;}catch{windowStorage={getItem:()=>null,setItem:()=>{}};}
const windowHistory=new CodexMonitorActivity.WindowHistory(windowStorage);
let activityTurns=[];

const panelIds=['task-panel','tools-panel','network-panel','plan-panel','activity-panel'],collapsedPanels=new Set(),panelScrollPositions=new Map();
try{const saved=JSON.parse(windowStorage.getItem('codex-monitor-panel-collapse')||'[]');if(Array.isArray(saved))for(const id of saved)if(panelIds.includes(id))collapsedPanels.add(id);}catch{}
function isPanelCollapsed(id){return collapsedPanels.has(id);}
function setPanelExpanded(panel,expanded,persist=false){
 const button=panel.querySelector('.panel-toggle'),body=$(button.getAttribute('aria-controls'));
 if(!expanded&&!body.hidden)panelScrollPositions.set(panel.id,Array.from(body.querySelectorAll('#events,#connection-records,.events-table-scroll')).map(element=>({element,top:element.scrollTop,left:element.scrollLeft})));
 if(expanded)collapsedPanels.delete(panel.id);else collapsedPanels.add(panel.id);
 panel.classList.toggle('is-collapsed',!expanded);body.hidden=!expanded;button.setAttribute('aria-expanded',String(expanded));
 button.querySelector('.panel-chevron').textContent=expanded?'▾':'▸';
 button.title=t((expanded?'收起':'展开')+button.textContent.replace(/[▾▸]/g,'').trim());
 if(expanded)for(const {element,top,left} of panelScrollPositions.get(panel.id)||[]){element.scrollTop=top;element.scrollLeft=left;}
 if(!expanded&&panel.id==='network-panel')trafficChart.hideTooltip();
 if(persist)try{windowStorage.setItem('codex-monitor-panel-collapse',JSON.stringify([...collapsedPanels]));}catch{}
}
function initializePanelCollapse(){
 for(const id of panelIds){
  const panel=$(id),button=panel.querySelector('.panel-toggle');setPanelExpanded(panel,!isPanelCollapsed(id));
  button.addEventListener('click',()=>{setPanelExpanded(panel,isPanelCollapsed(id),true);render();if(id==='network-panel'&&!isPanelCollapsed(id))trafficChart.draw();});
 }
}
function updatePanelSummaries(s){
 text('task-panel-summary',$('status').textContent+' · '+$('elapsed').textContent);$('task-panel-summary').dataset.status=online?s?.status||'unknown':'offline';
 text('tools-panel-summary',s?`重试 ${s.retries} · 失败 ${s.failures} · 回退 ${s.fallbacks}`:'正在读取…');
 text('network-panel-summary','↓ '+$('network-download').textContent+($('network-download-unit').textContent?' '+$('network-download-unit').textContent:'')+' · ↑ '+$('network-upload').textContent+($('network-upload-unit').textContent?' '+$('network-upload-unit').textContent:''));
 text('plan-panel-summary',s?.plan.length?`已完成 ${s.plan.filter(step=>step.status==='completed').length} / ${s.plan.length}`:'暂无任务步骤');
 text('activity-panel-summary',$('events-count').textContent);
}

let connectionFilter=null,connectionOrder='desc',connectionScope='',lastConnectionRecords='';
const connectionNames={retry:'重试记录',failure:'失败记录',fallback:'传输回退'},connectionNodes=new Map();
try{if(localStorage.getItem('codex-monitor-connection-order')==='asc')connectionOrder='asc';}catch{}
for(const button of document.querySelectorAll('[data-connection-kind]'))button.addEventListener('click',()=>{
 connectionFilter=connectionFilter===button.dataset.connectionKind?null:button.dataset.connectionKind;
 if(current?.state)renderConnectionDetails(current.state);
});
$('connection-close').addEventListener('click',()=>{connectionFilter=null;if(current?.state)renderConnectionDetails(current.state);});
$('connection-order').addEventListener('click',()=>{
 connectionOrder=connectionOrder==='asc'?'desc':'asc';try{localStorage.setItem('codex-monitor-connection-order',connectionOrder);}catch{}
 connectionScope='';if(current?.state)renderConnectionDetails(current.state);
});
function connectionCategory(event){
 if(connectionNames[event.connectionType])return event.connectionType;
 if(/^连接重试(?:（|$)/.test(event.label))return 'retry';
 if(/^日志记录请求(?:超时|失败)$/.test(event.label))return 'failure';
 if(event.label==='传输回退至 HTTP')return 'fallback';return null;
}
function renderConnectionDetails(s){
 for(const button of document.querySelectorAll('[data-connection-kind]')){
  const kind=button.dataset.connectionKind,expanded=connectionFilter===kind;
  button.setAttribute('aria-expanded',String(expanded));button.title=t((expanded?'收起':'展开')+'本轮'+connectionNames[kind]);
 }
 const panel=$('connection-details'),list=$('connection-records');panel.hidden=!connectionFilter;if(!connectionFilter){connectionScope='';return;}
 const scope=s.id+':'+(s.turnId||s.startedAt||'unknown')+':'+connectionFilter,changed=scope!==connectionScope;
 if(changed){connectionScope=scope;connectionNodes.clear();list.replaceChildren();lastConnectionRecords='';}
 const entries=s.events.filter(event=>connectionCategory(event)===connectionFilter).sort((a,b)=>(connectionOrder==='asc'?1:-1)*(a.at-b.at||a.key.localeCompare(b.key)));
 text('connection-title','本轮'+connectionNames[connectionFilter]);text('connection-count',entries.length+' 条');
 text('connection-order',connectionOrder==='asc'?'时间升序 ↑':'时间降序 ↓');
 $('connection-order').title=t(connectionOrder==='asc'?'从早到晚排列，点击切换为降序':'从晚到早排列，点击切换为升序');
 list.setAttribute('aria-label',t('本轮'+connectionNames[connectionFilter]+'，按时间'+(connectionOrder==='asc'?'从早到晚':'从晚到早')));
 if(isPanelCollapsed('tools-panel'))return;
 const signature=connectionOrder+':'+JSON.stringify(entries);if(signature===lastConnectionRecords)return;lastConnectionRecords=signature;
 const oldScroll=list.scrollTop,top=list.getBoundingClientRect().top;
 const follow=changed||(connectionOrder==='desc'?oldScroll:list.scrollHeight-list.clientHeight-oldScroll)<24;
 const anchor=follow?null:Array.from(list.children).find(row=>row.getBoundingClientRect().bottom>top+1),anchorOffset=anchor?anchor.getBoundingClientRect().top-top:0;
 const keys=new Set(entries.map(event=>event.key));
 for(const [key,node] of connectionNodes)if(!keys.has(key)){node.remove();connectionNodes.delete(key);}
 for(const row of Array.from(list.children))if(row.dataset.empty)row.remove();
 for(let i=0;i<entries.length;i++){
  const event=entries[i];let row=connectionNodes.get(event.key);
  if(!row){row=document.createElement('li');row.dataset.eventKey=event.key;const time=document.createElement('time'),body=document.createElement('span');body.className='connection-content';row.append(time,body);connectionNodes.set(event.key,row);}
  row.children[0].dateTime=new Date(event.at).toISOString();row.children[0].textContent=t(new Date(event.at).toLocaleTimeString(I18n.locale(),{hour12:false}));
  row.children[1].textContent=t(event.detail||event.label);
  if(list.children[i]!==row)list.insertBefore(row,list.children[i]||null);
 }
 if(!entries.length){const row=document.createElement('li');row.dataset.empty='true';row.textContent=t('本轮暂无'+connectionNames[connectionFilter]);list.append(row);}
 if(follow)list.scrollTop=connectionOrder==='desc'?0:list.scrollHeight;
 else if(anchor?.isConnected)list.scrollTop=oldScroll+anchor.getBoundingClientRect().top-list.getBoundingClientRect().top-anchorOffset;
 else list.scrollTop=oldScroll;
}

let eventScope='',followActivity=true,activityOrder='desc',eventTree=null,renderedRows=[],expandedEvents=new Map();
try{if(localStorage.getItem('codex-monitor-activity-order')==='asc')activityOrder='asc';}catch{}
const eventNodes=new Map(),expansionScopes=new Map();
try{
 const saved=JSON.parse(localStorage.getItem('codex-monitor-event-expansion')||'[]');
 if(Array.isArray(saved))for(const entry of saved.slice(-20))if(typeof entry.scope==='string'&&Array.isArray(entry.choices))expansionScopes.set(entry.scope,new Map(entry.choices.slice(0,500).filter(pair=>Array.isArray(pair)&&typeof pair[0]==='string'&&typeof pair[1]==='boolean')));
}catch{}
function selectExpansion(scope){
 const choices=expansionScopes.get(scope)||new Map();expansionScopes.delete(scope);expansionScopes.set(scope,choices);
 while(expansionScopes.size>20)expansionScopes.delete(expansionScopes.keys().next().value);return choices;
}
function saveExpansion(){try{localStorage.setItem('codex-monitor-event-expansion',JSON.stringify([...expansionScopes].map(([scope,choices])=>({scope,choices:[...choices].slice(-500)}))));}catch{}}
function hasRunningGroup(s=current?.state){return Boolean(s&&(s.events.some(event=>event.status==='running')||(s.status==='running'&&s.turnId&&s.events.some(event=>event.kind==='start'))));}
function activityAtTop(s=current?.state){return activityOrder==='desc'||hasRunningGroup(s);}
function updateActivityFollow(){if(isPanelCollapsed('activity-panel'))return;const list=$('events');followActivity=(activityAtTop()?list.scrollTop:list.scrollHeight-list.clientHeight-list.scrollTop)<24;$('events-latest').hidden=followActivity;}
function scrollToLatest(s=current?.state){followActivity=true;const list=$('events');list.scrollTop=activityAtTop(s)?0:list.scrollHeight;$('events-latest').hidden=true;}
function updateActivityOrderControls(s=current?.state){
 const ascending=activityOrder==='asc',running=hasRunningGroup(s),button=$('events-order');
 button.textContent=t(ascending?'时间升序 ↑':'时间降序 ↓');
 button.title=t('运行组按开始顺序置顶；'+(ascending?'其余记录从早到晚，点击切换为降序':'其余记录从晚到早，点击切换为升序'));button.setAttribute('aria-label',t(button.title));
 $('events').setAttribute('aria-label',t('按已知父子关系折叠，运行组按开始顺序置顶，其余记录'+(ascending?'从早到晚':'从晚到早')));
 text('events-hint',running?'点击箭头展开子操作 · 运行组置顶':'点击箭头展开或折叠子操作');
 text('events-latest',running?'回到运行中 ↑':ascending?'回到最新 ↓':'回到最新 ↑');
}
$('events').addEventListener('scroll',updateActivityFollow,{passive:true});
$('events').addEventListener('click',event=>{
 const button=event.target.closest('.event-toggle');if(!button||!$('events').contains(button))return;
 const row=renderedRows.find(entry=>entry.node.event.key===button.dataset.key);if(!row)return;
 expandedEvents.set(button.dataset.key,!row.expanded);saveExpansion();followActivity=false;lastEvents='';if(current?.state)renderEvents(current.state);
});
$('events-latest').addEventListener('click',()=>scrollToLatest());
$('events-order').addEventListener('click',()=>{
 activityOrder=activityOrder==='asc'?'desc':'asc';try{localStorage.setItem('codex-monitor-activity-order',activityOrder);}catch{}
 updateActivityOrderControls();if(current?.state)renderEvents(current.state);
});
updateActivityOrderControls();
function updateEventRow(li,row,now){
 const node=row.node,event=node.event,running=event.status==='running',known=Number.isFinite(event.durationMs);
 li.className=[event.kind==='warning'?'warning':'',running?'running':'',node.groupRunning?'group-running':''].filter(Boolean).join(' ');
 li.dataset.eventKey=event.key;li.dataset.depth=String(row.depth);li.dataset.parentKey=node.parent?.event.key||'';
 const [time,elapsed,stateCell,modelCell,label]=li.children;
 modelCell.textContent=[node.model,node.effort].filter(Boolean).join(' · ')||'—';modelCell.title=modelCell.textContent;
 const began=event.operation?event.startedAt:event.at;
 time.dateTime=Number.isFinite(began)?new Date(began).toISOString():'';time.textContent=t(Number.isFinite(began)?new Date(began).toLocaleTimeString(I18n.locale(),{hour12:false}):'时间未知');
 const live=running&&online&&Number.isFinite(event.startedAt);
 elapsed.textContent=t(live?CodexMonitorActivity.liveDuration(event.startedAt,now):known?short(event.durationMs):event.operation?'耗时未知':'—');
 elapsed.title=elapsed.textContent;
 elapsed.setAttribute('aria-label',t(live?'运行中，已用 '+elapsed.textContent:known?'耗时 '+elapsed.textContent:event.operation?'耗时未知':'未记录耗时'));
 label.style.setProperty('--event-depth',String(Math.min(row.depth,4)));
 const [control,body,summary]=label.children,[toggle,branch]=control.children;
 const hasChildren=node.children.length>0;
 toggle.hidden=!hasChildren;branch.hidden=hasChildren;
 toggle.dataset.key=event.key;toggle.textContent=t(row.expanded?'▾':'▸');toggle.setAttribute('aria-expanded',String(row.expanded));
 toggle.setAttribute('aria-label',t((row.expanded?'折叠':'展开')+(event.toolLabel||event.label)+'的子操作'));
 toggle.title=t((row.expanded?'折叠':'展开')+'子操作');branch.textContent=t(CodexMonitorActivity.branchFor(row));
 const operation=body.firstElementChild,[status,emptyStatus]=stateCell.children;
 operation.classList.toggle('is-live',live);
 operation.textContent=t(event.toolLabel||event.label);
 operation.title=operation.textContent+(event.sources?'\n'+t('模型处理条目的日志通知；同一 ID 的多来源记录已合并，不代表任务进度百分比。'):'');
 status.hidden=!event.operation;
 emptyStatus.hidden=Boolean(event.operation);
 status.textContent=t(running&&!online?'状态待确认':event.groupRoot?taskStatusText(event.taskStatus,event.terminationReason):({running:'运行中',returned:'已返回',failed:'失败',unknown:'结束未确认'}[event.status]||'状态未知'));
 if(event.groupRoot&&event.taskStatus==='terminated'){
  const name=document.createElement('span'),reason=document.createElement('span');name.textContent=t('任务终止');reason.textContent=t('（'+(event.terminationReason||'原因未知')+'）');status.replaceChildren(name,reason);
 }
 status.dataset.status=running&&!online?'unknown':event.status;
 stateCell.setAttribute('aria-label',t(event.operation?'状态：'+status.textContent:'事件通知，无操作状态'));
 summary.hidden=!hasChildren;
 summary.textContent=t((event.groupRoot?node.descendantRecords+' 条记录 · '+node.childCount+' 条工具记录':node.childCount?node.childCount+' 项子操作':node.descendantRecords+' 条记录')+(node.runningChildren?' · '+node.runningChildren+(online?' 项运行中':' 项状态待确认'):''));
}
function tickActivityClocks(){
 if(!online)return;const now=Date.now()+offset;
 for(const row of renderedRows){const event=row.node.event;if(event.status!=='running'||!Number.isFinite(event.startedAt))continue;
  const elapsed=eventNodes.get(event.key)?.children[1];if(!elapsed)continue;
  elapsed.textContent=t(CodexMonitorActivity.liveDuration(event.startedAt,now));
  elapsed.title=elapsed.textContent;
  elapsed.setAttribute('aria-label',t('运行中，已用 '+elapsed.textContent));
 }
}
function renderEvents(s){
 const list=$('events'),scope=s.id;
 if(scope!==eventScope){eventScope=scope;eventNodes.clear();list.replaceChildren();expandedEvents=selectExpansion(scope);eventTree=null;renderedRows=[];followActivity=true;lastEvents='';}
 activityTurns=windowHistory.remember(s,current?.turns||[]);
 if(isPanelCollapsed('activity-panel')){
  const tree=CodexMonitorActivity.buildTimeline(activityTurns,activityOrder);text('events-count',tree.eventCount+' 条'+(tree.runningCount?' · 运行中 '+tree.runningCount:''));return;
 }
 const eventKey=activityOrder+':'+JSON.stringify([activityTurns,[...expandedEvents]]),now=Date.now()+offset;
 updateActivityOrderControls(s);
 if(eventKey===lastEvents){for(const row of renderedRows)if(row.node.groupRunning)updateEventRow(eventNodes.get(row.node.event.key),row,now);return;}lastEvents=eventKey;
 const viewportTop=list.getBoundingClientRect().top;
 const anchor=followActivity?null:Array.from(list.children).find(el=>el.getBoundingClientRect().bottom>viewportTop+1);
 const anchorOffset=anchor?anchor.getBoundingClientRect().top-viewportTop:0;
 const oldScroll=list.scrollTop,stickToLatest=followActivity;
 eventTree=CodexMonitorActivity.buildTimeline(activityTurns,activityOrder);renderedRows=CodexMonitorActivity.visibleRows(eventTree,expandedEvents);
 text('events-count',eventTree.eventCount+' 条'+(eventTree.runningCount?' · 运行中 '+eventTree.runningCount:''));
 const keys=new Set(eventTree.nodes.keys()),visible=new Set(renderedRows.map(row=>row.node.event.key));
 for(const [key,node] of eventNodes){if(!keys.has(key)){node.remove();eventNodes.delete(key);}}
 for(const child of Array.from(list.children))if(!visible.has(child.dataset.eventKey))child.remove();
 for(let i=0;i<renderedRows.length;i++){
  const row=renderedRows[i],key=row.node.event.key;let li=eventNodes.get(key);
  if(!li){
   li=document.createElement('li');
   const time=document.createElement('time'),elapsed=document.createElement('span'),stateCell=document.createElement('span'),modelCell=document.createElement('span'),label=document.createElement('span');
   elapsed.className='event-duration';stateCell.className='event-state';modelCell.className='event-model';label.className='event-label';
   const control=document.createElement('span'),toggle=document.createElement('button'),branch=document.createElement('span'),body=document.createElement('span'),summary=document.createElement('small');
   control.className='event-control';toggle.className='event-toggle';toggle.type='button';branch.className='event-branch';branch.setAttribute('aria-hidden','true');body.className='event-text';summary.className='event-summary';
   const operation=document.createElement('span'),status=document.createElement('small'),emptyStatus=document.createElement('span');operation.className='event-operation';status.className='event-status';emptyStatus.className='event-status-empty';emptyStatus.textContent=t('—');body.append(operation);stateCell.append(status,emptyStatus);
   control.append(toggle,branch);label.append(control,body,summary);li.append(time,elapsed,stateCell,modelCell,label);eventNodes.set(key,li);
  }
  updateEventRow(li,row,now);if(list.children[i]!==li)list.insertBefore(li,list.children[i]||null);
 }
 if(!renderedRows.length){const li=document.createElement('li');li.dataset.empty='true';li.textContent=t('暂无可识别事件');list.append(li);}
 if(stickToLatest)scrollToLatest(s);
 else if(anchor?.isConnected)list.scrollTop=oldScroll+anchor.getBoundingClientRect().top-list.getBoundingClientRect().top-anchorOffset;
 else if(anchor){
  let node=eventTree.nodes.get(anchor.dataset.eventKey);while(node&&!visible.has(node.event.key))node=node.parent;
  const fallback=node&&eventNodes.get(node.event.key);list.scrollTop=fallback?oldScroll+fallback.getBoundingClientRect().top-list.getBoundingClientRect().top:oldScroll;
 }else list.scrollTop=oldScroll;
 updateActivityFollow();
}


let selectedNetwork='',lastNetworkOptions='';
try{selectedNetwork=localStorage.getItem('codex-monitor-network-process')||'';}catch{}
let networkRange=600,chartGeneration=0,chartController=null;
try{const saved=Number(localStorage.getItem('codex-monitor-network-range'));if([60,300,600,1800].includes(saved))networkRange=saved;}catch{}
const trafficChart=new CodexMonitorNetworkChart.TrafficChart($('network-chart'),$('network-chart-note'));
$('network-range').value=String(networkRange);trafficChart.setContext('',networkRange,'全部 Codex 进程');
function syncChartContext(processId,label){
 if(!trafficChart.setContext(processId,networkRange,label))return;
 chartGeneration++;chartController?.abort();chartController=null;pollNetworkHistory();
}
$('network-range').addEventListener('change',()=>{networkRange=Number($('network-range').value);try{localStorage.setItem('codex-monitor-network-range',String(networkRange));}catch{}syncChartContext(trafficChart.processId,trafficChart.scopeLabel);});
async function pollNetworkHistory(){
 if(stopped||chartController)return;
 const generation=chartGeneration,controller=new AbortController();chartController=controller;
 const timeout=setTimeout(()=>controller.abort(),4500),params=new URLSearchParams({range:String(trafficChart.rangeSeconds)});
 if(trafficChart.processId)params.set('process',trafficChart.processId);
 if(trafficChart.buffer.epoch!==null&&trafficChart.buffer.seq!==null){params.set('epoch',trafficChart.buffer.epoch);params.set('after',String(trafficChart.buffer.seq));}
 try{
  const response=await fetch('/api/network-history?'+params,{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error();const data=await response.json();
  if(generation!==chartGeneration)return;
  if(data.scope!=='codex-proxy'||data.processId!==trafficChart.processId||data.rangeSeconds!==trafficChart.rangeSeconds)throw Error();
  trafficChart.update(data);
 }catch{if(generation===chartGeneration)trafficChart.offline();}
 finally{clearTimeout(timeout);if(chartController===controller)chartController=null;}
}
$('network-process').addEventListener('change',()=>{selectedNetwork=$('network-process').value;try{localStorage.setItem('codex-monitor-network-process',selectedNetwork);}catch{}renderNetwork(current?.network);});
function networkAmount(value){
 if(value===null||!Number.isFinite(value)||value<0)return {value:'—',unit:''};
 const units=['B','KiB','MiB','GiB','TiB'];let power=0;
 while(value>=1024&&power<units.length-1){value/=1024;power++;}
 return {value:value.toFixed(power===0?0:value>=100?1:2),unit:units[power]};
}
function renderNetwork(n){
 const rows=n?.scope==='codex-proxy'?n.processes:[],optionsKey=JSON.stringify((rows||[]).map(row=>[row.id,row.pid,row.running]));
 if(optionsKey!==lastNetworkOptions){
  const all=document.createElement('option');all.value='';all.textContent=t('全部 Codex 进程');
  $('network-process').replaceChildren(all,...(rows||[]).map(row=>{const option=document.createElement('option');option.value=row.id;option.textContent=t('codex.exe · PID '+row.pid+(row.running?'':'（已退出）'));return option;}));
  lastNetworkOptions=optionsKey;
 }
 const process=(rows||[]).find(row=>row.id===selectedNetwork),value=process||n;
 $('network-process').value=process?selectedNetwork:'';
 syncChartContext(process?.id||'',process?'codex.exe · PID '+process.pid:'全部 Codex 进程');
 const unavailable=!online||n?.scope!=='codex-proxy'||['error','starting','disabled','unmapped'].includes(n.status)||process?.status==='unmapped'||(n.sampledAt!==null&&Date.now()+offset-n.sampledAt>4500);
 for(const [id,number] of [['network-download',value?.receivedPerSecond],['network-upload',value?.sentPerSecond]]){
  const amount=networkAmount(unavailable?null:number);text(id,amount.value);text(id+'-unit',amount.unit?amount.unit+'/s':'');
 }
 for(const [id,number] of [['network-down-total',value?.totalReceived],['network-up-total',value?.totalSent]]){const amount=networkAmount(n?.scope==='codex-proxy'?number??null:null);text(id,'已观测累计 '+amount.value+(amount.unit?' '+amount.unit:''));}
 let status='已匹配 Codex 代理连接',state='ready';
 if(!online){status='监控离线，流量数据未更新';state='error';}
 else if(!n||n.status==='starting'){status='正在识别 Codex 连接';state='starting';}
 else if(n.scope!=='codex-proxy'){status='请重启监控以加载 Codex 进程采样';state='error';}
 else if(n.status==='disabled'){status='Codex 进程采样暂不可用';state='error';}
 else if(n.status==='unmapped'){status='Codex 连接未匹配到代理统计';state='error';}
 else if(process?.status==='unmapped'){status='所选 Codex 进程的连接未匹配，速率未知';state='error';}
 else if(unavailable){status=n.error||'Codex 流量采样已中断，正在重试';state='error';}
 else if((process?.status||n.status)==='partial'){status='部分 Codex 连接未覆盖，仅计已匹配连接';state='error';}
 else if(process&&!process.running){status='所选 Codex 进程已退出';state='starting';}
 else if(n.status==='no-process'){status='未发现 codex.exe 进程';state='starting';}
 else if(n.status==='idle'){status='Codex 暂无已匹配的活动连接';state='starting';}
 else if((process||n).receivedPerSecond===null){status='正在建立 Codex 流量基线';state='starting';}
 text('network-status',status);$('network-status').dataset.state=state;
 text('network-sampled',n?.sampledAt?'更新 '+new Date(n.sampledAt).toLocaleTimeString(I18n.locale(),{hour12:false}):'');
}


const terminal={completed:'已完成',cancelled:'已取消',failed:'失败',unknown:'状态未知',unconfirmed:'状态待确认',running:'运行中'};
function taskStatusText(status,reason){return status==='terminated'?'任务终止（'+(reason||'原因未知')+'）':terminal[status]||'状态未知';}
function duration(ms){if(ms===null||!Number.isFinite(ms))return '—';const s=Math.max(0,Math.floor(ms/1000));return s>=3600?`${Math.floor(s/3600)}:${String(Math.floor(s%3600/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`:`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
function short(ms){return CodexMonitorActivity.formatDuration(ms);}
function text(id,value){const node=$(id);node.dataset.i18nSource=String(value??'');node.textContent=t(value);}
function safeOption(title,id,internal=false){const option=document.createElement('option');option.value=id;option.textContent=internal?`${t('内部审查')} · ${title} (${id.slice(0,8)})`:title;return option;}
function stateUrl(id=selected){const params=new URLSearchParams();if(id)params.set('session',id);params.set('historySince',String(windowHistory.since));if(windowHistory.initial[id])params.set('initialTurn',windowHistory.initial[id]);if($('show-internal').checked)params.set('includeInternal','1');return '/api/state?'+params.toString();}
try{$('show-internal').checked=localStorage.getItem('codex-monitor-show-internal')==='true';}catch{}
$('show-internal').addEventListener('change',()=>{try{localStorage.setItem('codex-monitor-show-internal',String($('show-internal').checked));}catch{}generation++;stateController?.abort();lastOptions='';poll();});
try{$('threshold').value=localStorage.getItem('codex-monitor-threshold')||'60';}catch{}
$('threshold').addEventListener('change',()=>{try{localStorage.setItem('codex-monitor-threshold',$('threshold').value);}catch{}render();});
$('sessions').addEventListener('change',()=>{selected=$('sessions').value;$('follow').checked=false;current=null;lastEvents='';generation++;stateController?.abort();poll();});
$('follow').addEventListener('change',()=>{generation++;stateController?.abort();poll();});
$('stop').addEventListener('click',async()=>{if(!confirm(t('退出监控服务？这不会停止 Codex。')))return;try{const r=await fetch('/api/shutdown',{method:'POST',headers:{'X-Monitor-Action':'shutdown'}});if(!r.ok)throw Error();stopped=true;online=false;showOffline('监控已退出。Codex 不受影响；双击“启动监控.cmd”可重新打开。');text('health','监控已停止');$('stop').disabled=true;}catch{showOffline('未能退出监控，请稍后重试。');}});
function showOffline(message){$('offline').hidden=false;text('offline',message);$('health-dot').classList.add('bad');}
function checkStateFreshness(){
 if(online&&lastStateReceivedAt!==null&&performance.now()-lastStateReceivedAt>stateStaleMs){online=false;showOffline('监控数据已超时，正在重新连接。下方是最后一次读取的记录。');text('health','监控数据已过期');}
}
async function poll(){if(stopped||busy)return;busy=true;const requestGeneration=generation,controller=new AbortController();stateController=controller;
 const timeout=setTimeout(()=>controller.abort(),stateRequestTimeoutMs);try{
 let url=stateUrl();
 let response=await fetch(url,{cache:'no-store',signal:controller.signal});if(response.status===404){selected='';response=await fetch(stateUrl(''),{cache:'no-store',signal:controller.signal});}if(!response.ok)throw Error();let data=await response.json();
 if(requestGeneration!==generation)return;
 const optionsKey=JSON.stringify(data.sessions.map(x=>[x.id,x.title]));
 if(optionsKey!==lastOptions){$('sessions').replaceChildren(...data.sessions.map(x=>safeOption(x.title,x.id,x.isGuardianReview)));lastOptions=optionsKey;}
 text('internal-count',data.internalSessionCount?($('show-internal').checked?'内部审查已显示':`已隐藏 ${data.internalSessionCount} 个`):'');
 const latest=data.latestSessionId;
 if($('follow').checked&&latest&&latest!==selected){selected=latest;const picked=await fetch(stateUrl(selected),{cache:'no-store',signal:controller.signal});if(!picked.ok)throw Error();data=await picked.json();if(requestGeneration!==generation)return;}
 current=data;offset=data.serverNow-Date.now();selected=data.state?.id||selected;$('sessions').value=selected;
 lastStateReceivedAt=performance.now();online=true;$('offline').hidden=true;$('health-dot').classList.remove('bad');render();
 }catch{if(requestGeneration===generation){online=false;showOffline('连接不到本机监控服务或读取超时。下方是最后一次读取的记录，不能代表 Codex 的最新状态。');text('health','监控连接中断');}}finally{clearTimeout(timeout);if(stateController===controller)stateController=null;busy=false;}}
function render(){
 checkStateFreshness();
 renderNetwork(current?.network);
 if(!current){updatePanelSummaries(null);return;}const s=current.state;if(!s){text('last-action',current.discoveryError||'尚未发现会话');text('status','等待会话');updatePanelSummaries(null);return;}
 const now=Date.now()+offset,active=s.status==='running',end=s.endedAt||now;
 text('status',online?taskStatusText(s.status,s.terminationReason):'监控离线');$('status').className=`badge ${online?s.status:'unknown'}`;
 text('elapsed-label',active?'本轮已用时':s.status==='terminated'?'本轮终止前用时':s.status==='unknown'?'本轮耗时未知':'本轮总用时');text('elapsed',s.status==='terminated'&&!s.endedAt?'—':s.startedAt?duration(end-s.startedAt):'--:--');
 text('model',[s.model,s.effort].filter(Boolean).join(' · '));text('session-id',s.id.slice(0,8));text('last-action',s.lastAction);
 text('hero-note',active?'计时持续更新；实际内部处理状态以可观察事件为限。':s.status==='terminated'?(s.endedAt?'已记录终止事件，计时已停止。':'已被新一轮替代；未取得确切结束时间，耗时未知。'):s.status==='unknown'?'尚无完整任务起止记录，不能判断任务是否运行。':'已记录结束事件，计时已停止。');
 const quiet=s.lastActivityAt?Math.max(0,now-s.lastActivityAt):null;text('quiet',duration(quiet));text('quiet-caption',active?'距离最近一次可识别活动':'距最后活动；本轮已结束或状态未知');
 text('first',s.firstReplyAt&&s.startedAt?duration(s.firstReplyAt-s.startedAt):active&&s.startedAt?duration(now-s.startedAt):'—');text('first-caption',s.firstReplyAt?'已记录首条回复':active?'仍在等待首条回复':'未记录首条回复');
 const pending=s.pending.at(-1);text('tool-label',pending?`${pending.label}（尚未记录返回）`:s.lastTool?`${s.lastTool.label}已结束`:'未记录工具调用');text('tool-duration',s.lastTool?short(s.lastTool.durationMs):'—');
 text('retries',s.retries);text('failures',s.failures);text('fallbacks',s.fallbacks);text('request-size',s.requestBytes!==null?`最近请求体 ${(s.requestBytes/1e6).toFixed(2)} MB`:'');
 renderConnectionDetails(s);
 let warning=s.readError||s.dbError||current.discoveryError;
 if(!warning&&active&&quiet!==null&&quiet>=Number($('threshold').value)*1000)warning=`已连续 ${Math.floor(quiet/1000)} 秒没有新活动。可能仍在处理，也可能在等待连接；目前无法确认。`;
 if(!warning&&active&&s.retries>0)warning='本轮记录过连接重试，请结合最近活动时间判断是否恢复。';
 $('warning').hidden=!warning;text('warning',warning||'');
 $('plan-panel').hidden=!s.plan.length;if(s.plan.length){const done=s.plan.filter(x=>x.status==='completed').length;text('plan-count',`${done} / ${s.plan.length} 已完成`);$('plan-progress').max=s.plan.length;$('plan-progress').value=done;$('plan').replaceChildren(...s.plan.map(p=>{const li=document.createElement('li');li.textContent=(p.status==='completed'?'✓':t(p.status==='inProgress'?'进行中 ·':'待开始 ·'))+' '+p.step;return li;}));}
 renderEvents(s);
 updatePanelSummaries(s);
 if(online)text('health',`监控正常 · 最近读取 ${new Date(current.lastCheckedAt).toLocaleTimeString(I18n.locale(),{hour12:false})} · ${current.pollMs}ms`);text('source',current.source);
 document.title=t(active?`[${duration(s.startedAt?now-s.startedAt:0)}] Codex 运行监控`:'Codex 运行监控');
}
window.addEventListener('codex-monitor-language-change',()=>{
 for(const node of document.querySelectorAll('[data-i18n-source]'))node.textContent=t(node.dataset.i18nSource);
 lastEvents='';lastConnectionRecords='';lastOptions='';lastNetworkOptions='';
 if(current){$('sessions').replaceChildren(...current.sessions.map(s=>safeOption(s.title,s.id,s.isGuardianReview)));$('sessions').value=selected;}
 for(const id of panelIds){const button=$(id).querySelector('.panel-toggle');button.title=t(isPanelCollapsed(id)?'展开':'收起')+' '+button.textContent.replace(/[▾▸]/g,'').trim();}
 render();
});
initializePanelCollapse();
setInterval(poll,1000);setInterval(render,1000);setInterval(tickActivityClocks,100);setInterval(pollNetworkHistory,1000);poll();pollNetworkHistory();
