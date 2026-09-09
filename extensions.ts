const { request, storageGet } = CCSyncRuntime;

const $ = id => document.getElementById(id);
const dict = {
  en: {
    extensionRecoveryTitle: 'Extension Recovery',
    extensionRecoverySubtitle: 'Find missing extensions and restore the browser environment.',
    refresh: 'Refresh',
    loading: 'Loading…',
    missingExtensionsTitle: 'Missing extensions',
    missingExtensionsDesc: 'These extensions exist in the cloud snapshot but are not installed on this browser.',
    recoveryPolicyTitle: 'Recovery policy',
    recoveryPolicyBody: 'Chromium Cloud Sync records extension metadata and identifies missing extensions. Store installation stays a user action. Third-party CRX / ZIP packages are handled separately by the configured package-backup backend.',
    recoveryPolicyNote: 'The recovery center never writes into third-party extension storage and never synchronizes third-party extension settings.',
    packageRecoveryTitle: 'Package recovery',
    packageRecoveryBody: 'For extensions that are not available from a browser store, use the package-backup controls in Settings to download a stored CRX / ZIP file.',
    openSettings: 'Open Settings',
    noMissing: 'No missing extensions. This browser matches the cloud extension inventory.',
    remoteUnavailable: 'Unable to read the cloud extension inventory.',
    count: '{count} missing extension(s)',
    openChrome: 'Chrome Web Store',
    openEdge: 'Microsoft Edge Add-ons',
    openHomepage: 'Extension homepage',
    copyId: 'Copy ID',
    copied: 'Copied',
    unknownSource: 'No verified store link',
    id: 'ID',
    version: 'Cloud version',
    installType: 'Cloud install type',
    packageHint: 'A private package backup may be available in Settings.',
  },
  'zh-CN': {
    extensionRecoveryTitle: '扩展恢复中心',
    extensionRecoverySubtitle: '检查缺失扩展，并恢复当前浏览器环境。',
    refresh: '刷新',
    loading: '正在加载…',
    missingExtensionsTitle: '缺失的扩展',
    missingExtensionsDesc: '这些扩展存在于云端快照中，但当前浏览器尚未安装。',
    recoveryPolicyTitle: '恢复策略',
    recoveryPolicyBody: 'Chromium Cloud Sync 只记录扩展元数据并负责发现缺失扩展。商店安装始终由用户确认；第三方 CRX / ZIP 文件则由单独配置的扩展包备份后端负责。',
    recoveryPolicyNote: '恢复中心不会写入第三方扩展的内部存储，也不会同步第三方扩展设置。',
    packageRecoveryTitle: '扩展包恢复',
    packageRecoveryBody: '对于无法从浏览器商店获取的扩展，可以在“设置”中的第三方扩展文件存储区域下载已经备份的 CRX / ZIP 文件。',
    openSettings: '打开设置',
    noMissing: '没有缺失扩展。当前浏览器与云端扩展清单一致。',
    remoteUnavailable: '无法读取云端扩展清单。',
    count: '缺失 {count} 个扩展',
    openChrome: 'Chrome 网上应用店',
    openEdge: 'Microsoft Edge 加载项',
    openHomepage: '扩展主页',
    copyId: '复制 ID',
    copied: '已复制',
    unknownSource: '没有可验证的商店链接',
    id: 'ID',
    version: '云端版本',
    installType: '云端安装类型',
    packageHint: '可以在“设置”中检查是否存在私人扩展包备份。',
  },
};

function lang() {
  const value = document.documentElement.lang || navigator.language || 'en';
  return /^zh(?:[-_]|$)/i.test(value) ? 'zh-CN' : 'en';
}
function t(key, vars = {}) {
  const value = dict[lang()]?.[key] ?? dict.en[key] ?? key;
  return String(value).replace(/\{(\w+)\}/g, (_m, k) => vars[k] ?? '');
}
function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}
function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.setAttribute('aria-busy', String(busy));
}

async function copyText(value, button) {
  try {
    await navigator.clipboard.writeText(value);
    const old = button.textContent;
    button.textContent = t('copied');
    setTimeout(() => { button.textContent = old; }, 1200);
  } catch (error) {
    console.warn('Copy failed', error);
  }
}

