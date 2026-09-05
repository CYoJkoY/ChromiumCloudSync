(function(){
  const STORAGE_KEY='theme';
  const media=window.matchMedia?.('(prefers-color-scheme: dark)');
  const COLORS={light:'#f5f7fb',dark:'#101419'};
  const UI_REFINEMENT='ui-overrides.css';
  function ensureRefinedStyles(){
    if(document.querySelector(`link[data-ccsync-style="${UI_REFINEMENT}"]`))return;
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href=UI_REFINEMENT;
    link.dataset.ccsyncStyle=UI_REFINEMENT;
    document.head.appendChild(link);
  }
  function normalize(v){return ['light','dark','system'].includes(v)?v:'system';}
  function resolved(v){const mode=normalize(v);return mode==='system'?(media?.matches?'dark':'light'):mode;}
  function applyTheme(mode){const m=normalize(mode),r=resolved(m);document.documentElement.dataset.theme=r;document.documentElement.dataset.themeMode=m;document.documentElement.style.colorScheme=r;const meta=document.querySelector('meta[name="theme-color"]');if(meta)meta.content=COLORS[r];return r;}
  async function getTheme(){const s=await chrome.storage.local.get(STORAGE_KEY);return normalize(s[STORAGE_KEY]);}
  async function initTheme(){ensureRefinedStyles();const mode=await getTheme();applyTheme(mode);return mode;}
  async function setTheme(mode){ensureRefinedStyles();const m=normalize(mode);await chrome.storage.local.set({[STORAGE_KEY]:m});applyTheme(m);return m;}
  media?.addEventListener?.('change',async()=>{if((await getTheme())==='system')applyTheme('system');});
  window.CCSyncTheme={getTheme,initTheme,setTheme,applyTheme,ensureRefinedStyles};
  ensureRefinedStyles();
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>initTheme());else initTheme();
})();
