(function(){
  const STORAGE_KEY='theme';
  const media=window.matchMedia?.('(prefers-color-scheme: dark)');
  const COLORS={light:'#f5f7fb',dark:'#101419'};

  function normalize(v){return ['light','dark','system'].includes(v)?v:'system';}
  function resolved(v){const mode=normalize(v);return mode==='system'?(media?.matches?'dark':'light'):mode;}

  const ICONS={
    light:'<svg aria-hidden="true" class="theme-art theme-art-light" viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M19.07 4.93l-1.42 1.42M6.35 17.65l-1.42 1.42"></path></svg>',
    dark:'<svg aria-hidden="true" class="theme-art theme-art-dark" viewBox="0 0 24 24" focusable="false"><path d="M20.5 15.5A8 8 0 1 1 8.5 3.5a6.2 6.2 0 1 0 12 12Z"></path></svg>'
  };

  function normalizeControls(){
    const root=document.getElementById('theme');
    if(!root)return;
    const light=root.querySelector('[data-value="light"]');
    const dark=root.querySelector('[data-value="dark"]');
    if(light){
      light.classList.add('theme-option');
      light.innerHTML=ICONS.light;
      light.setAttribute('aria-label','Light');
    }
    if(dark){
      dark.classList.add('theme-option');
      dark.innerHTML=ICONS.dark;
      dark.setAttribute('aria-label','Dark');
    }
  }

  function applyTheme(mode){
    const m=normalize(mode),r=resolved(m);
    document.documentElement.dataset.theme=r;
    document.documentElement.dataset.themeMode=m;
    document.documentElement.style.colorScheme=r;
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.content=COLORS[r];
    normalizeControls();
    return r;
  }

  async function getTheme(){const s=await chrome.storage.local.get(STORAGE_KEY);return normalize(s[STORAGE_KEY]);}
  async function initTheme(){const mode=await getTheme();applyTheme(mode);return mode;}
  async function setTheme(mode){const m=normalize(mode);await chrome.storage.local.set({[STORAGE_KEY]:m});applyTheme(m);return m;}

  media?.addEventListener?.('change',async()=>{if((await getTheme())==='system')applyTheme('system');});

  window.CCSyncTheme={getTheme,initTheme,setTheme,applyTheme,normalizeControls};

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{normalizeControls();void initTheme();});
  else {normalizeControls();void initTheme();}
})();