function storeAction(ext) {
  const source = ext?.store?.source;
  if (source === 'edge' && ext.store.edgeUrl) return { url: ext.store.edgeUrl, label: t('openEdge') };
  if (source === 'chrome' && ext.store.chromeUrl) return { url: ext.store.chromeUrl, label: t('openChrome') };
  if (ext.homepageUrl && /^https?:\/\//i.test(ext.homepageUrl)) return { url: ext.homepageUrl, label: t('openHomepage') };
  return null;
}

function render(data) {
  const list = $('missingList');
  const summary = $('summary');
  if (!list || !summary) return;
  list.replaceChildren();

  if (data.remoteUnavailable) {
    summary.className = 'status-box error-copy';
    summary.textContent = `${t('remoteUnavailable')} ${data.errorMessage || ''}`.trim();
    return;
  }

  const missing = Array.isArray(data.missing) ? data.missing : [];
  summary.className = missing.length ? 'status-box' : 'status-box success-copy';
  summary.textContent = missing.length ? t('count', { count: missing.length }) : t('noMissing');

  if (!missing.length) return;

  for (const ext of missing) {
    const row = document.createElement('div');
    row.className = 'history-row extension-recovery-row';

    const main = document.createElement('div');
    main.className = 'history-main';

    const title = document.createElement('div');
    title.className = 'history-title';
    title.textContent = ext.name || ext.id;

    const meta = document.createElement('div');
    meta.className = 'history-meta';
    meta.textContent = `${t('version')}: v${ext.version || '?'} · ${t('installType')}: ${ext.installType || 'unknown'} · ${t('id')}: ${ext.id}`;

    main.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'extension-recovery-actions';

    const install = storeAction(ext);
    if (install) {
      const link = document.createElement('a');
      link.className = 'secondary';
      link.href = install.url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = install.label;
      actions.append(link);
    }

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'secondary';
    copy.textContent = t('copyId');
    copy.addEventListener('click', () => void copyText(ext.id, copy));
    actions.append(copy);

    if (!install) {
      const note = document.createElement('span');
      note.className = 'muted small';
      note.textContent = t('unknownSource');
      actions.append(note);
    }

    row.append(main, actions);
    list.append(row);
  }

  const note = document.createElement('p');
  note.className = 'extension-recovery-note muted small';
  note.textContent = t('packageHint');
  list.append(note);
}

async function refresh() {
  const button = $('refresh');
  setBusy(button, true);
  try {
    render({ remoteUnavailable: false, missing: [], remote: [] });
    const result = await request('missingExtensions');
    render(result);
  } catch (error) {
    render({ remoteUnavailable: true, errorMessage: error?.message || String(error) });
  } finally {
    setBusy(button, false);
  }
}

function setupChoiceSwitch(root, initialValue, onChange) {
  if (!root) return;
  const buttons = [...root.querySelectorAll('.choice-switch-option')];
  const set = value => {
    root.dataset.active = (value === 'en' || value === 'dark') ? 'right' : 'left';
    buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.value === value)));
  };
  set(initialValue);
  buttons.forEach(button => button.addEventListener('click', async () => {
    const value = button.dataset.value;
    await onChange(value);
    set(value);
  }));
}

function applyText() {
  document.documentElement.lang = lang();
  document.querySelectorAll('[data-i18n]').forEach(node => {
    const key = node.dataset.i18n;
    if (dict[lang()]?.[key]) node.textContent = dict[lang()][key];
  });
  $('refresh')?.setAttribute('aria-label', t('refresh'));
}

(async () => {
  try {
    const saved = await storageGet(['language']);
    const language = saved.language && saved.language !== 'auto' ? saved.language : (navigator.language.startsWith('zh') ? 'zh-CN' : 'en');
    const languageRoot = $('language');
    setupChoiceSwitch(languageRoot, language, async value => {
      await storageSetSafe({ language: value });
      document.documentElement.lang = value;
      applyText();
      await refresh();
    });
    if (window.CCSyncTheme) {
      await CCSyncTheme.initTheme();
      const current = await CCSyncTheme.getTheme();
      setupChoiceSwitch($('theme'), current === 'dark' || current === 'light' ? current : 'light', async value => CCSyncTheme.setTheme(value));
    }
    applyText();
    $('refresh')?.addEventListener('click', () => void refresh());
    $('openSettings')?.addEventListener('click', () => chrome.runtime.openOptionsPage());
    await refresh();
  } catch (error) {
    render({ remoteUnavailable: true, errorMessage: error?.message || String(error) });
  }
})();

async function storageSetSafe(value) {
  try {
    await chrome.storage.local.set(value);
  } catch (error) {
    console.warn('Could not save local UI preference', error);
  }
}
