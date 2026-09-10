(function(){
  const STORAGE_KEY='theme';
  const media=window.matchMedia?.('(prefers-color-scheme: dark)');
  const COLORS={light:'#f5f7fb',dark:'#101419'};
  const ICONS={
    light:'<svg aria-hidden="true" class="theme-art theme-art-light" viewBox="0 0 24 24" focusable="false"><circle class="theme-sun-core" cx="12" cy="12" r="4.15"></circle><path class="theme-sun-rays" d="M12 2.35v2.1M12 19.55v2.1M2.35 12h2.1M19.55 12h2.1M5.18 5.18l1.48 1.48M17.34 17.34l1.48 1.48M18.82 5.18l-1.48 1.48M6.66 17.34l-1.48 1.48"></path></svg>',
    dark:'<svg aria-hidden="true" class="theme-art theme-art-dark" viewBox="0 0 24 24" focusable="false"><path class="theme-moon-shape" d="M19.7 14.65a7.85 7.85 0 1 1-10.35-10.35 7.95 7.95 0 0 0 10.35 10.35Z"></path></svg>'
  };
  const STYLE_ID='ccsThemeControlStyles';

  function normalize(v){return ['light','dark','system'].includes(v)?v:'system';}
  function resolved(v){const mode=normalize(v);return mode==='system'?(media?.matches?'dark':'light'):mode;}

  function injectStyles(){
    if(document.getElementById(STYLE_ID))return;
    const style=document.createElement('style');
    style.id=STYLE_ID;
    style.textContent=`
      .theme-switch{min-width:82px!important;height:38px!important;padding:3px!important;background:color-mix(in srgb,var(--surface) 92%,var(--surface-2))!important;box-shadow:0 2px 10px rgba(16,24,40,.08)!important;transition:background-color .24s ease,border-color .24s ease,box-shadow .24s ease!important;overflow:hidden}
      .theme-switch .choice-switch-thumb{top:3px!important;left:3px!important;width:calc(50% - 3px)!important;height:30px!important;background:var(--accent-soft)!important;box-shadow:0 2px 8px rgba(49,94,251,.18)!important;transition:transform .3s cubic-bezier(.22,1,.36,1),background-color .24s ease,box-shadow .24s ease!important}
      .theme-switch .choice-switch-option{height:30px!important;padding:0!important;color:var(--text-3)!important;transition:color .22s ease,transform .3s cubic-bezier(.22,1,.36,1)!important}
      .theme-switch .choice-switch-option[aria-pressed="true"]{color:var(--accent)!important}
      .theme-switch .choice-switch-option:active{transform:scale(.9)}
      .theme-switch .theme-art{width:24px!important;height:24px!important;display:block;overflow:visible;transform-origin:50% 50%;transition:transform .3s cubic-bezier(.22,1,.36,1),opacity .2s ease}
      .theme-switch .theme-option[aria-pressed="true"] .theme-art{transform:scale(1.08)}
      .theme-switch .theme-option:not([aria-pressed="true"]){opacity:.62}
      .theme-switch .theme-art-light{color:#c68a00}
      .theme-switch .theme-sun-core{fill:#ffd65a;stroke:#c68a00;stroke-width:1.15}
      .theme-switch .theme-sun-rays{fill:none;stroke:#c68a00;stroke-width:1.45;stroke-linecap:round}
      .theme-switch .theme-art-dark{color:#d7e3ff}
      .theme-switch .theme-moon-shape{fill:#dce7ff;stroke:#8fa7d2;stroke-width:1.05}
      .theme-switch.theme-animating .theme-art-light,.theme-switch.theme-animating .theme-art-dark{animation:ccsThemeIconPulse .38s cubic-bezier(.22,1,.36,1)}
      @keyframes ccsThemeIconPulse{0%{opacity:.45;transform:scale(.72) rotate(-12deg)}55%{opacity:1;transform:scale(1.16) rotate(4deg)}100%{opacity:1;transform:scale(1.08) rotate(0)}}
      @media(prefers-reduced-motion:reduce){.theme-switch,.theme-switch .choice-switch-thumb,.theme-switch .choice-switch-option,.theme-switch .theme-art{transition:none!important}.theme-switch.theme-animating .theme-art-light,.theme-switch.theme-animating .theme-art-dark{animation:none!important}}
    `;
    document.head.appendChild(style);
  }

  function normalizeControls(){
    const root=document.getElementById('theme');
    if(!root)return;
    root.classList.add('theme-switch');
    const light=root.querySelector('[data-value="light"]');
    const dark=root.querySelector('[data-value="dark"]');
    if(light){
      light.classList.add('theme-option');
      light.innerHTML=ICONS.light;
      const label=window.CCSyncI18n?.currentLanguage?.()==='zh-CN'?'浅色':'Light';
      light.setAttribute('aria-label',label);light.setAttribute('title',label);
    }
    if(dark){
      dark.classList.add('theme-option');
      dark.innerHTML=ICONS.dark;
      const label=window.CCSyncI18n?.currentLanguage?.()==='zh-CN'?'深色':'Dark';
      dark.setAttribute('aria-label',label);dark.setAttribute('title',label);
    }
  }

  function animate(){
    const root=document.getElementById('theme');
    if(!root||window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;
    root.classList.remove('theme-animating');
    void root.offsetWidth;
    root.classList.add('theme-animating');
    window.setTimeout(()=>root.classList.remove('theme-animating'),400);
  }

  function applyTheme(mode){
    const m=normalize(mode),r=resolved(m);
    document.documentElement.dataset.theme=r;
    document.documentElement.dataset.themeMode=m;
    document.documentElement.style.colorScheme=r;
    const meta=document.querySelector('meta[name="theme-color"]');
    if(meta)meta.content=COLORS[r];
    injectStyles();
    normalizeControls();
    return r;
  }

  async function getTheme(){const s=await chrome.storage.local.get(STORAGE_KEY);return normalize(s[STORAGE_KEY]);}
  async function initTheme(){injectStyles();normalizeControls();const mode=await getTheme();applyTheme(mode);return mode;}
  async function setTheme(mode){const m=normalize(mode);await chrome.storage.local.set({[STORAGE_KEY]:m});applyTheme(m);animate();return m;}

  media?.addEventListener?.('change',async()=>{if((await getTheme())==='system')applyTheme('system');});

  window.CCSyncTheme={getTheme,initTheme,setTheme,applyTheme,normalizeControls};

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{injectStyles();normalizeControls();void initTheme();});
  else {injectStyles();normalizeControls();void initTheme();}
})();
