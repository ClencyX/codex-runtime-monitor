// Apply before styles paint, then wire the button after the document is ready.
(()=>{
 const key='codex-monitor-theme',system=window.matchMedia('(prefers-color-scheme: dark)');
 const valid=value=>value==='dark'||value==='light'?value:null;
 let preference=null;
 try{preference=valid(localStorage.getItem(key));}catch{}
 function apply(theme){
  document.documentElement.dataset.theme=theme;
  const button=document.getElementById('theme-toggle');
  const t=value=>globalThis.CodexMonitorI18n?.translate(value)||value;
  if(button){button.setAttribute('aria-pressed',String(theme==='dark'));button.setAttribute('aria-label',t(theme==='dark'?'切换到浅色模式':'切换到深色模式'));button.title=t(theme==='dark'?'切换到浅色模式':'切换到深色模式');document.getElementById('theme-label').textContent=t(theme==='dark'?'浅色':'深色');}
 }
 function effective(){return preference||(system.matches?'dark':'light');}
 apply(effective());
 document.addEventListener('DOMContentLoaded',()=>{
  apply(effective());
  document.getElementById('theme-toggle')?.addEventListener('click',()=>{
   preference=document.documentElement.dataset.theme==='dark'?'light':'dark';
   try{localStorage.setItem(key,preference);}catch{}
   apply(preference);
  });
 },{once:true});
 system.addEventListener('change',()=>{if(!preference)apply(effective());});
 window.addEventListener('codex-monitor-language-change',()=>apply(effective()));
 window.addEventListener('storage',event=>{if(event.key===key||event.key===null){preference=valid(event.newValue);apply(effective());}});
})();
