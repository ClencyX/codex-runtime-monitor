import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
function fixture(saved=null,failStorage=false){const store=new Map(saved?[['codex-monitor-language',saved]]:[]),ctx=vm.createContext({localStorage:{getItem:key=>{if(failStorage)throw Error('storage blocked');return store.get(key)||null;},setItem:(key,value)=>{if(failStorage)throw Error('storage blocked');store.set(key,value);}}});vm.runInContext(fs.readFileSync(new URL('./i18n.js',import.meta.url),'utf8'),ctx);return {i18n:ctx.CodexMonitorI18n,store};}
test('language defaults to Chinese, persists English and tolerates blocked storage',()=>{
 const {i18n,store}=fixture();assert.equal(i18n.language,'zh-CN');assert.equal(i18n.translate('工具与连接'),'工具与连接');i18n.setLanguage('en');assert.equal(store.get('codex-monitor-language'),'en');assert.equal(i18n.translate('工具与连接'),'Tools & connections');assert.equal(fixture('en').i18n.locale(),'en-GB');
 const blocked=fixture(null,true).i18n;blocked.setLanguage('en');assert.equal(blocked.translate('状态待确认'),'Unconfirmed');blocked.setLanguage('unsupported');assert.equal(blocked.language,'zh-CN');
});
test('all static UI strings have English translations',()=>{
 const {i18n}=fixture('en'),html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8'),missing=[];
 for(const match of html.matchAll(/data-i18n(?:-title|-aria-label)?="([^"]+)"/g)){const source=match[1].replaceAll('&quot;','"').replaceAll('&amp;','&');if(/[\u3400-\u9fff]/.test(i18n.translate(source)))missing.push(source);}
 assert.deepEqual([...new Set(missing)],[]);
});
test('diagnostic details, counts, durations and accessibility text are localized',()=>{
 const {i18n}=fixture('en');
 for(const source of ['进行中','检查更新','发现新版本','正在检查更新…','正在向 GitHub 查询公开版本信息…','当前版本与最新正式版一致','本地版本高于最新正式版','检查超时，请检查网络或稍后重试。','检查失败，请检查网络或稍后重试。','GitHub 请求受限，请稍后重试。','版本信息无法识别，请到发布页查看。','无法读取本地版本，请刷新页面重试。'])assert.ok(!/[\u3400-\u9fff]/.test(i18n.translate(source)),source);
 const samples=['任务终止（到达额度）','本地命令（运行中）','本地命令已结束','连接重试（本组 2/5）；原因：请求超时；等待 188 毫秒后重试','日志记录请求失败；原因：TLS 或证书错误；HTTP 状态 502','传输回退：从 WebSocket 切换到 HTTP/HTTPS','3 条记录 · 2 条工具记录 · 1 项运行中','重试 2 · 失败 0 · 回退 1','已完成 2 / 3','本轮暂无失败记录','本轮重试记录，按时间从晚到早','运行中，已用 1.1 秒','状态：任务终止（手动暂停）','全部 Codex 进程最近10分钟上传和下载速率，左右方向键查看采样','codex.exe · PID 100（已退出）','[02:03] Codex 运行监控'];
 for(const source of samples)assert.ok(!/[\u3400-\u9fff]/.test(i18n.translate(source)),source+' => '+i18n.translate(source));
 assert.equal(i18n.translate('1.1 秒'),'1.1s');assert.equal(i18n.translate('0 毫秒'),'0ms');assert.equal(i18n.translate('耗时未知'),'Unknown');
 assert.equal(i18n.translate('1 分  05.3 秒'),'1m 05.3s');assert.equal(i18n.translate('1 时  02 分  05.3 秒'),'1h 02m 05.3s');
 assert.equal(i18n.translate('运行中，已用 1 时  02 分  05.3 秒'),'Running, elapsed 1h 02m 05.3s');
 for(const [source,label] of [['543 毫秒','543ms'],['39 秒','39s'],['3 分 15 秒','3m 15s'],['1 小时 5 分 39 秒','1h 5m 39s'],['1 小时 0 分 39 秒','1h 0m 39s']]){
  assert.equal(i18n.translate(source),label);assert.equal(i18n.translate('运行中，已用 '+source),'Running, elapsed '+label);assert.equal(i18n.translate('耗时 '+source),'Duration '+label);
  i18n.setLanguage('zh-CN');assert.equal(i18n.translate(source),source);i18n.setLanguage('en');assert.equal(i18n.translate(source),label);
 }
 for(const clock of ['1 : 39.543','21 : 39.543','1 : 05 : 39.543','1 : 00 : 39.543','0 : 39.543','0 : 0.543']){
  assert.equal(i18n.translate(clock),clock);assert.equal(i18n.translate('运行中，已用 '+clock),'Running, elapsed '+clock);assert.equal(i18n.translate('耗时 '+clock),'Duration '+clock);
 }
});
test('user prompt text and unknown identifiers remain unchanged',()=>{
 const {i18n}=fixture('en'),prompt='修改文件 · 请求超时；不要翻译我的标题';
 assert.equal(i18n.translate('任务：'+prompt),'Task: '+prompt);assert.equal(i18n.translate('My session 42'),'My session 42');assert.equal(i18n.translate('<script>sample</script>'),'<script>sample</script>');
 i18n.setLanguage('zh-CN');assert.equal(i18n.translate('任务：'+prompt),'任务：'+prompt);
});
