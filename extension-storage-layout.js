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

  const hideField=id=>{
    const el=$(id);
    const field=el?.closest?.('.field-label');
    if(field)field.hidden=true;
  };

  const showField=id=>{
    const el=$(id);
    const field=el?.closest?.('.field-label');
    if(field)field.hidden=false;
  };

  function syncVisibility(){
    const backend=$('extensionStorageBackend');
    if(!backend)return;

    const mode=backend.value;
    const activeGithub=mode==='github';
    const activeWebdav=mode==='webdav';
    const activeStorage=activeGithub||activeWebdav;

    // The backend selector is always visible.
    showField('extensionStorageBackend');

    // GitHub-only fields.
    for(const id of ['extensionStorageGithubRepo','extensionStorageGithubBranch','extensionStorageGithubFolder']){
      (activeGithub?showField:hideField)(id);
    }

    // WebDAV-only fields.
    for(const id of ['extensionStorageWebdavUrl','extensionStorageWebdavFolder','extensionStorageWebdavUsername','extensionStorageWebdavPassword']){
      (activeWebdav?showField:hideField)(id);
    }

    // Explanatory text, connection controls and result status are only useful
    // when an actual storage backend is enabled.
    const note=$('extensionStorageSettings')?.querySelector('.extension-storage-note');
    const actions=$('extensionStorageSettings')?.querySelector('.extension-storage-actions');
    const status=$('extensionStorageSettingsStatus');
    if(note)note.hidden=!activeStorage;
    if(actions)actions.hidden=!activeStorage;
    if(status&&!activeStorage)status.hidden=true;
  }

  function move(){
    const host=$('extensionStorageHost'),card=$('extensionStorageSettings');
    if(host&&card&&card.parentElement!==host){
      card.classList.add('extension-storage-detached');
      host.append(card);
      requestAnimationFrame(()=>card.classList.remove('extension-storage-detached'));
    }
    labels();
    syncVisibility();
    return !!(host&&card);
  }

  function bindBackendChange(){
    const backend=$('extensionStorageBackend');
    if(!backend||backend.dataset.layoutBound==='true')return;
    backend.dataset.layoutBound='true';
    backend.addEventListener('change',syncVisibility);
    syncVisibility();
  }

  function init(){
    labels();
    if(move()){
      bindBackendChange();
      return;
    }

    const observer=new MutationObserver(()=>{
      if(move()){
        bindBackendChange();
        observer.disconnect();
      }
    });
    observer.observe(document.body,{childList:true,subtree:true});

    const langObserver=new MutationObserver(labels);
    langObserver.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
