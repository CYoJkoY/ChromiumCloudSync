(function(){
  const $=id=>document.getElementById(id);
  const dict={
    en:{download:'Download CRX',release:'View release',check:'Check for updates',language:'Language',theme:'Theme',light:'Light',dark:'Dark'},
    'zh-CN':{download:'下载 CRX',release:'查看发布页',check:'检查更新',language:'语言',theme:'主题',light:'浅色',dark:'深色'}
  };
  const lang=()=>window.CCSyncI18n?.currentLanguage?.()||(/^zh/i.test(navigator.language||'')?'zh-CN':'en');
  function apply(){const d=dict[lang()]||dict.en;const map=[['updateDownload','download'],['updateRelease','release'],['checkUpdates','check']];for(const [id,key] of map){const el=$(id);if(el&&!el.dataset.updateManaged)el.textContent=d[key];}
    const l=$('language'),th=$('theme');if(l)l.setAttribute('aria-label',d.language);if(th)th.setAttribute('aria-label',d.theme);
    document.querySelectorAll('#theme .theme-option').forEach(b=>b.setAttribute('aria-label',b.dataset.value==='dark'?d.dark:d.light));
  }
  window.CCSyncPopupI18n={apply};
  document.addEventListener('DOMContentLoaded',apply);
  new MutationObserver(()=>apply()).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
})();
