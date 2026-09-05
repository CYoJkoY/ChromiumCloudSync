(function(){
  const $=id=>document.getElementById(id);
  const zh=()=>window.CCSyncI18n?.currentLanguage?.()==='zh-CN'||document.documentElement.lang==='zh-CN';
  const labels=()=>{
    const isZh=zh();
    const nav=$('extensionStorageNavLabel'),title=$('extensionStoragePanelTitle'),desc=$('extensionStoragePanelDescription');
    if(nav)nav.textContent=isZh?'第三方扩展': 'Third-party extensions';
    if(title)title.textContent=isZh?'第三方扩展文件存储':'Third-party extension file storage';
    if(desc)desc.textContent=isZh?'用于备份和管理第三方扩展的 CRX / ZIP 文件，并与同步数据分离。':'Back up and manage third-party CRX / ZIP packages separately from the sync database.';
  };
  function move(){
    const host=$('extensionStorageHost'),card=$('extensionStorageSettings');
    if(host&&card&&card.parentElement!==host){
      card.classList.add('extension-storage-detached');
      host.append(card);
      requestAnimationFrame(()=>card.classList.remove('extension-storage-detached'));
    }
    labels();
  }
  function init(){
    labels();
    move();
    const observer=new MutationObserver(move);
    observer.observe(document.body,{childList:true,subtree:true});
    const langObserver=new MutationObserver(labels);
    langObserver.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
