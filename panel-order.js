(function(root){
 'use strict';
 const storageKey='codex-monitor-panel-order';
 function normalizeOrder(saved,defaults){
  const known=new Set(defaults),order=[];for(const id of Array.isArray(saved)?saved:[])if(known.has(id)&&!order.includes(id))order.push(id);
  return [...order,...defaults.filter(id=>!order.includes(id))];
 }
 function moveOrder(order,id,target,after=false){
  if(id===target||!order.includes(id)||!order.includes(target))return [...order];
  const next=order.filter(value=>value!==id),index=next.indexOf(target)+(after?1:0);next.splice(index,0,id);return next;
 }
 class PanelOrder{
  constructor(doc=root.document,i18n=root.CodexMonitorI18n){
   this.doc=doc;this.i18n=i18n;this.stack=doc.getElementById('panel-stack');this.list=doc.getElementById('panel-order-list');this.toggle=doc.getElementById('panel-order-toggle');this.settings=doc.getElementById('panel-order-settings');this.live=doc.getElementById('panel-order-live');this.reset=doc.getElementById('panel-order-reset');this.note=doc.getElementById('panel-order-note');
   this.defaults=Array.from(this.stack.querySelectorAll(':scope > [data-collapsible]')).map(p=>p.id);this.panels=new Map(this.defaults.map(id=>[id,doc.getElementById(id)]));this.labels=new Map(this.defaults.map(id=>[id,this.panels.get(id).querySelector('.panel-toggle [data-i18n]')?.dataset.i18n||id]));
   this.editing=false;this.dragging=null;this.canSave=true;this.storage=null;this.handles=new Map();
   let saved=null;try{this.storage=root.localStorage;saved=this.storage?.getItem(storageKey);if(!this.storage)this.canSave=false;}catch{this.canSave=false;}
   try{this.order=normalizeOrder(JSON.parse(saved||'null'),this.defaults);}catch{this.order=[...this.defaults];}
   this.apply();
   for(const [id,panel] of this.panels){
    const handle=doc.createElement('button');handle.type='button';handle.className='panel-drag-handle';handle.textContent='⠿';handle.draggable=true;handle.hidden=true;handle.setAttribute('data-panel-id',id);
    handle.addEventListener('dragstart',event=>this.startDrag(event,id));handle.addEventListener('dragend',()=>this.endDrag());
    handle.addEventListener('keydown',event=>{if(!this.editing||!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();this.shift(id,event.key==='ArrowUp'?-1:1);handle.focus({preventScroll:true});});
    panel.querySelector('.panel-heading').prepend(handle);this.handles.set(id,handle);
   }
   this.toggle.addEventListener('click',()=>this.setEditing(!this.editing));
   this.reset.addEventListener('click',()=>{this.setOrder(this.defaults,true);this.announce('已恢复默认顺序');});
   this.stack.addEventListener('dragover',event=>this.dragOver(event,this.targetPanel(event)));
   this.stack.addEventListener('drop',event=>this.drop(event,this.targetPanel(event)));
   this.list.addEventListener('dragover',event=>this.dragOver(event,event.target.closest('[data-panel-id]')));
   this.list.addEventListener('drop',event=>this.drop(event,event.target.closest('[data-panel-id]')));
   root.addEventListener?.('codex-monitor-language-change',()=>this.render());
   root.addEventListener?.('storage',event=>{if(event.key!==storageKey&&event.key!==null)return;let saved=null;try{saved=JSON.parse(event.newValue);}catch{}this.setOrder(normalizeOrder(saved,this.defaults),false);});
   this.render();
  }
  t(value){return this.i18n.translate(value);}
  label(id){return this.t(this.labels.get(id)||id);}
  announce(value){this.lastAnnouncement=value;this.live.textContent=this.t(value);}
  apply(){
   const focused=this.doc.activeElement,restoreFocus=focused&&this.stack.contains(focused),positions=[];
   for(const panel of this.panels.values())for(const element of [panel,...panel.querySelectorAll('#events,#connection-records,.events-table-scroll,.quota-table-scroll')])positions.push([element,element.scrollTop,element.scrollLeft]);
   for(const id of this.order)this.stack.appendChild(this.panels.get(id));
   for(const [element,top,left] of positions){element.scrollTop=top;element.scrollLeft=left;}
   if(restoreFocus)focused.focus({preventScroll:true});
  }
  setOrder(order,persist=true){
   this.order=normalizeOrder(order,this.defaults);this.apply();
   if(persist)try{if(!this.storage)throw Error();this.storage.setItem(storageKey,JSON.stringify(this.order));this.canSave=true;}catch{this.canSave=false;}
   this.render();
  }
  shift(id,direction){
   const index=this.order.indexOf(id),target=this.order[index+direction];if(!target)return;
   this.setOrder(moveOrder(this.order,id,target,direction>0));this.announce('模块顺序已更新');
  }
  setEditing(value){this.editing=value;this.endDrag();this.render();}
  render(){
   if(this.lastAnnouncement)this.live.textContent=this.t(this.lastAnnouncement);
   this.settings.hidden=!this.editing;this.toggle.setAttribute('aria-expanded',String(this.editing));this.toggle.textContent=this.t(this.editing?'完成排序':'调整顺序');this.stack.classList.toggle('is-sorting',this.editing);
   this.note.textContent=this.t(this.canSave?'拖动列表或模块手柄调整顺序，也可使用上移、下移。顺序自动保存。':'无法保存到本机；本次窗口内仍可调整顺序。');
   for(const [id,handle] of this.handles){handle.hidden=!this.editing;handle.title=this.t('拖动调整顺序')+' · '+this.label(id);handle.setAttribute('aria-label',this.label(id)+' · '+this.t('拖动或使用上下方向键排序'));}
   const rows=this.order.map((id,index)=>{
    const li=this.doc.createElement('li');li.className='panel-order-item';li.draggable=true;li.dataset.panelId=id;
    const name=this.doc.createElement('span'),grip=this.doc.createElement('span');grip.textContent='⠿';grip.className='panel-order-grip';grip.setAttribute('aria-hidden','true');name.textContent=this.label(id);li.append(grip,name);
    const actions=this.doc.createElement('div');actions.className='panel-order-actions';
    for(const [direction,glyph,label] of [[-1,'↑','上移'],[1,'↓','下移']]){
     const button=this.doc.createElement('button');button.type='button';button.textContent=glyph;button.dataset.direction=String(direction);button.title=this.t(label);button.setAttribute('aria-label',this.t(label)+' · '+this.label(id));button.disabled=direction===-1?index===0:index===this.order.length-1;
     button.addEventListener('click',()=>{this.shift(id,direction);const row=Array.from(this.list.children).find(node=>node.dataset.panelId===id);const next=row?.querySelector('[data-direction="'+direction+'"]');if(next&&!next.disabled)next.focus({preventScroll:true});else row?.querySelector('button:not(:disabled)')?.focus({preventScroll:true});});actions.appendChild(button);
    }li.appendChild(actions);li.addEventListener('dragstart',event=>this.startDrag(event,id));li.addEventListener('dragend',()=>this.endDrag());return li;
   });this.list.replaceChildren(...rows);this.reset.disabled=this.order.every((id,index)=>id===this.defaults[index]);
  }
  targetPanel(event){const panel=event.target.closest('[data-collapsible]');return panel&&this.panels.has(panel.id)?panel:null;}
  startDrag(event,id){
   if(!this.editing||!this.panels.has(id)){event.preventDefault();return;}this.dragging=id;
   if(event.dataTransfer){event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',id);}this.panels.get(id).classList.add('panel-dragging');
  }
  dragOver(event,target){
   const id=target?.dataset.panelId||target?.id;if(!this.editing||!this.dragging||!this.panels.has(id)||id===this.dragging)return;
   event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';this.clearMarks();const rect=target.getBoundingClientRect();target.dataset.orderDrop=event.clientY>=rect.top+rect.height/2?'after':'before';
  }
  drop(event,target){
   const id=target?.dataset.panelId||target?.id;if(!this.editing||!this.dragging||!this.panels.has(id))return;event.preventDefault();
   const rect=target.getBoundingClientRect(),next=moveOrder(this.order,this.dragging,id,event.clientY>=rect.top+rect.height/2);this.endDrag();this.setOrder(next);this.announce('模块顺序已更新');
  }
  clearMarks(){for(const node of [...this.panels.values(),...this.list.children])delete node.dataset.orderDrop;}
  endDrag(){this.dragging=null;this.clearMarks();for(const panel of this.panels.values())panel.classList.remove('panel-dragging');}
 }
 root.CodexMonitorPanelOrder=Object.freeze({normalizeOrder,moveOrder,PanelOrder,storageKey});
 const initialize=()=>{if(root.document?.getElementById('panel-stack'))root.codexMonitorPanelOrder=new PanelOrder();};
 if(root.document?.readyState==='loading')root.document.addEventListener('DOMContentLoaded',initialize,{once:true});else initialize();
})(globalThis);
