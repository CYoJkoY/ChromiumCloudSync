(() => {
  const $ = id => document.getElementById(id);

  function formatStatusMeta() {
    const meta = $('statusMeta');
    if (!meta) return;
    meta.style.whiteSpace = 'pre-line';
    const text = meta.textContent || '';
    const normalized = text
      .replace(/\s*·\s*/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
    if (normalized && normalized !== text) meta.textContent = normalized;
  }

  async function syncBackupCardVisibility() {
    const card = $('extensionBackupCard');
    if (!card) return;
    try {
      const s = await chrome.storage.local.get(['extensionBackupBackend']);
      const enabled = s.extensionBackupBackend === 'github' || s.extensionBackupBackend === 'webdav';
      card.hidden = !enabled;
    } catch {
      card.hidden = true;
    }
  }

  function init() {
    formatStatusMeta();
    syncBackupCardVisibility();

    const meta = $('statusMeta');
    if (meta) {
      const observer = new MutationObserver(formatStatusMeta);
      observer.observe(meta, { childList: true, characterData: true, subtree: true });
    }

    chrome.storage?.onChanged?.addListener((changes, area) => {
      if (area !== 'local' || !changes.extensionBackupBackend) return;
      syncBackupCardVisibility();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
