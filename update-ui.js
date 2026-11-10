(function(root){
 'use strict';
 const $=id=>root.document.getElementById(id),I=root.CodexMonitorI18n,t=I.translate;
 let version='—',result=null,busy=false,versionKnown=false;
 function render(){
  $('app-version').textContent=t('当前版本')+' · '+version;
  $('update-check').textContent=t(busy?'正在检查更新…':'检查更新');$('update-check').disabled=busy||!versionKnown;
  const status=$('update-status'),details=$('update-details');
  status.textContent='';delete status.dataset.state;details.hidden=true;$('update-result').hidden=!result&&!busy;
  if(busy){status.textContent=t('正在向 GitHub 查询公开版本信息…');return;}
  if(!result)return;
  if(!result.ok){status.textContent=t({'timeout':'检查超时，请检查网络或稍后重试。','rate-limit':'GitHub 请求受限，请稍后重试。','invalid':'版本信息无法识别，请到发布页查看。','version':'无法读取本地版本，请刷新页面重试。'}[result.error]||'检查失败，请检查网络或稍后重试。');status.dataset.state='error';return;}
  status.dataset.state=result.comparison>0?'new':'current';
  status.textContent=t(result.comparison>0?'发现新版本':result.comparison===0?'当前版本与最新正式版一致':'本地版本高于最新正式版')+' · '+result.latest;
  $('update-published').textContent=t('发布日期')+' · '+new Date(result.publishedAt).toLocaleDateString(I.locale());
  $('update-link').href=result.url;details.hidden=false;
 }
 $('update-check').addEventListener('click',async()=>{
  if(busy)return;busy=true;render();
  try{const response=await fetch('/api/update/check',{method:'POST',headers:{'X-Monitor-Action':'check-update'},signal:AbortSignal.timeout(11000)});if(!response.ok)throw Error();result=await response.json();}
  catch{result={ok:false,error:'unavailable'};}finally{busy=false;render();}
 });
 root.addEventListener('codex-monitor-language-change',render);
 fetch('/api/version',{cache:'no-store',signal:AbortSignal.timeout(4500)}).then(response=>{if(!response.ok)throw Error();return response.json();}).then(data=>{if(typeof data.version!=='string'||!/^\d+\.\d+\.\d+$/.test(data.version))throw Error();version='v'+data.version;versionKnown=true;render();}).catch(()=>{result={ok:false,error:'version'};render();});
 render();
})(globalThis);
