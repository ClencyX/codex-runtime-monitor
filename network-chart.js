(function(root){
 'use strict';
 const t=value=>root.CodexMonitorI18n?.translate(value)??String(value??'');
 const valid=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
 function formatRate(value){
  if(!valid(value))return '—';const units=['B/s','KiB/s','MiB/s','GiB/s','TiB/s'];let index=0;
  while(value>=1024&&index<units.length-1){value/=1024;index++;}
  return value.toFixed(index===0?0:value>=100?0:value>=10?1:2)+' '+units[index];
 }
 function segments(points,field,gap=2500){
  const result=[];let line=null,last=null;
  for(const point of points){
   if(!Number.isFinite(point.at)||!valid(point[field])){line=null;last=null;continue;}
   if(!line||point.at-last>gap||point.at<last){line=[];result.push(line);}
   line.push(point);last=point.at;
  }
  return result;
 }
 function nearestPoint(points,at,tolerance=1500){
  let low=0,high=points.length;
  while(low<high){const middle=(low+high)>>1;if(points[middle].at<at)low=middle+1;else high=middle;}
  const candidates=[points[low-1],points[low]].filter(Boolean).sort((a,b)=>Math.abs(a.at-at)-Math.abs(b.at-at));
  return candidates.length&&Math.abs(candidates[0].at-at)<=tolerance?candidates[0]:null;
 }
 function gapBridges(points,field,gap=2500){
  const lines=segments(points,field,gap),bridges=[];
  for(let i=1;i<lines.length;i++){const before=lines[i-1].at(-1),after=lines[i][0];if(before.at<after.at)bridges.push([before,after]);}
  return bridges;
 }
 function inspectPoint(points,at,bridges){
  const fields=['receivedPerSecond','sentPerSecond'];
  bridges=bridges||Object.fromEntries(fields.map(field=>[field,gapBridges(points,field)]));
  const gaps=fields.flatMap(field=>bridges[field].filter(([before,after])=>at>before.at&&at<after.at));
  let point=nearestPoint(points,at);
  // Do not snap a position inside a dashed gap onto a measured endpoint.
  if(point&&gaps.some(([before,after])=>point.at<=before.at||point.at>=after.at))point=null;
  return {point,at:point?.at??at,bridged:gaps.length>0};
 }
 class HistoryBuffer{
  constructor(rangeSeconds=600){this.rangeSeconds=rangeSeconds;this.epoch=null;this.seq=null;this.points=[];}
  merge(data){
   if(data.reset||this.epoch!==data.epoch)this.points=[];
   this.epoch=data.epoch;this.seq=data.seq;
   const points=new Map(this.points.map(point=>[point.seq,point]));
   for(const point of data.points||[])if(Number.isSafeInteger(point.seq)&&Number.isFinite(point.at))points.set(point.seq,{seq:point.seq,at:point.at,receivedPerSecond:valid(point.receivedPerSecond)?point.receivedPerSecond:null,sentPerSecond:valid(point.sentPerSecond)?point.sentPerSecond:null,partial:Boolean(point.partial)});
   this.points=[...points.values()].filter(point=>point.at>=data.serverNow-this.rangeSeconds*1000&&point.at<=data.serverNow+1000).sort((a,b)=>a.at-b.at||a.seq-b.seq);
  }
 }
 const svgNS='http://www.w3.org/2000/svg';
 function svgElement(name,attributes={}){const element=document.createElementNS(svgNS,name);for(const [key,value] of Object.entries(attributes))element.setAttribute(key,String(value));return element;}
 function htmlElement(name,className,text){const element=document.createElement(name);element.className=className;if(text!==undefined)element.textContent=t(text);return element;}
 const timeLabel=(at,seconds=false)=>new Date(at).toLocaleTimeString(root.CodexMonitorI18n?.locale()||'zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit',...(seconds?{second:'2-digit'}:{})});
 class TrafficChart{
  constructor(element,note){
   this.element=element;this.note=note;this.processId='';this.rangeSeconds=600;this.scopeLabel='全部 Codex 进程';this.buffer=new HistoryBuffer();this.offset=0;this.status='starting';this.hoverAt=null;this.offlineMessage='';
   this.svg=svgElement('svg',{role:'img','aria-label':'上传和下载速率随时间变化的曲线'});
   const title=svgElement('title');this.chartTitle=title;this.axes=svgElement('g',{'class':'traffic-axes'});
   this.download=svgElement('path',{'class':'traffic-line traffic-download',fill:'none'});this.upload=svgElement('path',{'class':'traffic-line traffic-upload',fill:'none'});
   this.downloadGaps=svgElement('path',{'class':'traffic-line traffic-download traffic-gap',fill:'none'});this.uploadGaps=svgElement('path',{'class':'traffic-line traffic-upload traffic-gap',fill:'none'});
   this.cursor=svgElement('g',{'class':'traffic-cursor',visibility:'hidden',display:'none'});this.cursorLine=svgElement('line');this.cursor.append(this.cursorLine);
   this.cursorDots=['traffic-download','traffic-upload'].map(className=>{const dot=svgElement('circle',{r:3.5,'class':className});this.cursor.append(dot);return dot;});
   this.svg.append(title,this.axes,this.downloadGaps,this.uploadGaps,this.download,this.upload,this.cursor);
   this.empty=htmlElement('div','network-chart-empty','正在积累流量数据');this.tooltip=htmlElement('div','network-chart-tooltip');this.tooltip.hidden=true;this.tooltip.setAttribute('role','tooltip');
   this.tipTime=htmlElement('strong','');this.tipDownload=htmlElement('b','');this.tipUpload=htmlElement('b','');this.tipHint=htmlElement('small','');this.tooltip.append(this.tipTime);
   this.tipLabels=[];
   for(const [label,className,value] of [['下载','traffic-download',this.tipDownload],['上传','traffic-upload',this.tipUpload]]){const row=htmlElement('div','network-chart-tip-row'),text=htmlElement('span',className,label);this.tipLabels.push(text);row.append(text,value);this.tooltip.append(row);}
   this.tooltip.append(this.tipHint);element.replaceChildren(this.svg,this.empty,this.tooltip);
   element.addEventListener('pointermove',event=>{if(!this.plot)return;const rect=this.svg.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;if(x<this.plot.left||x>this.plot.left+this.plot.width||y<this.plot.top||y>this.plot.top+this.plot.height){this.hideTooltip();return;}this.inspect(this.plot.start+(x-this.plot.left)/this.plot.width*this.rangeSeconds*1000);});
   element.addEventListener('pointerleave',()=>this.hideTooltip());element.addEventListener('pointercancel',()=>this.hideTooltip());element.addEventListener('blur',()=>this.hideTooltip());
   element.addEventListener('keydown',event=>{
    if(event.key==='Escape'){this.hideTooltip();return;}if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)||!this.buffer.points.length)return;event.preventDefault();
    const points=this.buffer.points;let index=this.hoverAt===null?points.length-1:points.findIndex(point=>point.at>=this.hoverAt);if(index<0)index=points.length-1;
    index=event.key==='Home'?0:event.key==='End'?points.length-1:Math.max(0,Math.min(points.length-1,index+(event.key==='ArrowLeft'?-1:1)));this.inspect(points[index].at);
   });
   this.observer=new ResizeObserver(()=>this.draw());this.observer.observe(element);root.addEventListener?.('codex-monitor-language-change',()=>this.localize());this.localize();
  }
  localize(){
   this.chartTitle.textContent=t('Codex 上传与下载速率');this.svg.setAttribute('aria-label',t('上传和下载速率随时间变化的曲线'));
   this.tipLabels.forEach((label,index)=>{label.textContent=t(index?'上传':'下载');});this.setContext(this.processId,this.rangeSeconds,this.scopeLabel);this.draw();
  }
  setContext(processId,rangeSeconds,label){
   const changed=this.processId!==processId||this.rangeSeconds!==rangeSeconds;this.scopeLabel=label;
   this.element.setAttribute('aria-label',t(label+'最近'+rangeSeconds/60+'分钟上传和下载速率，左右方向键查看采样'));
   if(!changed)return false;
   this.processId=processId;this.rangeSeconds=rangeSeconds;this.buffer=new HistoryBuffer(rangeSeconds);this.status='starting';this.offlineMessage='';this.hideTooltip();this.draw();return true;
  }
  update(data){this.buffer.merge(data);this.offset=data.serverNow-Date.now();this.status=data.status;this.offlineMessage='';this.draw();}
  offline(){this.offlineMessage='历史暂未更新，正在重试；已读取数据仍可查看';this.draw();}
  draw(){
   const width=this.element.clientWidth;if(!width)return;
   const end=Date.now()+this.offset,start=end-this.rangeSeconds*1000,points=this.buffer.points.filter(point=>point.at>=start&&point.at<=end);
   const values=points.flatMap(point=>[point.receivedPerSecond,point.sentPerSecond]).filter(valid),peak=values.length?Math.max(...values):0;
   const max=Math.max(1024,Math.pow(2,Math.ceil(Math.log2(Math.max(1,peak*1.12)))));
   this.plot={start,end,left:61,top:12,width:Math.max(1,width-73),height:132,max,points};this.svg.setAttribute('viewBox','0 0 '+width+' 174');
   const p=this.plot,x=at=>p.left+(at-start)/(end-start)*p.width,y=value=>p.top+p.height-value/max*p.height;
   this.axes.replaceChildren();
   for(const fraction of [0,0.5,1]){
    const yy=p.top+p.height*(1-fraction),line=svgElement('line',{x1:p.left,x2:p.left+p.width,y1:yy,y2:yy,'class':'traffic-grid'}),label=svgElement('text',{x:p.left-7,y:yy+3,'text-anchor':'end'});label.textContent=formatRate(max*fraction);this.axes.append(line,label);
   }
   const ticks=width<400?3:5;
   for(let i=0;i<ticks;i++){const xx=p.left+p.width*i/(ticks-1),label=svgElement('text',{x:xx,y:164,'text-anchor':i===0?'start':i===ticks-1?'end':'middle'});label.textContent=timeLabel(start+(end-start)*i/(ticks-1),this.rangeSeconds===60);this.axes.append(label);if(i>0&&i<ticks-1)this.axes.append(svgElement('line',{x1:xx,x2:xx,y1:p.top,y2:p.top+p.height,'class':'traffic-grid traffic-grid-vertical'}));}
   const path=field=>segments(points,field).map(line=>line.map((point,index)=>(index?'L':'M')+x(point.at).toFixed(2)+' '+y(point[field]).toFixed(2)).join(' ')).join(' ');
   p.gaps=Object.fromEntries(['receivedPerSecond','sentPerSecond'].map(field=>[field,gapBridges(points,field)]));
   const dashedPath=field=>p.gaps[field].map(([before,after])=>'M'+x(before.at).toFixed(2)+' '+y(before[field]).toFixed(2)+' L'+x(after.at).toFixed(2)+' '+y(after[field]).toFixed(2)).join(' ');
   this.downloadGaps.setAttribute('d',dashedPath('receivedPerSecond'));this.uploadGaps.setAttribute('d',dashedPath('sentPerSecond'));
   this.download.setAttribute('d',path('receivedPerSecond'));this.upload.setAttribute('d',path('sentPerSecond'));
   const available=values.length>0,last=points.at(-1),missing=!last||!valid(last.receivedPerSecond)&&!valid(last.sentPerSecond);
   this.empty.hidden=available;this.empty.textContent=t(['error','disabled','unmapped'].includes(this.status)?'暂未取得可用采样':'正在积累流量数据');
   this.note.textContent=t(this.offlineMessage||(this.status==='partial'?'部分连接未覆盖 · 虚线连接缺失区间，非实测':available&&missing?'采样有空缺 · 两侧有数据时以虚线连接':'实线为实测 · 虚线连接缺失区间，非实测'));
   if(this.hoverAt!==null)this.inspect(this.hoverAt);
  }
  inspect(at){
   const p=this.plot;if(!p||at<p.start||at>p.end){this.hideTooltip();return;}
   this.hoverAt=at;const inspection=inspectPoint(p.points,at,p.gaps),point=inspection.point,displayAt=inspection.at,x=p.left+(displayAt-p.start)/(p.end-p.start)*p.width;
   this.cursor.setAttribute('display','inline');this.cursor.setAttribute('visibility','visible');for(const [key,value] of Object.entries({x1:x,x2:x,y1:p.top,y2:p.top+p.height}))this.cursorLine.setAttribute(key,value);
   for(let i=0;i<2;i++){const value=point?.[i?'sentPerSecond':'receivedPerSecond'],dot=this.cursorDots[i];dot.setAttribute('visibility',valid(value)?'visible':'hidden');if(valid(value)){dot.setAttribute('cx',x);dot.setAttribute('cy',p.top+p.height-value/p.max*p.height);}}
   this.tipTime.textContent=timeLabel(displayAt,true);this.tipDownload.textContent=formatRate(point?.receivedPerSecond);this.tipUpload.textContent=formatRate(point?.sentPerSecond);this.tipHint.textContent=t(inspection.bridged?'虚线连接缺失区间，非实测速率':point?.partial?'仅计已匹配连接':!point||!valid(point.receivedPerSecond)&&!valid(point.sentPerSecond)?'该时段未取得采样':'');
   this.tooltip.hidden=false;const tipWidth=this.tooltip.getBoundingClientRect().width;this.tooltip.style.left=Math.max(4,Math.min(this.element.clientWidth-tipWidth-4,x+12+tipWidth<this.element.clientWidth?x+12:x-tipWidth-12))+'px';
  }
  hideTooltip(){this.hoverAt=null;this.tooltip.hidden=true;this.cursor.setAttribute('display','none');this.cursor.setAttribute('visibility','hidden');}
 }
 root.CodexMonitorNetworkChart=Object.freeze({formatRate,segments,gapBridges,inspectPoint,nearestPoint,HistoryBuffer,TrafficChart});
})(globalThis);
