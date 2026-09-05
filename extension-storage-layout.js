(function(){
  const $=id=>document.getElementById(id);
  const zh=()=>window.CCSyncI18n?.currentLanguage?.()==='zh-CN'||document.documentElement.lang==='zh-CN';
  const labels=()=>{
    const isZh=zh();
    const items=[
      [$('extensionStorageNavLabel'),isZh?'第三方扩展':'Third-party extensions'],
      [$('extensionStoragePanelTitle'),isZh?'第三方扩展文件存储':'Third-party extension file storage'],
      [$('extensionStoragePanelDescription'),isZh?'用于备份和管理第三方扩展的 CRX / ZIP 文件，并与同步数据分离。':'Back up and manage third-party CRX / ZIP packages separately from the sync database.']
    ];
    for(const [el,text] of items){
      if(el&&el.textContent!==text)el.textContent=text;
    }
  };
  function move(){
    const host=$('extensionStorageHost'),card=$('extensionStorageSettings');
    if(host&&card&&card.parentElement!==host){
      card.classList.add('extension-storage-detached');
      host.append(card);
      requestAnimationFrame(()=>card.classList.remove('extension-storage-detached'));
    }
    labels();
    return !!(host&&card);
  }
  function init(){
    labels();
    if(move())return;

    const observer=new MutationObserver(()=>{
      if(move())observer.disconnect();
    });
    observer.observe(document.body,{childList:true,subtree:true});

    const langObserver=new MutationObserver(labels);
    langObserver.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
