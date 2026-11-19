(function(root){
 'use strict';
 class QuotaView{
  constructor(get,i18n){this.get=get;this.i18n=i18n;this.historyKey='';}
  render(q,online=true,now=Date.now()){
   const get=this.get,t=this.i18n.translate,set=(key,value)=>{get(key).textContent=value;},n=v=>Number(v.toFixed(2)).toLocaleString(this.i18n.locale()),percent=v=>Number.isFinite(v)?n(v)+'%':'—';
   const date=v=>v?new Date(v).toLocaleString(this.i18n.locale(),{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}):'—';
   const noteText={start:'缺少开始读数',end:'末次读数早于结束或结束未确认','reset-gap':'已分段统计，恢复前可能有未采到的消耗',correction:'额度读数曾被官方校正',interrupted:'部分时段没有可用额度','after-end':'采用紧随任务结束的官方读数'};
   const usage=v=>v?.reason==='pending'?t('待采样'):percent(v?.percent)+(v?.notes?.length?'*':'');
   const explain=v=>{
    if(v?.notes?.length)return t('仅含已观测时段')+' · '+v.notes.map(k=>t(noteText[k]||'起止快照不完整')).join(' · ')+(v.toAt?' · '+t('更新于')+' '+date(v.toAt):'');
    const reason=v?.reason;
    return t(reason==='pending'?'待采样':reason==='reset'?'跨额度恢复或校正，无法直接计算':reason==='unavailable'?'未提供此额度':reason||!v?'起止快照不完整':'账户额度快照差值');
   };
   const five=q?.windows?.fiveHour,week=q?.windows?.weekly,hideFive=five?.available===false;
   for(const key of ['quota-five','quota-mini-five','quota-five-column'])get(key).hidden=hideFive;
   for(const [key,w] of [['five',five],['week',week]]){
    const value=w?.remainingPercent;set('quota-'+key+'-value',percent(value));set('quota-mini-'+key+'-value',percent(value));
    get('quota-'+key+'-progress').value=value??0;get('quota-ring-'+key).style.setProperty('--quota-fill',Math.max(0,Math.min(100,value??0))+'%');
    const low=w?.available===true&&Number.isFinite(value)&&value>=0&&value<10;
    get('quota-'+key+'-progress').dataset.low=String(low);get('quota-ring-'+key).dataset.low=String(low);
    const reset=w?.resetAt;set('quota-'+key+'-countdown',!w||!w.available?t('等待额度数据'):reset<=now?t('已到恢复时间，等待官方更新'):t('距恢复')+' '+this.countdown(reset-now));
    const expired=reset&&reset<=now,stale=w&&now-w.updatedAt>180000;set('quota-'+key+'-updated',t('更新于')+' '+date(w?.updatedAt)+(expired?' · '+t('待更新'):stale?' · '+t('快照较旧'):''));
    get('quota-mini-'+key+'-value').dataset.stale=String(!!(stale||expired||!online));
    get('quota-mini-'+key+'-value').title=(stale||expired||!online?t('快照较旧')+' · ':'')+t('更新于')+' '+date(w?.updatedAt);
   }
   const current=q?.rounds?.[0],previous=current?(q.rounds.find(row=>row.id!==current.id&&row.status!=='running')??null):q?.previousRound,key=hideFive?'weekly':'fiveHour';
   set('quota-current-label',t(hideFive?'本轮周额度消耗':'本轮5h消耗'));set('quota-current-value',usage(current?.[key]));
   get('quota-current-value').title=current?(current.title||date(current.startAt))+(current.overlap?' · '+t('含并行使用'):'')+' · '+explain(current[key]):t('起止快照不完整');
   set('quota-previous-label',t(hideFive?'上一轮周额度消耗':'上一轮5h消耗'));set('quota-previous-value',usage(previous?.[key]));
   get('quota-previous-value').title=previous?(previous.title||date(previous.startAt))+(previous.overlap?' · '+t('含并行使用'):'')+' · '+explain(previous[key]):t('尚无上一轮记录');
   const source=[five,week].filter(w=>w?.available).some(w=>w.source==='official')?'官方额度查询':'本机日志快照';
   set('quota-status',t(!online?'监控离线':q?.refreshing?'正在刷新额度':q?.collecting?'额度采集中':source));get('quota-refresh').disabled=!!q?.refreshing;get('quota-refresh').hidden=q?.refreshAvailable===false;
   const notices=[];if(q?.refreshError&&q.refreshError!=='disabled')notices.push(t('官方额度刷新暂不可用，当前保留日志或上次查询快照。'));
   if(q?.journalError)notices.push(t('额度记录缓存读写异常，重启后可能缺少部分记录。'));
   if(q?.readErrors||q?.limited)notices.push(t('部分日志未能完整采集，相关轮次的消耗可能未知。'));
   set('quota-notice',notices.join('\n'));get('quota-notice').hidden=!notices.length;
   const historyKey=JSON.stringify([q?.rounds||[],hideFive,this.i18n.language]);if(historyKey===this.historyKey)return;this.historyKey=historyKey;
   const rows=(q?.rounds||[]).map(row=>{
    const tr=root.document.createElement('tr'),title=root.document.createElement('td'),label=root.document.createElement('span'),time=root.document.createElement('small');
    label.textContent=row.title||t('任务');label.className='quota-task-title';title.title=row.title||'';time.textContent=date(row.startAt);title.appendChild(label);title.appendChild(time);tr.appendChild(title);
    for(const [kind,hidden] of [['fiveHour',hideFive],['weekly',false]]){const td=root.document.createElement('td');td.hidden=hidden;td.textContent=usage(row[kind]);td.title=explain(row[kind]);tr.appendChild(td);}
    const note=root.document.createElement('td'),notes=[];if(row.status==='running')notes.push(t('进行中'));if(row.status==='unknown')notes.push(t('结束未确认'));if(row.status==='terminated')notes.push(t('任务终止'));if(row.overlap)notes.push(t('含并行使用'));if([row.fiveHour,row.weekly].some(v=>v?.notes?.length))notes.push('* '+t('仅含已观测时段'));if([row.fiveHour,row.weekly].some(v=>v?.reason&&!['unavailable','pending'].includes(v.reason)))notes.push(t('部分数据未知'));note.textContent=notes.join(' · ')||t('已观测');tr.appendChild(note);return tr;
   });get('quota-history').replaceChildren(...rows);get('quota-history-empty').hidden=rows.length>0;
  }
  countdown(ms){let seconds=Math.max(0,Math.ceil(ms/1000));const days=Math.floor(seconds/86400);seconds%=86400;const hours=Math.floor(seconds/3600);seconds%=3600;const minutes=Math.floor(seconds/60);seconds%=60;const en=this.i18n.language==='en';return [days?days+(en?'d':' 天'):null,hours||days?hours+(en?'h':' 小时'):null,minutes||hours||days?minutes+(en?'m':' 分'):null,seconds+(en?'s':' 秒')].filter(Boolean).join(' ');}
 }
 root.CodexMonitorQuotaView=QuotaView;
})(globalThis);
