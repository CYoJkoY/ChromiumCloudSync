(() => {
  const list = document.getElementById('extensionBackupList');
  if (!list) return;
  let internal = false;
  let timer = 0;
  const rerender = () => {
    if (internal || !window.CCSyncExtensionStorage?.renderPopup) return;
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (internal) return;
      internal = true;
      try { await window.CCSyncExtensionStorage.renderPopup(); } catch (error) { console.debug('Extension backup UI refresh failed:', error); }
      queueMicrotask(() => { internal = false; });
    }, 0);
  };
  new MutationObserver(rerender).observe(list, { childList: true, subtree: true });
})();
