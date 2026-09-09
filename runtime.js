(() => {
  const DEFAULT_TIMEOUT = 30000;

  function request(type, extra = {}, timeout = DEFAULT_TIMEOUT) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`Request timed out: ${type}`));
      }, timeout);

      const finish = (error, response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      };

      try {
        chrome.runtime.sendMessage({ type, ...extra }, response => {
          const lastError = chrome.runtime.lastError;
          if (lastError) {
            finish(new Error(lastError.message || `Runtime request failed: ${type}`));
            return;
          }
          finish(null, response);
        });
      } catch (error) {
        finish(error);
      }
    });
  }

  function storageGet(keys) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(keys, value => {
          const lastError = chrome.runtime.lastError;
          if (lastError) reject(new Error(lastError.message));
          else resolve(value || {});
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function storageSet(value) {
    return new Promise((resolve, reject) => {
      try {
        chrome.storage.local.set(value, () => {
          const lastError = chrome.runtime.lastError;
          if (lastError) reject(new Error(lastError.message));
          else resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function bindAction(id, handler) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`UI contract violation: missing #${id}`);
    element.type = 'button';
    element.addEventListener('click', event => {
      // DOM event listeners do not await returned Promises. Always consume
      // handler rejections so API failures cannot become silent "dead buttons".
      Promise.resolve()
        .then(() => handler(event, element))
        .catch(error => {
          console.error(`[Chromium Cloud Sync] action failed: ${id}`, error);
          window.dispatchEvent(new CustomEvent('ccsync:action-error', {
            detail: { id, error }
          }));
        });
    });
    return element;
  }

  window.CCSyncRuntime = { request, storageGet, storageSet, bindAction };
})();
