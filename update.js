const REPO_API = 'https://api.github.com/repos/CYoJkoY/ChromiumCloudSync/releases/latest';
const REPO_URL = 'https://github.com/CYoJkoY/ChromiumCloudSync';
const UPDATE_CHECK_TIMEOUT_MS = 8000;
const UPDATE_CACHE_KEY = 'releaseUpdateInfo';
const UPDATE_CHECK_KEY = 'releaseUpdateLastCheckedAt';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const $u = id => document.getElementById(id);

function parseVersion(value) {
  const match = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function compareVersions(a, b) {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  if (!av || !bv) return 0;
  for (let index = 0; index < 3; index += 1) {
    if (av[index] !== bv[index]) return av[index] > bv[index] ? 1 : -1;
  }
  return 0;
}

function language() {
  try {
    return window.CCSyncI18n?.currentLanguage?.() === 'zh-CN' ? 'zh-CN' : 'en';
  } catch {
    return document.documentElement.lang === 'zh-CN' ? 'zh-CN' : 'en';
  }
}

function text(key) {
  const dict = {
    en: {
      available: 'Update available',
      latestState: 'Latest version',
      current: 'Current version',
      latest: 'Latest version',
      download: 'Download update',
      upToDate: 'Already up to date',
      release: 'View release',
      failed: 'Update check failed',
    },
    'zh-CN': {
      available: '发现新版本',
      latestState: '当前已是最新版本',
      current: '当前版本',
      latest: '最新版本',
      download: '下载更新',
      upToDate: '已为最新版本',
      release: '查看发布页',
      failed: '检查更新失败',
    },
  };
  return dict[language()]?.[key] || dict.en[key] || key;
}

function setHidden(element, hidden) {
  if (element) element.hidden = hidden;
}

function setUpdateState({ visible = false, version = '', url = '', releaseUrl = '', fileName = '', error = false } = {}) {
  const card = $u('updateCard');
  const title = $u('updateTitle');
  const meta = $u('updateMeta');
  const download = $u('updateDownload');
  const release = $u('updateRelease');
  if (!card || !title || !meta || !download || !release) return;

  setHidden(card, !visible && !error);
  if (error) {
    card.hidden = false;
    card.classList.add('update-error');
    title.textContent = text('failed');
    meta.textContent = '';
    download.disabled = true;
    release.disabled = true;
    return;
  }

  card.classList.remove('update-error');
  if (!visible) return;

  const currentVersion = chrome.runtime.getManifest().version;
  const isNewer = compareVersions(version, currentVersion) > 0;
  const hasDownload = Boolean(url) && isNewer;

  title.textContent = `${isNewer ? text('available') : text('latestState')} · v${version}`;
  meta.textContent = `${text('current')}: v${currentVersion} · ${text('latest')}: v${version}`;

  download.disabled = !hasDownload;
  download.textContent = hasDownload ? text('download') : text('upToDate');
  release.disabled = !releaseUrl;
  release.textContent = text('release');
  download.dataset.url = hasDownload ? url : '';
  download.dataset.filename = hasDownload ? fileName : '';
  release.dataset.url = releaseUrl || '';
  download.setAttribute('aria-label', `${download.textContent} v${version}`);
  release.setAttribute('aria-label', `${text('release')} v${version}`);
}

async function fetchLatestRelease() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(REPO_API, {
      method: 'GET', cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal,
    });
    if (!response.ok) throw new Error(`GitHub release API returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function cacheRelease(info) {
  try { await chrome.storage.local.set({ [UPDATE_CACHE_KEY]: info, [UPDATE_CHECK_KEY]: Date.now() }); } catch {}
}

async function readCachedRelease() {
  try {
    const result = await chrome.storage.local.get([UPDATE_CACHE_KEY]);
    return result[UPDATE_CACHE_KEY] || null;
  } catch { return null; }
}

function normalizeRelease(release) {
  const tag = String(release.tag_name || '').trim();
  const tagVersion = tag.replace(/^v/i, '');
  const asset = Array.isArray(release.assets)
    ? release.assets.find(item => /^chromium-cloud-sync-v\d+\.\d+\.\d+\.crx$/i.test(String(item.name || '')))
      || release.assets.find(item => /\.crx$/i.test(String(item.name || '')))
    : null;
  const assetName = String(asset?.name || '');
  const fileMatch = assetName.match(/(?:^|-)v?(\d+\.\d+\.\d+)\.crx$/i);
  const version = fileMatch?.[1] || tagVersion;
  return {
    version,
    url: asset?.browser_download_url || '',
    releaseUrl: release.html_url || REPO_URL,
    fileName: assetName,
    name: release.name || tag,
    publishedAt: release.published_at || '',
  };
}

async function checkReleaseUpdate({ force = false } = {}) {
  const currentVersion = chrome.runtime.getManifest().version;
  const cached = await readCachedRelease();
  let lastCheckedAt = 0;
  try {
    const result = await chrome.storage.local.get([UPDATE_CHECK_KEY]);
    lastCheckedAt = Number(result[UPDATE_CHECK_KEY] || 0);
  } catch {}

  const shouldFetch = force || !cached || Date.now() - lastCheckedAt >= UPDATE_CHECK_INTERVAL_MS;
  if (!shouldFetch) {
    if (cached) setUpdateState({ visible: true, ...cached });
    else setHidden($u('updateCard'), true);
    return cached;
  }

  try {
    const release = await fetchLatestRelease();
    const info = normalizeRelease(release);
    await cacheRelease(info);
    setUpdateState({ visible: true, ...info });
    return info;
  } catch (error) {
    console.debug('Chromium Cloud Sync update check failed:', error);
    if (cached) setUpdateState({ visible: true, ...cached });
    else setUpdateState({ error: true });
    return cached;
  }
}

async function downloadUpdate(button) {
  const url = button?.dataset?.url || '';
  if (!url || button?.disabled) return;

  try {
    await chrome.downloads.download({
      url,
      filename: button.dataset.filename || undefined,
      saveAs: false,
      conflictAction: 'uniquify',
    });
  } catch (error) {
    console.debug('Chromium Cloud Sync CRX download failed:', error);
    // Fallback: let Chrome handle the direct release asset URL in a normal tab.
    void chrome.tabs.create({ url });
  }
}

function openExternalUrl(url) {
  if (!url) return;
  void chrome.tabs.create({ url });
}

function initReleaseUpdate() {
  const card = $u('updateCard');
  if (!card) return;

  $u('updateDownload')?.addEventListener('click', event => {
    event.preventDefault();
    void downloadUpdate($u('updateDownload'));
  });
  $u('updateRelease')?.addEventListener('click', event => {
    event.preventDefault();
    if (!$u('updateRelease')?.disabled) openExternalUrl($u('updateRelease')?.dataset?.url);
  });

  // The language switch updates <html lang>; refresh the update controls as well.
  let lastLanguage = language();
  const observer = new MutationObserver(() => {
    const nextLanguage = language();
    if (nextLanguage === lastLanguage) return;
    lastLanguage = nextLanguage;
    const cached = window.CCSyncUpdate?.getCachedState?.();
    if (cached) setUpdateState({ visible: true, ...cached });
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

  void checkReleaseUpdate();
}

let cachedReleaseState = null;
const originalCheck = checkReleaseUpdate;
checkReleaseUpdate = async (...args) => {
  const result = await originalCheck(...args);
  cachedReleaseState = result || cachedReleaseState;
  return result;
};

window.CCSyncUpdate = {
  check: checkReleaseUpdate,
  getCachedState: () => cachedReleaseState,
};

document.addEventListener('DOMContentLoaded', initReleaseUpdate);
