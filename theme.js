(function(){
  const STORAGE_KEY='theme';
  const media=window.matchMedia?.('(prefers-color-scheme: dark)');
  const COLORS={light:'#f5f7fb',dark:'#101419'};
  function normalize(v){return ['light','dark','system'].includes(v)?v:'system';}
  function resolved(v){const mode=normalize(v);return mode==='system'?(media?.matches?'dark':'light'):mode;}
  function applyTheme(mode){const m=normalize(mode),r=resolved(m);document.documentElement.dataset.theme=r;document.documentElement.dataset.themeMode=m;document.documentElement.style.colorScheme=r;const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=COLORS[r];return r;}
  async function getTheme(){const s=await chrome.storage.local.get(STORAGE_KEY);return normalize(s[STORAGE_KEY]);}
  async function initTheme(){const mode=await getTheme();applyTheme(mode);return mode;}
  async function setTheme(mode){const m=normalize(mode);await chrome.storage.local.set({[STORAGE_KEY]:m});applyTheme(m);return m;}
  media?.addEventListener?.('change',async()=>{if((await getTheme())==='system')applyTheme('system');});
  window.CCSyncTheme={getTheme,initTheme,setTheme,applyTheme};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>initTheme());else initTheme();
})();
