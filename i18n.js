(function(root){
 'use strict';
 const key='codex-monitor-language';let language='zh-CN';
 const valid=value=>value==='en'||value==='zh-CN'?value:'zh-CN';
 try{language=valid(root.localStorage?.getItem(key));}catch{}
 const en={
  '本轮5h消耗':'This turn · 5h used','本轮周额度消耗':'This turn · weekly used',
  '调整顺序':'Arrange panels','完成排序':'Done arranging','模块展示顺序':'Panel display order','恢复默认顺序':'Restore default order','上移':'Move up','下移':'Move down','拖动调整顺序':'Drag to reorder','拖动或使用上下方向键排序':'Drag or use Up/Down arrow keys to reorder','模块顺序已更新':'Panel order updated','已恢复默认顺序':'Default order restored',
  '拖动列表或模块手柄调整顺序，也可使用上移、下移。顺序自动保存。':'Drag the list or panel handles, or use the arrow buttons. Your order is saved automatically.','无法保存到本机；本次窗口内仍可调整顺序。':'Local saving is unavailable; you can still arrange panels in this window.',
  '账户额度记录':'Account quota','周额度剩余':'Weekly quota remaining','5h剩余':'5h remaining','上一轮5h消耗':'Last turn · 5h used','上一轮周额度消耗':'Last turn · weekly used','刷新额度':'Refresh quota','正在刷新额度':'Refreshing quota','通过本机Codex查询官方额度，不调用模型':'Read official quota through local Codex; no model call','额度刷新失败，请稍后重试':'Could not refresh quota; please retry',
  '官方额度查询':'Official quota query','本机日志快照':'Local log snapshots','距恢复':'Resets in','已到恢复时间，等待官方更新':'Reset time reached; waiting for an official update','更新于':'Updated','待更新':'Awaiting update','快照较旧':'Older snapshot','尚无上一轮记录':'No previous turn recorded',
  '当前会话每轮记录':'Turns in the selected session','每轮额度记录，可横向滚动':'Per-turn quota records; scroll horizontally','尚无本会话的额度记录':'No quota records for this session yet','5h消耗':'5h used','周额度消耗':'Weekly used','备注':'Notes','任务':'Task','含并行使用':'Includes concurrent usage','部分数据未知':'Some data unknown','已观测':'Observed',
  '跨额度恢复或校正，无法直接计算':'Cannot subtract across a reset or correction','未提供此额度':'This quota window is not provided','起止快照不完整':'Start/end snapshots are incomplete','账户额度快照差值':'Difference between account quota snapshots','官方额度刷新暂不可用，当前保留日志或上次查询快照。':'Official refresh is unavailable. Showing log data or the last query snapshot.','部分日志未能完整采集，相关轮次的消耗可能未知。':'Some logs could not be fully collected; affected turns may have unknown consumption.',
  '记录为该轮起止期间的账户额度快照差值；并行会话及其他设备可能共同消耗。0%表示未观测到百分点变化，不等于零消耗。':'Records show observed account quota differences during each turn. Concurrent sessions and other devices may contribute. 0% means no observed percentage-point change, not zero usage.',
  '5小时额度剩余':'5-hour quota remaining','额度采集中':'Collecting quota data','等待额度数据':'Waiting for quota data',
  'Codex 运行监控':'Codex Runtime Monitor','Codex 会话':'Codex session','看见活动，及时发现等待':'See activity. Understand the wait.','本机 · 只读':'Local · Read-only','语言':'Language',
  '深色':'Dark','浅色':'Light','深色模式':'Dark mode','切换到深色模式':'Switch to dark mode','切换到浅色模式':'Switch to light mode',
  '正在查看的会话':'Current session','选择 Codex 会话':'Choose a Codex session','正在查找会话…':'Finding sessions…','自动跟随最新会话':'Follow the latest session','显示内部审查会话':'Show internal review sessions','内部审查':'Internal review','内部审查已显示':'Internal reviews shown',
  '本轮任务状态':'Current task','工具与连接':'Tools & connections','Codex 流量':'Codex traffic','任务步骤':'Task steps','最近活动':'Recent activity',
  '连接中':'Connecting','本轮已用时':'Elapsed time','本轮总用时':'Total time','本轮终止前用时':'Time before stop','本轮耗时未知':'Task duration unknown','正在读取本地日志':'Reading local logs',
  '距最近活动':'Since last activity','首次回复等待':'First reply wait','日志或会话中的可识别事件':'Recognizable log or session events','从任务记录到首条回复':'From task start to the first reply','实时指标':'Live metrics',
  '计时来自已记录的任务起止事件。':'Timing uses recorded task start and end events.','计时持续更新；实际内部处理状态以可观察事件为限。':'The timer keeps updating; internal progress is limited to observable events.',
  '已记录终止事件，计时已停止。':'A stop event was recorded. The timer has stopped.','已被新一轮替代；未取得确切结束时间，耗时未知。':'A newer turn replaced this task. Its exact end time and duration are unknown.',
  '尚无完整任务起止记录，不能判断任务是否运行。':'Start/end records are incomplete. The task state cannot be confirmed.','已记录结束事件，计时已停止。':'An end event was recorded. The timer has stopped.',
  '距离最近一次可识别活动':'Since the last recognizable activity','距最后活动；本轮已结束或状态未知':'Since last activity; this turn ended or its state is unknown','已记录首条回复':'First reply recorded','仍在等待首条回复':'Waiting for the first reply','未记录首条回复':'No first reply recorded',
  '工具状态':'Tool status','最近工具耗时':'Last tool duration','未记录工具调用':'No tool call recorded','重试记录':'Retries','失败记录':'Failures','传输回退':'Transport fallbacks','本轮连接记录':'Connection records for this turn',
  '点击数字查看本轮连接记录':'Click a counter to view this turn’s connection records','时间':'Time','内容':'Details','开始时间':'Start time','耗时':'Duration','状态':'Status','模型':'Model','操作内容':'Operation',
  '时间升序 ↑':'Oldest first ↑','时间降序 ↓':'Newest first ↓','从早到晚排列，点击切换为降序':'Oldest first; click for newest first','从晚到早排列，点击切换为升序':'Newest first; click for oldest first',
  '从晚到早排列，点击切换为时间升序':'Newest first; click for oldest first',
  '运行组按开始顺序置顶':'Running groups stay on top in start order','其余记录从早到晚，点击切换为降序':'Other records are oldest first; click for newest first','其余记录从晚到早，点击切换为升序':'Other records are newest first; click for oldest first',
  '按时间从早到晚':'oldest first','按时间从晚到早':'newest first','按已知父子关系折叠，运行组按开始顺序置顶，其余记录从早到晚':'Grouped by explicit parent links; running groups on top, other records oldest first',
  '按已知父子关系折叠，运行组按开始顺序置顶，其余记录从晚到早':'Grouped by explicit parent links; running groups on top, other records newest first',
  '点击箭头展开子操作 · 运行组置顶':'Expand child operations · Running groups stay on top','点击箭头展开或折叠子操作':'Expand or collapse child operations','回到运行中 ↑':'Running tasks ↑','回到最新 ↑':'Latest ↑','回到最新 ↓':'Latest ↓','向下滚动查看更早记录':'Scroll down for earlier records',
  '折叠':'Collapse','收起':'Collapse','展开':'Expand','折叠子操作':'Collapse child operations','展开子操作':'Expand child operations',
  '运行中':'Running','已返回':'Returned','已完成':'Completed','已取消':'Cancelled','失败':'Failed','状态未知':'Unknown','状态待确认':'Unconfirmed','结束未确认':'Unconfirmed','耗时未知':'Unknown','时间未知':'Unknown','未记录耗时':'No duration recorded',
  '脚本执行环境记录中断，但外层调用缺少返回记录':'The script host recorded an interruption, but the outer call has no return record','该调用总耗时未知。':'The total duration of this call is unknown.','脚本执行环境阶段耗时：':'Script host stage duration: ',
  '结束未确认：脚本执行环境记录中断，但该调用尚未返回。Codex 可能停在等待结果的步骤。建议在 IDE 中终止当前任务，再重新发送继续指令。':'Completion unconfirmed: the script host recorded an interruption, but this call has not returned. Codex may be waiting for its result. Consider stopping the current task in the IDE, then sending a new instruction to continue.',
  '任务终止':'Task stopped','到达额度':'Usage limit reached','新对话插入':'New message inserted','手动暂停':'Manually paused','上下文超限':'Context limit reached','输出长度限制':'Output limit reached','请求超时':'Request timed out','身份验证失败':'Authentication failed','审批未通过':'Approval rejected','网络连接异常':'Network connection error','用户中断':'Interrupted','原因未知':'Unknown reason','运行错误':'Runtime error',
  '工具调用':'Tool call','组合调用':'Combined call','本地命令':'Local command','等待工具结果':'Waiting for tool results','修改文件':'File change','检索或读取资料':'Search or read sources','查看图片':'View image','读取文件':'Read file','检索资料':'Search sources',
  '任务已记录':'Task recorded','任务已完成':'Task completed','收到最终回复':'Final reply received','收到工作进度':'Progress update received','收到模型处理事件':'Model processing event received','尚未读取到活动':'No activity read yet',
  '模型处理条目的日志通知；同一 ID 的多来源记录已合并，不代表任务进度百分比。':'A model-item notification. Records with the same ID are merged; this is not a progress percentage.',
  '事件通知，无操作状态':'Event notification; no operation status','连接重试':'Connection retry','日志记录请求超时':'Request timeout recorded','日志记录请求失败':'Request failure recorded','传输回退至 HTTP':'Transport fallback to HTTP',
  '传输回退：从 WebSocket 切换到 HTTP/HTTPS':'Transport fallback: WebSocket to HTTP/HTTPS','TLS 或证书错误':'TLS or certificate error','DNS 解析失败':'DNS resolution failed','连接中断或无法建立':'Connection interrupted or could not be established','响应流断开':'Response stream disconnected',
  '模型请求体已准备；传输进度未知':'Model request body prepared; transfer progress unknown','模型接口已返回响应头':'Model endpoint returned response headers',
  '会话日志读取权限不足':'Permission denied when reading the session log','暂时无法读取会话日志':'Session log temporarily unreadable','连接日志暂不可读；会话计时仍可用':'Connection logs are unavailable; session timing remains available','连接日志读取暂缓，稍后自动重试':'Connection log read deferred; retrying automatically',
  'Codex · 代理连接':'Codex · Proxy connections','网络流量监控':'Network traffic monitor','Codex 进程':'Codex process','全部 Codex 进程':'All Codex processes','↓ 下载速率':'↓ Download rate','↑ 上传速率':'↑ Upload rate','下载':'Download','上传':'Upload',
  '流量趋势':'Traffic history','曲线图例':'Chart legend','Codex 上传下载速率曲线':'Codex upload and download rates','正在积累流量数据':'Collecting traffic data','正在启动采样':'Starting sampling',
  '仅统计已匹配到 codex.exe 的代理连接，不含其他程序。累计为已观测值；不覆盖未经过当前代理的流量。':'Only proxy connections matched to codex.exe are counted. Totals are observed values; traffic bypassing this proxy is excluded.',
  '已匹配 Codex 代理连接':'Codex proxy connections matched','监控离线，流量数据未更新':'Monitor offline; traffic data is not updating','正在识别 Codex 连接':'Identifying Codex connections','请重启监控以加载 Codex 进程采样':'Restart the monitor to load Codex process sampling',
  'Codex 进程采样暂不可用':'Codex process sampling is unavailable','Codex 连接未匹配到代理统计':'Codex connections could not be matched to proxy statistics','所选 Codex 进程的连接未匹配，速率未知':'Selected process connections are unmatched; rates are unknown',
  'Codex 流量采样已中断，正在重试':'Codex traffic sampling interrupted; retrying','部分 Codex 连接未覆盖，仅计已匹配连接':'Some Codex connections are not covered; only matched connections are counted','所选 Codex 进程已退出':'The selected Codex process has exited','未发现 codex.exe 进程':'No codex.exe process found','Codex 暂无已匹配的活动连接':'Codex has no matched active connections','正在建立 Codex 流量基线':'Establishing a Codex traffic baseline',
  'Codex 代理流量采样暂不可用，正在重试':'Codex proxy traffic sampling unavailable; retrying','Codex 连接采样组件不可读':'Codex connection sampling component is unreadable','Codex 连接识别暂不可用':'Codex connection identification unavailable','未连接本机 Mihomo 统计接口，无法统计 Codex 流量':'Local Mihomo statistics unavailable; Codex traffic cannot be measured','Codex 连接信息已过期':'Codex connection information is stale','Codex 代理统计暂不可用，正在重试':'Codex proxy statistics unavailable; retrying',
  'Codex 上传与下载速率':'Codex upload and download rates','上传和下载速率随时间变化的曲线':'Upload and download rates over time','历史暂未更新，正在重试；已读取数据仍可查看':'History is not updating; retrying. Previously read data remains available.','暂未取得可用采样':'No usable samples yet',
  '部分连接未覆盖 · 虚线连接缺失区间，非实测':'Some connections are not covered · Dashed lines bridge missing data; not measured','采样有空缺 · 两侧有数据时以虚线连接':'Missing samples · Dashed lines connect available endpoints','实线为实测 · 虚线连接缺失区间，非实测':'Solid: measured · Dashed: missing-data bridge, not measured','虚线连接缺失区间，非实测速率':'Dashed bridge across missing data; not a measured rate','仅计已匹配连接':'Only matched connections are counted','该时段未取得采样':'No sample available for this time',
  '已完成任务步骤':'Completed task steps','表示计划步骤完成情况，不代表模型思考百分比或剩余时间。':'Shows completed plan steps; not model thinking progress or time remaining.','暂无任务步骤':'No task steps','进行中 ·':'In progress ·','待开始 ·':'Pending ·',
  '仅显示事件摘要':'Event summaries only','活动表格，窄窗口可横向滚动':'Activity table; scroll horizontally in narrow windows','本轮活动记录，按时间从晚到早排列':'Activity records, newest first','正在读取…':'Reading…','暂无可识别事件':'No recognizable events',
  '连接监控服务中':'Connecting to monitor service','无活动提醒':'Inactivity alert','退出监控':'Exit monitor','监控已停止':'Monitor stopped','监控连接中断':'Monitor disconnected','监控数据已过期':'Monitor data is stale','等待会话':'Waiting for a session','监控离线':'Monitor offline','监控正常':'Monitor connected',
  '未收到新事件时，无法确认是在上传、排队还是模型处理。日志可能延迟写入；关闭此窗口不会停止后台监控，请用“退出监控”。':'Without new events, uploading, queueing and model processing cannot be distinguished. Logs may be delayed. Use “Exit monitor” to stop the background service.',
  '退出监控服务？这不会停止 Codex。':'Exit the monitor service? Codex will keep running.','监控已退出。Codex 不受影响；双击“启动监控.cmd”可重新打开。':'Monitor stopped. Codex keeps running. Open “启动监控.cmd” to restart it.','未能退出监控，请稍后重试。':'Could not exit the monitor. Please try again.',
  '监控数据已超时，正在重新连接。下方是最后一次读取的记录。':'Monitor data is stale. Reconnecting; the records below are the last successful read.','连接不到本机监控服务或读取超时。下方是最后一次读取的记录，不能代表 Codex 的最新状态。':'The local monitor is unavailable or the read timed out. Records below are the last successful read, not the latest Codex state.',
  '连接不到本机监控服务。下方是最后一次读取的记录，不能代表 Codex 的最新状态。':'Cannot reach the local monitor. Records below are the last successful read, not the latest Codex state.',
  '本轮记录过连接重试，请结合最近活动时间判断是否恢复。':'Connection retries were recorded in this turn. Check recent activity to assess recovery.','本机会话 JSONL + 只读 SQLite':'Local session JSONL + read-only SQLite','尚未发现会话':'No sessions found yet',
  '未找到可读取的 Codex 会话':'No readable Codex sessions found','任务：提问内容未获取...':'Task: prompt unavailable...'
 };
 const formats=[
  [/^任务：(.*)$/s,(_,prompt)=>'Task: '+prompt],
  [/^(\[[^\]]+\] )Codex 运行监控$/,(_,time)=>time+en['Codex 运行监控']],
  [/^连接重试（本组 (\d+)\/(\d+)）$/,(_,n,total)=>`Connection retry (batch ${n}/${total})`],
  [/^任务终止（(.+)）$/,(_,reason)=>`Task stopped (${translate(reason)})`],
  [/^（(.+)）$/,(_,reason)=>`(${translate(reason)})`],
  [/^(.+)（(运行中|尚未记录返回|调用标识缺失|结束未确认|已退出)）$/,(_,label,status)=>translate(label)+' ('+({'尚未记录返回':'return not recorded','调用标识缺失':'call ID missing','已退出':'exited'}[status]||translate(status))+')'],
  [/^(.+)(已结束|已返回)$/,(_,label,status)=>translate(label)+(status==='已结束'?' finished':' returned')],
  [/^工具 (.+)$/,(_,name)=>'Tool '+name],
  [/^本轮暂无(.+)$/,(_,kind)=>'No '+translate(kind).toLowerCase()+' in this turn'],
  [/^本轮(.+)$/,(_,kind)=>translate(kind)+' · This turn'],
  [/^(展开|折叠)(.*)的子操作$/,(_,action,label)=>translate(action)+' child operations of '+translate(label)],
  [/^(收起|展开)(.+)$/,(_,action,label)=>translate(action)+' '+translate(label)],
  [/^(.+)，按时间(从早到晚|从晚到早)$/,(_,label,order)=>translate(label)+', '+translate('按时间'+order)],
  [/^运行中，已用 (.+)$/,(_,duration)=>'Running, elapsed '+translate(duration)],
  [/^耗时 (.+)$/,(_,duration)=>'Duration '+translate(duration)],
  [/^状态：(.+)$/,(_,status)=>'Status: '+translate(status)],
  [/^原因：(.+)$/,(_,reason)=>'Reason: '+translate(reason)],
  [/^等待 ([\d.]+) (毫秒|秒)后重试$/,(_,n,unit)=>`Retry after ${n}${unit==='毫秒'?'ms':'s'}`],
  [/^HTTP 状态 (\d+)$/,(_,status)=>'HTTP status '+status],
  [/^已连续 (\d+) 秒没有新活动。可能仍在处理，也可能在等待连接；目前无法确认。$/,(_,n)=>`No new activity for ${n} seconds. Processing or a connection wait may be ongoing; the cause is unknown.`],
  [/^最近请求体 ([\d.]+) MB$/,(_,n)=>`Latest request body ${n} MB`],
  [/^已观测累计 (.+)$/,(_,value)=>'Observed total '+value],
  [/^更新 (.+)$/,(_,time)=>'Updated '+time],
  [/^最近读取 (.+)$/,(_,time)=>'Last read '+time],
  [/^已隐藏 (\d+) 个$/,(_,n)=>`${n} internal reviews hidden`],
  [/^(\d+) 条$/,(_,n)=>`${n} records`],
  [/^(\d+) 条记录$/,(_,n)=>`${n} records`],
  [/^(\d+) 条工具记录$/,(_,n)=>`${n} tool records`],
  [/^(\d+) 项子操作$/,(_,n)=>`${n} child operations`],
  [/^(\d+) 项运行中$/,(_,n)=>`${n} running`],
  [/^(\d+) 项状态待确认$/,(_,n)=>`${n} unconfirmed`],
  [/^运行中 (\d+)$/,(_,n)=>`${n} running`],
  [/^重试 (\d+)$/,(_,n)=>`Retries ${n}`],[/^失败 (\d+)$/,(_,n)=>`Failures ${n}`],[/^回退 (\d+)$/,(_,n)=>`Fallbacks ${n}`],
  [/^已完成 (\d+) \/ (\d+)$/,(_,n,total)=>`${n} / ${total} complete`],
  [/^(\d+) \/ (\d+) 已完成$/,(_,n,total)=>`${n} / ${total} complete`],
  [/^([\d.]+) (毫秒|秒|分钟)$/,(_,n,unit)=>n+({'毫秒':'ms','秒':'s','分钟':'min'}[unit])],
  [/^(?:(\d+) 小时 )?(\d+) 分 (\d+) 秒$/,(_,hours,minutes,seconds)=>(hours?hours+'h ':'')+minutes+'m '+seconds+'s'],
  [/^(?:(\d+) 时  )?(\d+) 分  ([\d.]+) 秒$/,(_,hours,minutes,seconds)=>(hours?hours+'h ':'')+minutes+'m '+seconds+'s'],
  [/^(.+)最近([\d.]+)分钟上传和下载速率，左右方向键查看采样$/,(_,scope,minutes)=>`${translate(scope)}: upload and download rates over ${minutes} minutes. Use arrow keys to inspect samples.`]
 ];
 function translate(value){
  const source=String(value??'');if(language!=='en'||!/[\u3400-\u9fff]/.test(source))return source;
  if(Object.hasOwn(en,source))return en[source];
  // A task title includes user content. Translate its prefix and preserve the prompt.
  if(source.startsWith('任务：'))return 'Task: '+source.slice(3);
  if(source.includes('\n'))return source.split('\n').map(translate).join('\n');
  if(source.includes('；'))return source.split('；').map(translate).join('; ');
  if(source.includes(' · '))return source.split(' · ').map(translate).join(' · ');
  for(const [pattern,format] of formats){const match=source.match(pattern);if(match)return format(...match);}
  return source;
 }
 function apply(){
  const doc=root.document;if(!doc)return;doc.documentElement.lang=language;
  for(const node of doc.querySelectorAll('[data-i18n]'))node.textContent=translate(node.dataset.i18n);
  for(const attr of ['title','aria-label'])for(const node of doc.querySelectorAll('[data-i18n-'+attr+']'))node.setAttribute(attr,translate(node.getAttribute('data-i18n-'+attr)));
  const select=doc.getElementById('language-select');if(select)select.value=language;
 }
 function setLanguage(value,persist=true){
  const next=valid(value);if(next===language)return;language=next;
  if(persist)try{root.localStorage?.setItem(key,language);}catch{}
  apply();root.dispatchEvent?.(new Event('codex-monitor-language-change'));
 }
 root.CodexMonitorI18n=Object.freeze({translate,apply,setLanguage,get language(){return language;},locale:()=>language==='en'?'en-GB':'zh-CN'});
 if(root.document){
  root.document.documentElement.lang=language;
  root.document.addEventListener('DOMContentLoaded',()=>{apply();root.document.getElementById('language-select')?.addEventListener('change',event=>setLanguage(event.target.value));},{once:true});
  root.addEventListener('storage',event=>{if(event.key===key||event.key===null)setLanguage(event.newValue,false);});
 }
})(globalThis);
