(function(root){
 'use strict';
 const at=node=>Number.isFinite(node.event.startedAt)?node.event.startedAt:node.event.at;
 function buildTree(state,order='desc'){
  const nodes=new Map(),events=state?.events||[];
  const start=state?.turnId&&events.find(event=>event.kind==='start');
  const rootKey=start?.key;
  for(let index=0;index<events.length;index++){
   const original=events[index];if(nodes.has(original.key))continue;
   let event=original;
   if(original.key===rootKey){
    const running=state.status==='running',ended=Number.isFinite(state.endedAt),began=Number.isFinite(state.startedAt);
    const title=state.taskTitle||'任务：提问内容未获取...';
     event={...original,groupRoot:true,operation:true,toolLabel:title,label:title,taskStatus:state.unconfirmed?'unconfirmed':state.status,terminationReason:state.terminationReason,status:running?'running':state.status==='terminated'?'terminated':state.status==='failed'?'failed':ended?'returned':'unknown',startedAt:began?state.startedAt:null,endedAt:ended?state.endedAt:null,durationMs:!running&&ended&&began&&state.endedAt>=state.startedAt?state.endedAt-state.startedAt:null};
   }
   nodes.set(event.key,{event,index,model:state.model||'',effort:state.effort||'',parent:null,children:[],childCount:0,descendantRecords:0,runningChildren:0,runningCount:0,operationCount:0,groupRunning:false});
  }
  const calls=new Map(),items=new Map();
  function unique(map,id,node){if(!id)return;if(map.has(id))map.set(id,null);else map.set(id,node);}
  for(const node of nodes.values()){unique(calls,node.event.callId,node);unique(items,node.event.itemId,node);}
  const desired=new Map();
  for(const node of nodes.values()){
   if(node.event.groupRoot)continue;
   const candidates=new Set([calls.get(node.event.parentCallId),items.get(node.event.parentItemId)].filter(Boolean));
   if(candidates.size===1)desired.set(node,[...candidates][0]);
  }
  // Break explicit cycles without guessing a replacement tool parent.
  const invalid=new Set(),checked=new Set();
  for(const node of nodes.values()){
   const chain=[],positions=new Map();let cursor=node;
   while(cursor&&!checked.has(cursor)){
    if(positions.has(cursor)){for(const entry of chain.slice(positions.get(cursor)))invalid.add(entry);break;}
    positions.set(cursor,chain.length);chain.push(cursor);cursor=desired.get(cursor);
   }
   for(const entry of chain)checked.add(entry);
  }
  const taskRoot=nodes.get(rootKey),roots=[];
  for(const node of nodes.values()){
   const explicit=invalid.has(node)?null:desired.get(node);
   const parent=explicit||(!node.event.groupRoot?taskRoot:null);
   if(parent&&parent!==node){node.parent=parent;parent.children.push(node);}else roots.push(node);
  }
  const stack=roots.map(node=>[node,false]);
  while(stack.length){
   const [node,visited]=stack.pop();
   if(!visited){stack.push([node,true]);for(const child of node.children)stack.push([child,false]);continue;}
   node.childCount=node.children.reduce((sum,child)=>sum+child.operationCount,0);
   node.descendantRecords=node.children.reduce((sum,child)=>sum+1+child.descendantRecords,0);
   node.runningChildren=node.children.reduce((sum,child)=>sum+child.runningCount,0);
   const operation=Boolean(node.event.operation&&!node.event.groupRoot);
   node.operationCount=node.childCount+(operation?1:0);
   node.runningCount=node.runningChildren+(operation&&node.event.status==='running'?1:0);
   node.groupRunning=node.event.status==='running'||node.children.some(child=>child.groupRunning);
  }
  function compare(a,b){
   if(a.groupRunning!==b.groupRunning)return a.groupRunning?-1:1;
   const delta=(at(a)-at(b))*(a.groupRunning||order==='asc'?1:-1);
   return delta||a.index-b.index;
  }
  roots.sort(compare);for(const node of nodes.values())node.children.sort(compare);
  return {nodes,roots,eventCount:events.length,operationCount:roots.reduce((sum,node)=>sum+node.operationCount,0),runningCount:roots.reduce((sum,node)=>sum+node.runningCount,0)};
 }
 function visibleRows(tree,expanded=new Map()){
  const rows=[],stack=[];
  for(let i=tree.roots.length-1;i>=0;i--)stack.push({node:tree.roots[i],depth:0,isLast:i===tree.roots.length-1});
  while(stack.length){
   const row=stack.pop(),children=row.node.children;
   row.expanded=children.length>0&&(expanded.has(row.node.event.key)?expanded.get(row.node.event.key):row.depth===0);
   rows.push(row);
   if(row.expanded)for(let i=children.length-1;i>=0;i--)stack.push({node:children[i],depth:row.depth+1,isLast:i===children.length-1});
  }
  return rows;
 }
 function buildTimeline(turns,order='desc'){
  const nodes=new Map(),roots=[];let eventCount=0,operationCount=0,runningCount=0;
  for(const turn of turns){
   const prefix=(turn.id||'')+':'+(turn.turnId||turn.startedAt||'unknown')+':';
   const tree=buildTree({...turn,events:(turn.events||[]).map(event=>({...event,key:prefix+event.key}))},order);
   for(const [key,node] of tree.nodes)nodes.set(key,node);
   roots.push(...tree.roots);eventCount+=tree.eventCount;operationCount+=tree.operationCount;runningCount+=tree.runningCount;
  }
  roots.sort((a,b)=>a.groupRunning!==b.groupRunning?(a.groupRunning?-1:1):(at(a)-at(b))*(a.groupRunning||order==='asc'?1:-1));
  return {nodes,roots,eventCount,operationCount,runningCount};
 }
 function branchFor(row){return row.node.parent&&!row.node.parent.event.groupRoot?(row.isLast?'└─':'├─'):'';}
 function formatDuration(ms){
  if(!Number.isFinite(ms))return '耗时未知';
  const value=Math.floor(Math.max(0,ms));if(value<1000)return value+' 毫秒';
  // Display only completed seconds while retaining precise source timestamps.
  const totalSeconds=Math.floor(value/1000),hours=Math.floor(totalSeconds/3600),minutes=Math.floor(totalSeconds%3600/60),seconds=totalSeconds%60;
  return (hours?hours+' 小时 '+minutes+' 分 ':minutes?minutes+' 分 ':'')+seconds+' 秒';
 }
 function liveDuration(start,now){return Number.isFinite(start)&&Number.isFinite(now)?formatDuration(now-start):'耗时未知';}
 class WindowHistory{
  constructor(storage,now=Date.now()){
   this.storage=storage;this.since=now;this.initial={};this.sessions={};this.serialized='';
   try{const saved=JSON.parse(storage.getItem('codex-monitor-window-history'));if(saved&&Number.isFinite(saved.since)){this.since=saved.since;this.initial=saved.initial||{};this.sessions=saved.sessions||{};}}catch{}
  }
  remember(state,turns=[]){
   if(!state)return [];
   const id=state.id;if(!this.initial[id]&&state.turnId)this.initial[id]=state.turnId;
   const byId=new Map((this.sessions[id]||[]).map(turn=>[turn.turnId||'unknown',turn]));
   for(const turn of [...turns,state]){
    if(turn.turnId!==state.turnId&&turn.turnId!==this.initial[id]&&!(turn.startedAt>=this.since))continue;
    const key=turn.turnId||'unknown',old=byId.get(key);
    const authoritativeEnd=(turn.events||[]).some(event=>event.turnEnd);
    const oldEvents=(old?.events||[]).filter(event=>!authoritativeEnd||!event.turnEnd&&!(['completed','cancelled','failed'].includes(event.kind)&&/^(?:本轮)?任务(?:已完成|已取消|失败)$/.test(event.label)));
    const events=[...new Map([...oldEvents,...(turn.events||[])].map(event=>[event.key,event])).values()];
    byId.set(key,{...old,...turn,unconfirmed:false,taskTitle:turn.taskTitle||old?.taskTitle,startedAt:turn.startedAt??old?.startedAt,events});
   }
   for(const [key,turn] of byId){
    if(key!==state.turnId&&turn.status==='running'&&state.turnId&&(!Number.isFinite(turn.startedAt)||Number.isFinite(state.startedAt)&&turn.startedAt<=state.startedAt)){
     Object.assign(turn,{status:'unknown',unconfirmed:true,endedAt:null,pending:[]});
    }
    if(turn.status!=='running')turn.events=turn.events.map(event=>event.status==='running'?{...event,status:'unknown',durationMs:null,endedAt:null,label:(event.toolLabel||event.label||'工具调用').replace(/（运行中）$/,'')+'（结束未确认）'}:event);
   }
   this.sessions[id]=[...byId.values()];
   const serialized=JSON.stringify({since:this.since,initial:this.initial,sessions:this.sessions});
   if(serialized!==this.serialized){try{this.storage.setItem('codex-monitor-window-history',serialized);this.serialized=serialized;}catch{}}
   return this.sessions[id];
  }
 }
 root.CodexMonitorActivity=Object.freeze({buildTree,buildTimeline,visibleRows,branchFor,formatDuration,liveDuration,WindowHistory});
})(globalThis);
