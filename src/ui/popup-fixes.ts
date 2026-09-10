(() => {
  const $ = id => document.getElementById(id);

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
    document.addEventListener('click', interceptExtensionButton, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
