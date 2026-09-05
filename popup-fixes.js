(() => {
  const $ = id => document.getElementById(id);

  function formatStatusMeta() {
    const meta = $('statusMeta');
    if (!meta) return;

    const text = meta.textContent || '';
    const parts = text.split(/\s*·\s*/).map(part => part.trim()).filter(Boolean);
    if (!parts.length) return;

    // Build explicit line breaks instead of relying on whitespace CSS.
    const current = parts.join('\n');
    if (meta.dataset.ccsFormatted === current) return;

    meta.replaceChildren();
    parts.forEach((part, index) => {
      if (index) meta.appendChild(document.createElement('br'));
      meta.appendChild(document.createTextNode(part));
    });
    meta.dataset.ccsFormatted = current;
    meta.style.whiteSpace = 'normal';
    meta.style.lineHeight = '1.55';
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
      const observer = new MutationObserver(() => {
        formatStatusMeta();
      });
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
