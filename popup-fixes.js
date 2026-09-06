(() => {
  const $ = id => document.getElementById(id);

  function formatStatusMeta() {
    const meta = $('statusMeta');
    if (!meta) return;

    const text = meta.textContent || '';
    const parts = text.split(/\s*·\s*/).map(part => part.trim()).filter(Boolean);
    if (!parts.length) return;

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

  function openExtensionRecoveryCenter() {
    chrome.tabs.create({ url: chrome.runtime.getURL('extensions.html') });
  }

  function interceptExtensionButton(event) {
    const button = event.target?.closest?.('#checkExtensions');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openExtensionRecoveryCenter();
  }

  function init() {
    formatStatusMeta();

    const meta = $('statusMeta');
    if (meta) {
      const observer = new MutationObserver(formatStatusMeta);
      observer.observe(meta, { childList: true, characterData: true, subtree: true });
    }

    document.addEventListener('click', interceptExtensionButton, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
