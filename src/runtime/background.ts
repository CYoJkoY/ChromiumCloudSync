import {
  mergeSnapshots,
  mergeDeviceStates,
  checksum,
  deriveTombstones,
  applyTombstones,
  cleanConflicts,
  extractEntities,
  reorderTabGroupBlocks,
  SCHEMA_VERSION,
} from "./sync-core.js";
import {
  unwrapMasterWithSecret,
  decryptJson,
  importAesKey,
  base64ToBytes,
} from "./legacy-crypto.js";
import { parseAndValidateCloudState } from "./schema.js";
import { readLocal, writeLocal, removeLocal } from "./storage.js";
import { detectBrowserCapabilities } from "./browser-capabilities.js";
import {
  classifySyncError,
  getSyncDiagnostics,
  saveSyncDiagnostics,
} from "./diagnostics.js";
import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  gdriveTest,
  gdriveLoad,
  gdriveCreate,
  gdriveSave,
  gdriveRevisions,
  gdriveLoadRevision,
} from "./cloud-gdrive.js";
import {
  webdavTest,
  webdavLoad,
  webdavCreate,
  webdavSave,
  webdavRevisions,
  webdavLoadRevision,
} from "./cloud-webdav.js";

async function activeProvider() {
  const s = await getSettings();
  return ["gdrive", "webdav"].includes(String(s[KEYS.PROVIDER] || ""))
    ? String(s[KEYS.PROVIDER])
    : "gist";
}
async function providerBound() {
  const p = await activeProvider();
  if (p === "gist") {
    const s = await getSettings();
    return !!(s[KEYS.GIST_ID] && String(s[KEYS.GITHUB_TOKEN] || "").trim());
  }
  if (p === "gdrive") {
    const s = await readLocal(["gdriveTokens"]);
    return !!s.gdriveTokens;
  }
  const s = await readLocal([KEYS.WEBDAV_URL]);
  return !!String(s[KEYS.WEBDAV_URL] || "").trim();
}
async function readRemote() {
  const p = await activeProvider();
  if (p === "gist") {
    const s = await getSettings();
    if (!s[KEYS.GIST_ID]) throw Error("尚未绑定 GitHub Gist");
    return loadRemote(s[KEYS.GIST_ID]);
  }
  const raw = p === "gdrive" ? await gdriveLoad() : await webdavLoad();
  return {
    state: validatedState(raw),
    raw,
    files: {},
    manifest: {
      schemaVersion: SCHEMA_VERSION,
      format: `${p}-v1`,
      currentFile: "current.json",
      revision: Number(raw?.revision || 0),
    },
    updatedAt: String(raw?.updatedAt || ""),
  };
}
async function writeRemote(state, priorRaw) {
  const p = await activeProvider();
  if (p === "gist") {
    const s = await getSettings();
    await updateGist(
      s[KEYS.GIST_ID],
      state,
      (priorRaw && priorRaw.files) || {},
    );
    return { revision: Number(state.revision || 0) };
  }
  return p === "gdrive" ? gdriveSave(state) : webdavSave(state);
}
async function createRemote(state) {
  const p = await activeProvider();
  if (p === "gist") {
    const g = await createGist(state);
    return { location: g.id };
  }
  return p === "gdrive" ? gdriveCreate(state) : webdavCreate(state);
}
async function remoteRevisions() {
  const p = await activeProvider();
  if (p === "gist") {
    const s = await getSettings();
    const r = await github(
      `/gists/${encodeURIComponent(s[KEYS.GIST_ID])}/commits?per_page=30`,
    );
    const loaded = await loadRemote(s[KEYS.GIST_ID]);
    const cur = loaded.raw.gist?.history?.[0]?.version || "";
    return (r.data || []).map((c, i) => ({
      sha: c.version,
      index: i,
      createdAt: c.committed_at,
      user: c.user?.login || "",
      changes: c.change_status || {},
      current: c.version === cur,
    }));
  }
  return p === "gdrive" ? gdriveRevisions() : webdavRevisions();
}
async function remoteRevisionState(id) {
  const p = await activeProvider();
  if (p === "gist")
    return revisionState(
      await getGistRevision((await getSettings())[KEYS.GIST_ID], id),
    );
  return validatedState(
    p === "gdrive"
      ? await gdriveLoadRevision(id)
      : await webdavLoadRevision(id),
  );
}

const GITHUB_API = "https://api.github.com";
const CURRENT_FILE = "current.json";
const LEGACY_ENCRYPTED_FILE = "current.enc.json";
const MANIFEST_FILE = "manifest.json";
const AUTO_SYNC_MINUTES = 5;
const DEFAULT_AUTO_SYNC_ENABLED = false;
const DEFAULT_TAB_SYNC_MODE = "overwrite";
const MAX_PUSH_RETRIES = 5;
const GITHUB_API_RETRIES = 2;
const KEYS = {
  AUTO_SYNC_ENABLED: "autoSyncEnabled",
  AUTO_SYNC_INTERVAL_MINUTES: "autoSyncIntervalMinutes",
  TAB_SYNC_MODE: "tabSyncMode",
  SYNC_REVISION: "syncRevision",
  GITHUB_TOKEN: "githubToken",
  GIST_ID: "gistId",
  LAST_SYNC: "lastSyncAt",
  LAST_REMOTE_UPDATED: "lastRemoteUpdatedAt",
  ETAG: "gistEtag",
  BASE_SNAPSHOT: "syncBaseSnapshot",
  BASE_REVISION: "syncBaseRevision",
  TAB_SYNC_IDS: "tabSyncIds",
  WINDOW_SYNC_IDS: "windowSyncIds",
  GROUP_SYNC_IDS: "groupSyncIds",
  BOOKMARK_SYNC_IDS: "bookmarkSyncIds",
  LAST_CONFLICTS: "lastSyncConflicts",
  LAST_SYNC_DIAGNOSTICS: "lastSyncDiagnostics",
  PROVIDER: "syncProvider",
  GDRIVE_FILE: "gdriveFileId",
  WEBDAV_URL: "webdavSyncUrl",
  WEBDAV_DIR: "webdavSyncFolder",
  WEBDAV_USER: "webdavSyncUsername",
  WEBDAV_PASS: "webdavSyncPassword",
  RESTORE_GROUP_MODE: "restoreGroupMode",
};
const LEGACY_LOCAL_KEYS = [
  "deviceId",
  "deviceName",
  "deviceNameKey",
  "deviceSeed",
  "deviceRevision",
  "localKeySeed",
  "masterEnvelope",
  "encryptionUnlocked",
  "securityMode",
  "masterKeyVersion",
  "syncBaseSnapshot",
  "syncBaseRevision",
];

async function getSettings() {
  return readLocal(Object.values(KEYS));
}
async function setSettings(v) {
  return writeLocal(v);
}
async function getObjectMap(key) {
  const s = await readLocal([key]);
  return s[key] || {};
}
async function getStableLocalId(kind, id, key) {
  const map = await getObjectMap(key),
    k = String(id);
  if (map[k]) return map[k];
  map[k] = `${kind}-${crypto.randomUUID()}`;
  await setSettings({ [key]: map });
  return map[k];
}
async function github(path, options = {}, tokenOverride = "") {
  const s = await getSettings();
  const token = (tokenOverride || s[KEYS.GITHUB_TOKEN] || "").trim();
  if (!token) throw Error("未配置 GitHub Token");
  let lastError = null;
  for (let attempt = 0; attempt <= GITHUB_API_RETRIES; attempt++) {
    try {
      const r = await fetch(`${GITHUB_API}${path}`, {
        ...options,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(options.headers || {}),
        },
      });
      const text = await r.text();
      let data = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = { raw: text };
      }
      if (r.status === 304) return { status: 304, headers: r.headers };
      if (!r.ok) {
        const message = data?.message || `GitHub API HTTP ${r.status}`;
        const err = new Error(message);
        err.code = "GITHUB_API_ERROR";
        err.status = r.status;
        err.githubMessage = message;
        err.documentationUrl = data?.documentation_url || "";
        err.errors = Array.isArray(data?.errors) ? data.errors : [];
        if (r.status === 422 && err.errors.length)
          err.detail = err.errors
            .map((e) =>
              [e.resource, e.field, e.code, e.message]
                .filter(Boolean)
                .join(": "),
            )
            .join("; ");
        throw err;
      }
      return { data, headers: r.headers };
    } catch (e) {
      lastError = e;
      if (
        !(
          e?.code === "GITHUB_API_ERROR" &&
          [408, 429, 500, 502, 503, 504].includes(e.status)
        ) ||
        attempt === GITHUB_API_RETRIES
      )
        throw e;
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  throw lastError || Error("GitHub request failed");
}
async function validateToken(token = "") {
  const value = (token || "").trim();
  if (!value) throw Error("GitHub Token is required");
  try {
    await github("/gists?per_page=1", {}, value);
  } catch (error) {
    const detail = error?.githubMessage || error?.message || String(error);
    throw Error(
      `GitHub Token validation failed${error?.status ? ` (HTTP ${error.status})` : ""}: ${detail}`,
    );
  }
  try {
    const r = await github("/user", {}, value);
    return {
      login: r.data.login,
      name: r.data.name || r.data.login,
      avatarUrl: r.data.avatar_url || "",
      gistsAccessible: true,
    };
  } catch {
    return {
      login: "GitHub authenticated",
      name: "GitHub authenticated",
      avatarUrl: "",
      gistsAccessible: true,
    };
  }
}
function extensionStoreInfo(ext) {
  const id = ext.id,
    homepage = ext.homepageUrl || "",
    update = ext.updateUrl || "";
  let source = "unknown";
  if (/edge\.microsoft\.com|microsoftedge/i.test(update + homepage))
    source = "edge";
  else if (/google\.com|chromewebstore/i.test(homepage)) source = "chrome";
  const keyword = id || ext.name || "";
  return {
    chromeUrl: `https://chromewebstore.google.com/detail/${id}`,
    edgeUrl: `https://microsoftedge.microsoft.com/addons/detail/${id}`,
    crxsosoUrl: `https://www.crxsoso.com/search?keyword=${encodeURIComponent(keyword)}&store=chrome`,
    crxsosoDetailUrl: id ? `https://www.crxsoso.com/webstore/detail/${id}` : "",
    source,
  };
}
async function collectExtensions() {
  const list = await chrome.management.getAll();
  return list
    .filter((x) => x.type === "extension" && x.id !== chrome.runtime.id)
    .map((x) => ({
      syncId: `extension-${x.id}`,
      id: x.id,
      name: x.name,
      version: x.version,
      enabled: x.enabled,
      description: x.description || "",
      homepageUrl: x.homepageUrl || "",
      updateUrl: x.updateUrl || "",
      installType: x.installType || "",
      store: extensionStoreInfo(x),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
function isRestrictedUrl(url) {
  const value = String(url || "").trim();
  if (!value) return true;
  return !/^https?:\/\//i.test(value);
}
async function collectTabGroups() {
  if (!chrome.tabGroups?.query) return [];
  const groups = await chrome.tabGroups.query({});
  return Promise.all(
    groups.map(async (g) => ({
      localId: g.id,
      windowId: g.windowId,
      syncId: await getStableLocalId("group", g.id, KEYS.GROUP_SYNC_IDS),
      title: g.title || "",
      color: g.color || "grey",
      collapsed: !!g.collapsed,
    })),
  );
}
async function collectTabs(groups) {
  const windows = await chrome.windows.getAll({ populate: true }),
    meta = Array.isArray(groups) ? groups : await collectTabGroups(),
    gm = new Map(meta.map((g) => [g.localId, g])),
    out = [];
  for (const win of windows.filter((w) => w.type === "normal")) {
    const windowSyncId = await getStableLocalId(
        "window",
        win.id,
        KEYS.WINDOW_SYNC_IDS,
      ),
      tabs = [];
    for (const tab of (win.tabs || []).filter((t) => !isRestrictedUrl(t.url))) {
      const g = gm.get(tab.groupId);
      tabs.push({
        syncId: await getStableLocalId("tab", tab.id, KEYS.TAB_SYNC_IDS),
        url: tab.url,
        title: tab.title || "",
        pinned: !!tab.pinned,
        active: !!tab.active,
        index: tab.index,
        group: g
          ? {
              syncId: g.syncId,
              title: g.title,
              color: g.color,
              collapsed: g.collapsed,
            }
          : null,
      });
    }
    out.push({
      syncId: windowSyncId,
      state: ["fullscreen", "maximized", "minimized", "normal"].includes(
        win.state,
      )
        ? win.state
        : "normal",
      focused: !!win.focused,
      tabs,
    });
  }
  return out;
}
async function collectBookmarks() {
  const tree = await chrome.bookmarks.getTree(),
    map = await getObjectMap(KEYS.BOOKMARK_SYNC_IDS),
    flat = [];
  let changed = false;
  async function walk(node, parentSyncId = null, index = 0) {
    let syncId = node.id === "0" ? "root-bookmarks" : map[String(node.id)];
    if (!syncId) {
      syncId = `bookmark-${crypto.randomUUID()}`;
      map[String(node.id)] = syncId;
      changed = true;
    }
    flat.push({
      syncId,
      parentSyncId,
      index,
      title: node.title || "",
      ...(node.url ? { url: node.url } : {}),
    });
    for (let i = 0; i < (node.children || []).length; i++)
      await walk(node.children[i], syncId, i);
  }
  for (const r of tree) await walk(r, null, 0);
  if (changed) await setSettings({ [KEYS.BOOKMARK_SYNC_IDS]: map });
  return flat;
}
async function collectGroupSnapshots(groups) {
  const meta = Array.isArray(groups) ? groups : await collectTabGroups();
  if (!meta.length) return [];

  const all = await chrome.tabs.query({});

  return Promise.all(
    meta.map(async (g) => {
      const tabs = await Promise.all(
        all
          .filter(
            (t) =>
              t.groupId === g.localId &&
              !isRestrictedUrl(t.url),
          )
          .sort((a, b) => a.index - b.index)
          .map(async (t) => ({
            syncId: await getStableLocalId(
              "tab",
              t.id,
              KEYS.TAB_SYNC_IDS,
            ),
            url: t.url,
            title: t.title || "",
            pinned: !!t.pinned,
            active: !!t.active,
            index: t.index,
          })),
      );

      return {
        syncId: g.syncId,
        localId: g.localId,
        windowId: g.windowId,
        index: tabs[0]?.index ?? 0,
        title: g.title,
        color: g.color,
        collapsed: g.collapsed,
        updatedAt: new Date().toISOString(),
        tabs,
      };
    }),
  );
}
async function createSnapshot() {
  const s = await getSettings(),
    groups = await collectTabGroups();
  return {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    extensions: await collectExtensions(),
    windows: await collectTabs(groups),
    bookmarks: await collectBookmarks(),
    groups: await collectGroupSnapshots(groups),
    syncMeta: { gistId: s[KEYS.GIST_ID] || null },
  };
}
function flattenLegacy(nodes, parentSyncId = null, out = []) {
  for (let i = 0; i < (nodes || []).length; i++) {
    const n = nodes[i],
      sid = n.syncId || `legacy-bookmark-${crypto.randomUUID()}`;
    out.push({
      syncId: sid,
      parentSyncId,
      index: i,
      title: n.title || "",
      ...(n.url ? { url: n.url } : {}),
    });
    if (n.children) flattenLegacy(n.children, sid, out);
  }
  return out;
}
function normalizeSnapshot(s) {
  const x = JSON.parse(JSON.stringify(s || {}));
  if (Array.isArray(x.bookmarks) && x.bookmarks.some((n) => n.children))
    x.bookmarks = flattenLegacy(x.bookmarks);
  delete x.device;
  if (x.syncMeta && typeof x.syncMeta === "object") delete x.syncMeta.devices;
  x.schemaVersion = SCHEMA_VERSION;
  return x;
}
async function readGistRaw(gistId) {
  const r = await github(`/gists/${encodeURIComponent(gistId)}`);
  const gist = r.data,
    files = gist.files || {};
  return {
    gist,
    files,
    etag: r.headers.get("ETag") || "",
    updatedAt: gist.updated_at || "",
  };
}
const te = new TextEncoder();
async function legacyGetLocalKeySeed() {
  const s = await readLocal(["localKeySeed", "deviceSeed"]);
  if (s.localKeySeed) return s.localKeySeed;
  if (s.deviceSeed) {
    await setSettings({ localKeySeed: s.deviceSeed });
    return s.deviceSeed;
  }
  return null;
}
async function legacyDeriveLocalKey() {
  const seed = await legacyGetLocalKeySeed();
  if (!seed) return null;
  const base = await crypto.subtle.importKey(
    "raw",
    te.encode(seed),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const salt = await crypto.subtle.digest(
    "SHA-256",
    te.encode("chromium-cloud-sync-local-key-v1"),
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt),
      iterations: 120000,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}
async function legacyGetLocalMaster() {
  const s = await readLocal(["masterEnvelope"]);
  if (!s.masterEnvelope) return null;
  try {
    const p = JSON.parse(s.masterEnvelope),
      key = await legacyDeriveLocalKey();
    if (!key) return null;
    const raw = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: base64ToBytes(p.iv), tagLength: 128 },
      key,
      base64ToBytes(p.ciphertext),
    );
    return importAesKey(new Uint8Array(raw), true);
  } catch {
    return null;
  }
}
async function legacyDecryptState(ciphertext, manifest) {
  const local = await legacyGetLocalMaster();
  if (local) {
    try {
      return await decryptJson(ciphertext, local);
    } catch {}
  }
  const s = await readLocal(["githubToken"]);
  for (const wrapper of manifest?.crypto?.wrappers || []) {
    if (
      wrapper.status === "revoked" ||
      wrapper.type !== "convenience" ||
      !s.githubToken
    )
      continue;
    try {
      const key = await unwrapMasterWithSecret(
        s.githubToken,
        wrapper,
        "convenience",
      );
      return await decryptJson(ciphertext, key);
    } catch {}
  }
  throw Error(
    "此 Gist 使用旧版加密格式。请先使用 v1.5.x 版本打开并成功同步一次，再升级到当前版本。",
  );
}
async function cleanupLegacyLocalState() {
  await removeLocal(LEGACY_LOCAL_KEYS);
}
function normalizeCloudState(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  if (input.snapshot && typeof input.snapshot === "object") {
    const snapshot = normalizeSnapshot(input.snapshot);
    return {
      schemaVersion: SCHEMA_VERSION,
      revision: Number(input.revision || 0),
      updatedAt:
        input.updatedAt || snapshot.updatedAt || new Date().toISOString(),
      snapshot,
      tombstones: Array.isArray(input.tombstones) ? input.tombstones : [],
      conflicts: cleanConflicts(input.conflicts || []),
    };
  }
  if (input.devices && typeof input.devices === "object") {
    const merged = mergeDeviceStates(input.devices),
      entries = Object.values(input.devices)
        .filter(Boolean)
        .sort((a, b) =>
          String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")),
        ),
      tm = new Map();
    for (const entry of entries)
      for (const t of entry.tombstones || []) {
        const k = `${t.collection}:${t.syncId}`,
          old = tm.get(k);
        if (!old || String(t.deletedAt) > String(old.deletedAt)) tm.set(k, t);
      }
    return {
      schemaVersion: SCHEMA_VERSION,
      revision: Math.max(0, ...entries.map((e) => Number(e.revision || 0))),
      updatedAt:
        input.updatedAt ||
        entries[0]?.updatedAt ||
        merged?.updatedAt ||
        new Date().toISOString(),
      snapshot: normalizeSnapshot(merged || {}),
      tombstones: [...tm.values()],
      conflicts: cleanConflicts(input.conflicts || []),
    };
  }
  if (
    Array.isArray(input.extensions) ||
    Array.isArray(input.windows) ||
    Array.isArray(input.bookmarks)
  ) {
    const snapshot = normalizeSnapshot(input);
    return {
      schemaVersion: SCHEMA_VERSION,
      revision: Number(input.revision || 1),
      updatedAt:
        input.updatedAt || snapshot.updatedAt || new Date().toISOString(),
      snapshot,
      tombstones: Array.isArray(input.tombstones) ? input.tombstones : [],
      conflicts: cleanConflicts(input.conflicts || []),
    };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    updatedAt: new Date().toISOString(),
    snapshot: normalizeSnapshot({
      schemaVersion: SCHEMA_VERSION,
      extensions: [],
      windows: [],
      bookmarks: [],
    }),
    tombstones: [],
    conflicts: [],
  };
}
function validatedState(raw) {
  return parseAndValidateCloudState(normalizeCloudState(raw));
}
async function loadRemote(gistId) {
  const raw = await readGistRaw(gistId);
  let manifest = null;
  const manifestText = raw.files[MANIFEST_FILE]?.content;
  if (manifestText) {
    try {
      manifest = JSON.parse(manifestText);
    } catch {
      throw Error("Gist manifest.json 无法解析");
    }
  }
  if (!manifest) {
    const legacyText = raw.files["chromium-cloud-sync.json"]?.content;
    if (!legacyText) throw Error("Gist 中没有同步数据");
    return {
      state: validatedState(JSON.parse(legacyText)),
      manifest: {
        schemaVersion: SCHEMA_VERSION,
        format: "gist-plain-v1",
        currentFile: CURRENT_FILE,
        revision: 0,
      },
      raw,
      legacy: true,
    };
  }
  if (![7, 8, 9, 10, 11].includes(Number(manifest.schemaVersion)))
    throw Error(`不支持的 Gist schema: ${manifest.schemaVersion}`);
  manifest.schemaVersion = SCHEMA_VERSION;
  const currentFile = manifest.currentFile || CURRENT_FILE;
  const plainCandidate =
    raw.files[CURRENT_FILE]?.content ||
    (currentFile !== LEGACY_ENCRYPTED_FILE
      ? raw.files[currentFile]?.content
      : null);
  if (plainCandidate) {
    try {
      return {
        state: validatedState(JSON.parse(plainCandidate)),
        manifest: {
          ...manifest,
          format: "gist-plain-v1",
          currentFile: CURRENT_FILE,
        },
        raw,
      };
    } catch (error) {
      if (error?.code === "SCHEMA_VALIDATION_FAILED") throw error;
      throw Error("Gist 中的 current.json 无法解析");
    }
  }
  const encryptedText =
    raw.files[LEGACY_ENCRYPTED_FILE]?.content ||
    (currentFile === LEGACY_ENCRYPTED_FILE
      ? raw.files[currentFile]?.content
      : null);
  if (encryptedText) {
    const state = validatedState(
      await legacyDecryptState(encryptedText, manifest),
    );
    return {
      state,
      manifest: {
        schemaVersion: SCHEMA_VERSION,
        format: "gist-plain-v1",
        currentFile: CURRENT_FILE,
        revision: Number(manifest.revision || state.revision || 0),
      },
      raw,
      legacyEncrypted: true,
    };
  }
  throw Error("Gist 中没有 current.json 同步数据");
}
async function createGist(state) {
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    format: "gist-plain-v1",
    currentFile: CURRENT_FILE,
    revision: Number(state.revision || 1),
    lastUpdatedAt: state.updatedAt || new Date().toISOString(),
  };
  const payload = {
    description: "Chromium Cloud Sync | private sync state",
    public: false,
    files: {
      [MANIFEST_FILE]: { content: JSON.stringify(manifest, null, 2) },
      [CURRENT_FILE]: { content: JSON.stringify(state, null, 2) },
    },
  };
  const r = await github("/gists", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  await setSettings({
    [KEYS.GIST_ID]: r.data.id,
    [KEYS.ETAG]: r.headers.get("ETag") || "",
    [KEYS.BASE_SNAPSHOT]: state.snapshot || {},
    [KEYS.BASE_REVISION]: Number(state.revision || 0),
    [KEYS.SYNC_REVISION]: Number(state.revision || 0),
  });
  return r.data;
}
function isLegacyHistoryFile(name) {
  return (
    /^history\//.test(name) ||
    /^ccsync-history-/.test(name) ||
    /^history-/.test(name)
  );
}
function legacyHistoryDeletes(existingFiles = []) {
  return [...new Set((existingFiles || []).filter(isLegacyHistoryFile))];
}
async function updateGist(gistId, state, existingFiles = {}) {
  const now = state.updatedAt || new Date().toISOString(),
    manifest = {
      schemaVersion: SCHEMA_VERSION,
      format: "gist-plain-v1",
      currentFile: CURRENT_FILE,
      revision: Number(state.revision || 0),
      lastUpdatedAt: now,
    },
    files = {
      [MANIFEST_FILE]: { content: JSON.stringify(manifest, null, 2) },
      [CURRENT_FILE]: { content: JSON.stringify(state, null, 2) },
    };
  if (
    Object.prototype.hasOwnProperty.call(
      existingFiles || {},
      LEGACY_ENCRYPTED_FILE,
    )
  )
    files[LEGACY_ENCRYPTED_FILE] = null;
  for (const f of legacyHistoryDeletes(Object.keys(existingFiles || {})))
    files[f] = null;
  for (const f of ["chromium-cloud-sync.json"])
    if (Object.prototype.hasOwnProperty.call(existingFiles || {}, f))
      files[f] = null;
  return github(`/gists/${encodeURIComponent(gistId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      description: "Chromium Cloud Sync | private sync state",
      files,
    }),
  });
}
async function buildLocalState(localSnapshot, remoteState, currentBase) {
  const settings = await getSettings(),
    base = currentBase || remoteState.snapshot || {},
    revision =
      Math.max(
        Number(settings[KEYS.SYNC_REVISION] || 0),
        Number(settings[KEYS.BASE_REVISION] || 0),
        Number(remoteState.revision || 0),
      ) + 1,
    now = new Date().toISOString(),
    tabSyncMode = await getTabSyncMode(),
    { snapshot, conflicts } = mergeSnapshots(
      base,
      localSnapshot,
      remoteState.snapshot || {},
      { tabSyncMode },
    );
  snapshot.schemaVersion = SCHEMA_VERSION;
  snapshot.updatedAt = now;
  const tombstones = deriveTombstones(
    base,
    localSnapshot,
    remoteState.tombstones || [],
    revision,
    now,
    tabSyncMode === "incremental",
  );
  const clean = cleanConflicts([
    ...(remoteState.conflicts || []),
    ...conflicts,
  ]);
  const remoteWins = new Set(
    clean
      .filter((c) => c.type === "delete-vs-modify" && c.winner === "remote")
      .map((c) => `${c.collection}:${c.syncId}`),
  );
  const filteredTombstones = tombstones.filter(
    (t) => !remoteWins.has(`${t.collection}:${t.syncId}`),
  );
  const finalSnapshot = applyTombstones(snapshot, filteredTombstones);
  finalSnapshot.schemaVersion = SCHEMA_VERSION;
  finalSnapshot.updatedAt = now;
  const state = {
    schemaVersion: SCHEMA_VERSION,
    revision,
    updatedAt: now,
    snapshot: finalSnapshot,
    tombstones: filteredTombstones,
    conflicts: clean.slice(-200),
  };
  return { state, revision, conflicts: clean };
}
async function pushSnapshot() {
  const localSnapshot = await createSnapshot();
  let settings = await getSettings(),
    gistId = settings[KEYS.GIST_ID] || "";
  let bound = await providerBound();
  if (
    !bound &&
    (await activeProvider()) === "gist" &&
    !(settings[KEYS.GITHUB_TOKEN] || "").trim()
  )
    throw Error("未配置 GitHub Token");
  for (let attempt = 1; attempt <= MAX_PUSH_RETRIES; attempt++) {
    let remoteState = {
        schemaVersion: SCHEMA_VERSION,
        revision: 0,
        updatedAt: new Date().toISOString(),
        snapshot: normalizeSnapshot({
          extensions: [],
          windows: [],
          bookmarks: [],
        }),
        tombstones: [],
        conflicts: [],
      },
      raw = null,
      legacyEncrypted = false;
    if (bound) {
      const loaded = await readRemote();
      remoteState = loaded.state;
      raw = loaded.raw;
      legacyEncrypted = !!loaded.legacyEncrypted;
    }
    settings = await getSettings();
    const currentBase =
      settings[KEYS.BASE_SNAPSHOT] || remoteState.snapshot || {};
    const built = await buildLocalState(
      localSnapshot,
      remoteState,
      currentBase,
    );
    if (!bound) {
      await createRemote(built.state);
      bound = true;
      settings = await getSettings();
      gistId =
        settings[KEYS.GIST_ID] ||
        gistId;
    } else {
      await writeRemote(built.state, raw);
      if (legacyEncrypted) await cleanupLegacyLocalState();
    }
    const verify = await readRemote();
    const remoteChecksum = checksum(verify.state.snapshot),
      builtChecksum = checksum(built.state.snapshot);
    if (
      Number(verify.state.revision) !== built.revision ||
      remoteChecksum !== builtChecksum
    ) {
      if (attempt === MAX_PUSH_RETRIES)
        throw Error("云端并发修改过于频繁，已停止重试；请再次同步");
      continue;
    }
    await setSettings({
      [KEYS.GIST_ID]:
        (await getSettings())[KEYS.GIST_ID] ||
        gistId,
      [KEYS.LAST_SYNC]: built.state.updatedAt,
      [KEYS.LAST_REMOTE_UPDATED]: verify.raw.updatedAt || built.state.updatedAt,
      [KEYS.ETAG]: verify.raw.etag || "",
      [KEYS.BASE_SNAPSHOT]: verify.state.snapshot,
      [KEYS.BASE_REVISION]: verify.state.revision,
      [KEYS.SYNC_REVISION]: verify.state.revision,
      [KEYS.LAST_CONFLICTS]: built.conflicts,
    });
    return {
      ok: true,
      gistId: (await getSettings())[KEYS.GIST_ID] || "",
      provider: await activeProvider(),
      revision: built.revision,
      updatedAt: built.state.updatedAt,
      extensionCount: built.state.snapshot?.extensions?.length || 0,
      tabCount: countTabs(built.state.snapshot),
      bookmarkCount: countBookmarks(built.state.snapshot?.bookmarks),
      groupCount: countGroups(built.state.snapshot),
      conflicts: built.conflicts.length,
    };
  }
}
function countTabs(s) {
  return (s?.windows || []).reduce((n, w) => n + (w.tabs || []).length, 0);
}
function countBookmarks(a) {
  return (a || []).filter((x) => x.url).length;
}
function countGroups(s) {
  if (Array.isArray(s?.groups)) return s.groups.length;
  const set = new Set();
  for (const w of s?.windows || [])
    for (const t of w.tabs || []) if (t.group?.syncId) set.add(t.group.syncId);
  return set.size;
}
async function pullState() {
  const s = await getSettings();
  if (!(await providerBound())) throw Error("尚未配置云同步后端");
  const loaded = await readRemote();
  await setSettings({
    [KEYS.LAST_REMOTE_UPDATED]: loaded.raw.updatedAt,
    [KEYS.ETAG]: loaded.raw.etag || "",
  });
  return loaded.state;
}
async function restoreTabs(windows, options = {}) {
  const mode = String(
    options.restoreGroupMode ||
      (await getSettings())[KEYS.RESTORE_GROUP_MODE] ||
      "ondemand",
  );
  const includeGroups = options.includeGroups === true || mode === "expand";
  let wc = 0,
    tc = 0,
    gc = 0,
    skipped = 0;
  for (const source of windows || []) {
    const tabs = (source.tabs || [])
      .filter(
        (t) =>
          t.url &&
          !isRestrictedUrl(t.url) &&
          (includeGroups || !t.group?.syncId),
      )
      .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (!tabs.length) continue;
    const requestedState =
      source.state === "maximized" || source.state === "minimized"
        ? "normal"
        : source.state === "fullscreen"
          ? "fullscreen"
          : "normal";
    let w;
    try {
      w = await chrome.windows.create({
        focused: false,
        state: requestedState,
      });
    } catch (e) {
      w = await chrome.windows.create({ focused: false });
    }
    wc++;
    const placeholder = w.tabs?.[0],
      restored = [];
    for (let i = 0; i < tabs.length; i++) {
      const t = tabs[i];
      try {
        const createData = { windowId: w.id, url: t.url, active: false };
        createData.pinned = !!t.pinned;
        const c =
          i === 0 && placeholder
            ? await chrome.tabs.update(placeholder.id, {
                url: t.url,
                pinned: !!t.pinned,
                active: false,
              })
            : await chrome.tabs.create(createData);
        restored.push({ source: t, tabId: c.id });
        if (i > 0 && i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
        tc++;
      } catch (e) {
        skipped++;
      }
    }
    const groups = new Map();
    for (const x of restored) {
      const k = x.source.group?.syncId;
      if (k && !x.source.pinned) {
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(x);
      }
    }
    for (const items of groups.values()) {
      if (!items.length) continue;
      try {
        const gid = await chrome.tabs.group({
            tabIds: items.map((x) => x.tabId),
            createProperties: { windowId: w.id },
          }),
          meta = items[0].source.group;
        try {
          await chrome.tabGroups.update(gid, {
            title: meta.title || undefined,
            color: meta.color || "grey",
            collapsed: !!meta.collapsed,
          });
        } catch {}
        gc++;
      } catch (e) {
        skipped += items.length;
      }
    }
  }
  if (!includeGroups)
    return { windows: wc, tabs: tc, groups: 0, skipped, groupsDeferred: true };
}
async function restoreGroup(groupSyncId) {
  const state = await pullState();
  const g = (state.snapshot?.groups || []).find(
    (x) => x.syncId === groupSyncId,
  );
  if (!g) throw Error("云端没有这个标签组");
  const tabs = (g.tabs || [])
    .filter((t) => t.url && !isRestrictedUrl(t.url))
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  if (!tabs.length) throw Error("该标签组没有可恢复的标签页");
  let w;
  try {
    w = await chrome.windows.create({ focused: true });
  } catch (e) {
    w = await chrome.windows.create({});
  }
  const placeholder = w.tabs?.[0],
    ids = [];
  for (let i = 0; i < tabs.length; i++) {
    const t = tabs[i];
    const c =
      i === 0 && placeholder
        ? await chrome.tabs.update(placeholder.id, {
            url: t.url,
            pinned: !!t.pinned,
            active: true,
          })
        : await chrome.tabs.create({
            windowId: w.id,
            url: t.url,
            active: false,
            pinned: !!t.pinned,
          });
    ids.push(c.id);
    if (i > 0 && i % 10 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  const gid = await chrome.tabs.group({
    tabIds: ids,
    createProperties: { windowId: w.id },
  });
  try {
    await chrome.tabGroups.update(gid, {
      title: g.title || undefined,
      color: g.color || "grey",
      collapsed: !!g.collapsed,
    });
  } catch {}
  return { tabs: ids.length, groups: 1, windowId: w.id };
}
async function restoreBookmarks(nodes) {
  const incoming = Array.isArray(nodes) ? nodes : [],
    tree = await chrome.bookmarks.getTree(),
    map = await getObjectMap(KEYS.BOOKMARK_SYNC_IDS),
    bySync = new Map();
  (function collect(arr) {
    for (const n of arr || []) {
      const sid = map[String(n.id)];
      if (sid) bySync.set(sid, n);
      collect(n.children);
    }
  })(tree);
  const roots = new Map([
    ["root-bookmarks", tree.find((n) => n.id === "0") || tree[0]],
  ]);
  let added = 0,
    moved = 0,
    updated = 0;
  const created = new Map();
  const parentId = (n) =>
    created.get(n.parentSyncId)?.id ||
    bySync.get(n.parentSyncId)?.id ||
    roots.get(n.parentSyncId)?.id;
  const pending = incoming
    .filter((n) => n.syncId !== "root-bookmarks")
    .slice()
    .sort((a, b) => Number(a.index) - Number(b.index));
  for (let pass = 0; pending.length && pass < incoming.length + 1; pass++) {
    let progress = false;
    for (let i = pending.length - 1; i >= 0; i--) {
      const n = pending[i],
        pid = parentId(n);
      if (!pid) continue;
      let ex = bySync.get(n.syncId);
      if (!ex) {
        ex = await chrome.bookmarks.create({
          parentId: pid,
          title: n.title || "",
          ...(n.url ? { url: n.url } : {}),
        });
        map[String(ex.id)] = n.syncId;
        bySync.set(n.syncId, ex);
        created.set(n.syncId, ex);
        added++;
      } else {
        if (ex.title !== n.title || (ex.url || "") !== (n.url || "")) {
          await chrome.bookmarks.update(ex.id, {
            title: n.title || "",
            ...(n.url ? { url: n.url } : {}),
          });
          updated++;
        }
        if (ex.parentId !== pid) {
          await chrome.bookmarks.move(ex.id, {
            parentId: pid,
            index: Number.isFinite(n.index) ? n.index : 0,
          });
          moved++;
        }
      }
      pending.splice(i, 1);
      progress = true;
    }
    if (!progress) break;
  }
  await setSettings({ [KEYS.BOOKMARK_SYNC_IDS]: map });
  return { added, moved, updated };
}
async function getGistRevision(gistId, revision) {
  return (
    await github(
      `/gists/${encodeURIComponent(gistId)}/${encodeURIComponent(revision)}`,
    )
  ).data;
}
async function revisionState(revisionGist) {
  const manifestText = revisionGist.files?.[MANIFEST_FILE]?.content;
  let manifest = null;
  if (manifestText) {
    try {
      manifest = JSON.parse(manifestText);
    } catch {
      throw Error("历史 Revision 的 manifest.json 无法解析");
    }
  }
  const currentFile = manifest?.currentFile || CURRENT_FILE,
    plain =
      revisionGist.files?.[CURRENT_FILE]?.content ||
      (currentFile !== LEGACY_ENCRYPTED_FILE
        ? revisionGist.files?.[currentFile]?.content
        : null);
  if (plain) {
    try {
      return validatedState(JSON.parse(plain));
    } catch (error) {
      if (error?.code === "SCHEMA_VALIDATION_FAILED") throw error;
      throw Error("历史 Revision 的 current.json 无法解析");
    }
  }
  const encrypted =
    revisionGist.files?.[LEGACY_ENCRYPTED_FILE]?.content ||
    (currentFile === LEGACY_ENCRYPTED_FILE
      ? revisionGist.files?.[currentFile]?.content
      : null);
  if (encrypted && manifest)
    return validatedState(await legacyDecryptState(encrypted, manifest));
  throw Error("历史 Revision 缺少 current.json");
}
async function historyData() {
  const s = await getSettings();
  if (!s[KEYS.GIST_ID]) throw Error("尚未绑定 GitHub Gist");
  const loaded = await loadRemote(s[KEYS.GIST_ID]);
  const r = await github(
      `/gists/${encodeURIComponent(s[KEYS.GIST_ID])}/commits?per_page=30`,
    ),
    currentSha =
      loaded.raw.gist?.history?.[0]?.version ||
      loaded.raw.gist?.history?.[0]?.sha ||
      "";
  return {
    gistId: s[KEYS.GIST_ID],
    revision: Number(loaded.state?.revision || loaded.manifest?.revision || 0),
    commits: await remoteRevisions(),
    state: loaded.state,
  };
}
async function rollbackHistory(revision) {
  const settings = await getSettings();
  if (!settings[KEYS.GIST_ID]) throw Error("尚未绑定 GitHub Gist");
  if (!revision) throw Error("缺少历史 Revision");
  const current = await loadRemote(settings[KEYS.GIST_ID]),
    historical = await remoteRevisionState(revision),
    now = new Date().toISOString(),
    next = {
      ...historical,
      schemaVersion: SCHEMA_VERSION,
      revision:
        Math.max(
          Number(current.state.revision || 0),
          Number(historical.revision || 0),
          Number(settings[KEYS.SYNC_REVISION] || 0),
        ) + 1,
      updatedAt: now,
      snapshot: normalizeSnapshot(historical.snapshot),
      conflicts: cleanConflicts([
        ...(current.state.conflicts || []),
        {
          type: "rollback",
          status: "resolved",
          strategy: "gist-revision",
          revision,
          at: now,
        },
      ]),
    };
  next.snapshot.updatedAt = now;
  return {
    ok: true,
    revision: (await saveState(settings[KEYS.GIST_ID], current, next)).revision,
    sourceRevision: revision,
  };
}
async function saveState(gistId, loaded, nextState) {
  const now = new Date().toISOString(),
    revision = Math.max(
      Number(nextState?.revision || 0),
      Number(loaded.manifest?.revision || 0) + 1,
    ),
    state = {
      ...nextState,
      schemaVersion: SCHEMA_VERSION,
      revision,
      updatedAt: now,
      snapshot: normalizeSnapshot(nextState.snapshot),
    };
  state.snapshot.updatedAt = now;
  await writeRemote(state, loaded.raw);
  await setSettings({
    [KEYS.BASE_SNAPSHOT]: state.snapshot,
    [KEYS.BASE_REVISION]: revision,
    [KEYS.SYNC_REVISION]: revision,
    [KEYS.LAST_SYNC]: now,
    [KEYS.LAST_REMOTE_UPDATED]: now,
    [KEYS.LAST_CONFLICTS]: state.conflicts || [],
  });
  return { revision };
}
async function updateManagedCloudState(mutator) {
  if (!(await providerBound()))
    throw Error("尚未配置云同步后端");

  for (
    let attempt = 1;
    attempt <= MAX_PUSH_RETRIES;
    attempt++
  ) {
    const loaded = await readRemote();
    const settings = await getSettings();
    const state = JSON.parse(JSON.stringify(loaded.state));
    const revision =
      Math.max(
        Number(loaded.state.revision || 0),
        Number(settings[KEYS.SYNC_REVISION] || 0),
        Number(settings[KEYS.BASE_REVISION] || 0),
      ) + 1;
    const now = new Date().toISOString();
    const changed = await mutator(state, revision, now);
    if (!changed)
      return {
        ok: true,
        changed: false,
        revision: loaded.state.revision,
      };

    state.schemaVersion = SCHEMA_VERSION;
    state.revision = revision;
    state.updatedAt = now;
    state.snapshot = normalizeSnapshot(state.snapshot);
    state.snapshot.updatedAt = now;
    state.tombstones = Array.isArray(state.tombstones)
      ? state.tombstones
      : [];
    state.conflicts = cleanConflicts(state.conflicts || []);
    state.snapshot = applyTombstones(
      state.snapshot,
      state.tombstones,
    );

    await writeRemote(state, loaded.raw);
    const verify = await readRemote();

    if (
      Number(verify.state.revision) === revision &&
      checksum(verify.state) === checksum(state)
    ) {
      await setSettings({
        [KEYS.BASE_SNAPSHOT]: verify.state.snapshot,
        [KEYS.BASE_REVISION]: verify.state.revision,
        [KEYS.SYNC_REVISION]: verify.state.revision,
        [KEYS.LAST_SYNC]: now,
        [KEYS.LAST_REMOTE_UPDATED]:
          verify.raw.updatedAt || now,
        [KEYS.ETAG]: verify.raw.etag || "",
        [KEYS.LAST_CONFLICTS]:
          verify.state.conflicts || [],
      });
      return {
        ok: true,
        changed: true,
        revision,
      };
    }
  }

  throw Error(
    "云端并发修改过于频繁，已停止重试；请再次操作",
  );
}

function findCloudTab(snapshot, syncId) {
  const id = String(syncId || "");
  for (const window of snapshot.windows || []) {
    const tab = (window.tabs || []).find(
      (x) => x.syncId === id,
    );
    if (tab)
      return { tab, window };
  }
  for (const group of snapshot.groups || []) {
    const tab = (group.tabs || []).find(
      (x) => x.syncId === id,
    );
    if (tab)
      return { tab, group };
  }
  return null;
}

function moveItemById(list, syncId, direction) {
  const index = list.findIndex(
    (item) => item.syncId === syncId,
  );
  if (index < 0)
    return false;
  const target =
    direction === "up"
      ? index - 1
      : index + 1;
  if (
    target < 0 ||
    target >= list.length
  )
    return false;
  [list[index], list[target]] = [
    list[target],
    list[index],
  ];
  list.forEach((item, index) => {
    item.index = index;
  });
  return true;
}

function moveTabWithinWindow(window, syncId, direction) {
  const tabs = window.tabs || [];
  const index = tabs.findIndex(
    (tab) => tab.syncId === syncId,
  );
  if (index < 0)
    return false;
  const currentGroup =
    tabs[index].group?.syncId || null;
  const peers = tabs
    .map((tab, index) => ({ tab, index }))
    .filter(
      ({ tab }) =>
        (tab.group?.syncId || null) === currentGroup,
    );
  const peerIndex = peers.findIndex(
    (item) => item.index === index,
  );
  const targetPeer =
    direction === "up"
      ? peerIndex - 1
      : peerIndex + 1;
  if (
    peerIndex < 0 ||
    targetPeer < 0 ||
    targetPeer >= peers.length
  )
    return false;
  const target = peers[targetPeer].index;
  [tabs[index], tabs[target]] = [
    tabs[target],
    tabs[index],
  ];
  tabs.forEach((tab, index) => {
    tab.index = index;
  });
  return true;
}

async function missingExtensions() {
  const local = await collectExtensions(),
    settings = await getSettings();
  if (!(await providerBound()))
    return {
      local,
      remote: [],
      missing: [],
      remoteUnavailable: true,
      errorCode: "GIST_NOT_BOUND",
      errorMessage: "尚未绑定 GitHub Gist",
    };
  try {
    const state = await pullState(),
      remote = Array.isArray(state.snapshot?.extensions)
        ? state.snapshot.extensions
        : [],
      localIds = new Set(local.map((x) => x.id)),
      missing = remote.filter((x) => !localIds.has(x.id));
    return { local, remote, missing, remoteUnavailable: false };
  } catch (error) {
    return {
      local,
      remote: [],
      missing: [],
      remoteUnavailable: true,
      errorCode: "REMOTE_READ_FAILED",
      errorMessage: error?.message || String(error),
    };
  }
}
async function getTabSyncMode(): Promise<"overwrite" | "incremental"> {
  const s = await getSettings();
  return s[KEYS.TAB_SYNC_MODE] === "incremental"
    ? "incremental"
    : "overwrite";
}
async function getAutoSyncSettings() {
  const s = await getSettings();
  return {
    enabled: s[KEYS.AUTO_SYNC_ENABLED] === true,
    intervalMinutes:
      Number(s[KEYS.AUTO_SYNC_INTERVAL_MINUTES] || AUTO_SYNC_MINUTES) ||
      AUTO_SYNC_MINUTES,
  };
}
async function setupAlarms() {
  const cfg = await getAutoSyncSettings();
  await chrome.alarms.clear("cloud-sync");
  if (cfg.enabled)
    await chrome.alarms.create("cloud-sync", {
      periodInMinutes: cfg.intervalMinutes,
    });
}
async function setAutoSyncSettings(
  enabled,
  intervalMinutes = AUTO_SYNC_MINUTES,
) {
  const interval = Math.max(
    1,
    Math.min(1440, Number(intervalMinutes) || AUTO_SYNC_MINUTES),
  );
  await setSettings({
    [KEYS.AUTO_SYNC_ENABLED]: !!enabled,
    [KEYS.AUTO_SYNC_INTERVAL_MINUTES]: interval,
  });
  await setupAlarms();
  return { enabled: !!enabled, intervalMinutes: interval };
}
async function runSyncWithDiagnostics() {
  const startedAt = new Date().toISOString();
  const before = await getSettings();
  try {
    const result = await pushSnapshot();
    const finishedAt = new Date().toISOString();
    await saveSyncDiagnostics({
      startedAt,
      finishedAt,
      result: result.conflicts ? "conflict" : "success",
      baseRevision: Number(
        before[KEYS.BASE_REVISION] || before[KEYS.SYNC_REVISION] || 0,
      ),
      localRevision: Number(before[KEYS.SYNC_REVISION] || 0),
      remoteRevision: Number(before[KEYS.BASE_REVISION] || 0),
      uploadedRevision: Number(result.revision || 0),
      changedCounts: {
        extensions: Number(result.extensionCount || 0),
        tabs: Number(result.tabCount || 0),
        bookmarks: Number(result.bookmarkCount || 0),
        groups: Number(result.groupCount || 0),
        conflicts: Number(result.conflicts || 0),
      },
    });
    return result;
  } catch (error) {
    const finishedAt = new Date().toISOString();
    await saveSyncDiagnostics({
      startedAt,
      finishedAt,
      result: classifySyncError(error),
      baseRevision: Number(before[KEYS.BASE_REVISION] || 0),
      localRevision: Number(before[KEYS.SYNC_REVISION] || 0),
      remoteRevision: Number(before[KEYS.BASE_REVISION] || 0),
      errorCode: error?.code || "",
      errorMessage: error?.message || String(error),
    });
    throw error;
  }
}
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "cloud-sync")
    return;
  try {
    const cfg = await getAutoSyncSettings();
    if (!cfg.enabled)
      return;
    if (await providerBound())
      await runSyncWithDiagnostics();
  } catch (e) {
    console.warn("Automatic sync failed", e);
  }
});
chrome.runtime.onInstalled.addListener(async () => {
  const s = await getSettings();
  if (typeof s[KEYS.AUTO_SYNC_ENABLED] !== "boolean")
    await setSettings({ [KEYS.AUTO_SYNC_ENABLED]: DEFAULT_AUTO_SYNC_ENABLED });
  if (!s[KEYS.AUTO_SYNC_INTERVAL_MINUTES])
    await setSettings({
      [KEYS.AUTO_SYNC_INTERVAL_MINUTES]: AUTO_SYNC_MINUTES,
    });
  if (
    s[KEYS.TAB_SYNC_MODE] !== "overwrite" &&
    s[KEYS.TAB_SYNC_MODE] !== "incremental"
  )
    await setSettings({
      [KEYS.TAB_SYNC_MODE]: DEFAULT_TAB_SYNC_MODE,
    });
  await setupAlarms();
});
chrome.runtime.onStartup.addListener(async () => {
  const s = await getSettings();
  const patch = {};
  if (typeof s[KEYS.AUTO_SYNC_ENABLED] !== "boolean")
    patch[KEYS.AUTO_SYNC_ENABLED] = DEFAULT_AUTO_SYNC_ENABLED;
  if (!s[KEYS.AUTO_SYNC_INTERVAL_MINUTES])
    patch[KEYS.AUTO_SYNC_INTERVAL_MINUTES] = AUTO_SYNC_MINUTES;
  if (
    s[KEYS.TAB_SYNC_MODE] !== "overwrite" &&
    s[KEYS.TAB_SYNC_MODE] !== "incremental"
  )
    patch[KEYS.TAB_SYNC_MODE] = DEFAULT_TAB_SYNC_MODE;
  if (Object.keys(patch).length)
    await setSettings(patch);
  await setupAlarms();
});
for (const ev of [
  chrome.tabs.onCreated,
  chrome.tabs.onRemoved,
  chrome.tabs.onUpdated,
  chrome.tabs.onMoved,
])
  ev.addListener(() => debounceAutoSync());
for (const ev of [
  chrome.tabGroups?.onCreated,
  chrome.tabGroups?.onRemoved,
  chrome.tabGroups?.onUpdated,
])
  if (ev) ev.addListener(() => debounceAutoSync());
for (const ev of [
  chrome.bookmarks?.onCreated,
  chrome.bookmarks?.onRemoved,
  chrome.bookmarks?.onChanged,
  chrome.bookmarks?.onMoved,
])
  if (ev) ev.addListener(() => debounceAutoSync());
let syncTimer = null;
function debounceAutoSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      const cfg = await getAutoSyncSettings();
      if (!cfg.enabled)
        return;
      if (await providerBound())
        await runSyncWithDiagnostics();
    } catch (e) {
      console.warn("Automatic sync failed", e);
    }
  }, 5000);
}
chrome.runtime.onMessage.addListener((m, _s, send) => {
  (async () => {
    switch (m.type) {
      case "ping":
        return {
          ok: true,
          version: SCHEMA_VERSION,
          capabilities: detectBrowserCapabilities(),
        };
      case "capabilities":
        return detectBrowserCapabilities();
      case "diagnostics":
        return getSyncDiagnostics();
      case "getAutoSyncSettings":
        return getAutoSyncSettings();
      case "setAutoSyncSettings":
        return setAutoSyncSettings(m.enabled, m.intervalMinutes);
      case "getTabSyncSettings":
        return { mode: await getTabSyncMode() };
      case "setTabSyncMode": {
        const mode =
          String(m.mode) === "incremental"
            ? "incremental"
            : "overwrite";
        await setSettings({
          [KEYS.TAB_SYNC_MODE]: mode,
        });
        return { mode };
      }
      case "status": {
        const s = await getSettings();
        const provider = await activeProvider();
        const bound = await providerBound();
        return {
          provider,
          bound,
          authenticated:
            provider === "gist" &&
            !!s[KEYS.GITHUB_TOKEN],
          gistConfigured:
            provider === "gist" &&
            !!s[KEYS.GIST_ID],
          gistId: s[KEYS.GIST_ID] || "",
          lastSyncAt: s[KEYS.LAST_SYNC] || "",
          syncRevision:
            Number(s[KEYS.SYNC_REVISION] || 0),
          conflictCount:
            cleanConflicts(
              s[KEYS.LAST_CONFLICTS] || [],
            ).length,
          autoSyncEnabled:
            s[KEYS.AUTO_SYNC_ENABLED] === true,
          autoSyncIntervalMinutes:
            Number(
              s[KEYS.AUTO_SYNC_INTERVAL_MINUTES] ||
                AUTO_SYNC_MINUTES,
            ) || AUTO_SYNC_MINUTES,
          tabSyncMode:
            s[KEYS.TAB_SYNC_MODE] === "incremental"
              ? "incremental"
              : "overwrite",
          diagnostics:
            s[KEYS.LAST_SYNC_DIAGNOSTICS] || null,
          capabilities:
            detectBrowserCapabilities(),
        };
      }
      case "validateToken": {
        try {
          return { ok: true, ...(await validateToken(m.token || "")) };
        } catch (e) {
          throw Error(`Token validation failed: ${e?.message || e}`);
        }
      }
      case "configureGist": {
        const token = (m.token || "").trim();
        if (!token) throw Error("未配置 GitHub Token");
        if (!m.gistId) {
          await removeLocal([KEYS.GIST_ID, KEYS.ETAG]);
          await setSettings({ [KEYS.GITHUB_TOKEN]: token });
          return { gistId: "" };
        }
        const r = await github(
          `/gists/${encodeURIComponent(m.gistId)}`,
          {},
          token,
        );
        if (
          !r.data.files?.[MANIFEST_FILE] &&
          !r.data.files?.["chromium-cloud-sync.json"] &&
          !r.data.files?.[CURRENT_FILE] &&
          !r.data.files?.[LEGACY_ENCRYPTED_FILE]
        )
          throw Error("指定 Gist 不包含 Chromium Cloud Sync 数据");
        await setSettings({
          [KEYS.GITHUB_TOKEN]: token,
          [KEYS.GIST_ID]: m.gistId,
          [KEYS.ETAG]: r.headers.get("ETag") || "",
        });
        return { gistId: m.gistId };
      }
      case "createGist": {
        const snap = await createSnapshot(),
          state = {
            schemaVersion: SCHEMA_VERSION,
            revision: 1,
            updatedAt: snap.updatedAt,
            snapshot: snap,
            tombstones: [],
            conflicts: [],
          },
          g = await createGist(state);
        await setSettings({
          [KEYS.SYNC_REVISION]: 1,
          [KEYS.BASE_SNAPSHOT]: snap,
          [KEYS.BASE_REVISION]: 1,
          [KEYS.LAST_SYNC]: snap.updatedAt,
        });
        return { id: g.id, revision: 1 };
      }
      case "snapshot":
        return createSnapshot();
      case "sync":
        return runSyncWithDiagnostics();
      case "pull":
        return (await pullState()).snapshot;
      case "pullState":
        return pullState();
      case "restoreTabs":
        return restoreTabs(m.windows, {
          includeGroups: m.includeGroups === true,
          restoreGroupMode: m.restoreGroupMode,
        });
      case "cloudGroups": {
        const s = await pullState();
        return (s.snapshot?.groups || []).map((g) => ({
          syncId: g.syncId,
          title: g.title || "",
          color: g.color || "grey",
          collapsed: !!g.collapsed,
          tabCount: (g.tabs || []).length,
          updatedAt: g.updatedAt || "",
          tabs: (g.tabs || []).map((tab) => ({
            syncId: tab.syncId,
            title: tab.title || "",
            url: tab.url || "",
            index: Number.isFinite(tab.index) ? tab.index : 0,
            pinned: !!tab.pinned,
          })),
        }));
      }
      case "restoreGroup":
        return restoreGroup(m.groupSyncId);
      case "cloudTabState": {
        const state = await pullState();
        const local = await createSnapshot();
        const localEntities = extractEntities(local);
        return {
          mode: await getTabSyncMode(),
          snapshot: state.snapshot,
          tombstones: state.tombstones || [],
          localTabIds: [...localEntities.keys()]
            .filter((key) => key.startsWith("tabs:"))
            .map((key) => key.slice("tabs:".length)),
          localGroupIds: [...localEntities.keys()]
            .filter((key) => key.startsWith("groups:"))
            .map((key) => key.slice("groups:".length)),
        };
      }
      case "addCurrentTabsToCloud": {
        const local = await createSnapshot();
        const settings = await getSettings();
        const base = settings[KEYS.BASE_SNAPSHOT] || {};
        return updateManagedCloudState((state) => {
          const merged = mergeSnapshots(
            base,
            {
              ...state.snapshot,
              windows: local.windows,
              groups: local.groups,
            },
            state.snapshot,
            { tabSyncMode: "incremental" },
          );
          state.snapshot.windows = merged.snapshot.windows;
          state.snapshot.groups = merged.snapshot.groups;

          const localEntities = extractEntities(local);
          state.tombstones =
            (state.tombstones || []).filter((t) => {
              if (
                !["windows", "tabs", "groups"].includes(
                  t.collection,
                )
              )
                return true;
              return !localEntities.has(
                t.collection + ":" + t.syncId,
              );
            });

          return true;
        });
      }
      case "restoreCloudTab": {
        const state = await pullState();
        const found = findCloudTab(
          state.snapshot,
          m.syncId,
        );
        if (!found)
          throw Error("云端没有这个标签页");

        let window =
          await chrome.windows.getLastFocused({
            windowTypes: ["normal"],
          });

        if (!window?.id)
          window = await chrome.windows.create({
            focused: true,
          });

        const tab = await chrome.tabs.create({
          windowId: window.id,
          url: found.tab.url,
          active: true,
          pinned: !!found.tab.pinned,
        });

        return {
          ok: true,
          tabId: tab.id,
        };
      }
      case "deleteCloudTab":
        return updateManagedCloudState(
          (state, revision, now) => {
            const id = String(m.syncId || "");
            if (!id)
              throw Error("缺少 Tab syncId");
            if (!findCloudTab(state.snapshot, id))
              return false;

            for (const window of state.snapshot.windows || [])
              window.tabs =
                (window.tabs || []).filter(
                  (tab) => tab.syncId !== id,
                );

            for (const group of state.snapshot.groups || [])
              group.tabs =
                (group.tabs || []).filter(
                  (tab) => tab.syncId !== id,
                );

            state.tombstones = [
              ...(state.tombstones || []).filter(
                (t) =>
                  !(
                    t.collection === "tabs" &&
                    t.syncId === id
                  ),
              ),
              {
                collection: "tabs",
                syncId: id,
                deletedAt: now,
                revision,
              },
            ];
            return true;
          },
        );
      case "deleteCloudGroup":
        return updateManagedCloudState(
          (state, revision, now) => {
            const id = String(m.syncId || "");
            const group = (
              state.snapshot.groups || []
            ).find((g) => g.syncId === id);
            if (!group)
              return false;

            const tabIds = new Set(
              (group.tabs || []).map(
                (tab) => tab.syncId,
              ),
            );

            state.snapshot.groups =
              (state.snapshot.groups || []).filter(
                (g) => g.syncId !== id,
              );

            for (const window of state.snapshot.windows || [])
              window.tabs =
                (window.tabs || []).filter(
                  (tab) =>
                    !(
                      tab.group?.syncId === id ||
                      tabIds.has(tab.syncId)
                    ),
                );

            state.tombstones = [
              ...(state.tombstones || []).filter(
                (t) =>
                  !(
                    (t.collection === "groups" &&
                      t.syncId === id) ||
                    (t.collection === "tabs" &&
                      tabIds.has(t.syncId))
                  ),
              ),
              {
                collection: "groups",
                syncId: id,
                deletedAt: now,
                revision,
              },
              ...[...tabIds].map((syncId) => ({
                collection: "tabs",
                syncId,
                deletedAt: now,
                revision,
              })),
            ];
            return true;
          },
        );
      case "moveCloudTab":
        return updateManagedCloudState(
          (state) => {
            const id = String(m.syncId || "");
            const direction =
              m.direction === "up"
                ? "up"
                : "down";

            if (m.containerType === "group") {
              const group = (
                state.snapshot.groups || []
              ).find(
                (g) =>
                  g.syncId ===
                  String(m.containerSyncId || ""),
              );
              if (!group)
                return false;

              const tabs = group.tabs || [];
              const index = tabs.findIndex(
                (tab) => tab.syncId === id,
              );
              if (index < 0)
                return false;

              const target =
                direction === "up"
                  ? index - 1
                  : index + 1;
              if (
                target < 0 ||
                target >= tabs.length
              )
                return false;

              const movedId = tabs[index].syncId;
              const targetId = tabs[target].syncId;

              [tabs[index], tabs[target]] = [
                tabs[target],
                tabs[index],
              ];
              tabs.forEach((tab, tabIndex) => {
                tab.index = tabIndex;
              });

              let updatedWindow = false;
              for (
                const window of
                state.snapshot.windows || []
              ) {
                const a = window.tabs.findIndex(
                  (tab) => tab.syncId === movedId,
                );
                const b = window.tabs.findIndex(
                  (tab) => tab.syncId === targetId,
                );
                if (a < 0 || b < 0)
                  continue;

                [window.tabs[a], window.tabs[b]] = [
                  window.tabs[b],
                  window.tabs[a],
                ];
                window.tabs.forEach(
                  (tab, tabIndex) => {
                    tab.index = tabIndex;
                  },
                );
                updatedWindow = true;
              }

              return updatedWindow;
            }

            const window = (
              state.snapshot.windows || []
            ).find(
              (w) =>
                w.syncId ===
                String(m.containerSyncId || ""),
            );
            if (!window)
              return false;

            return moveTabWithinWindow(
              window,
              id,
              direction,
            );
          },
        );
      case "moveCloudGroup":
        return updateManagedCloudState(
          (state) => {
            const id = String(m.syncId || "");
            const groups = state.snapshot.groups || [];
            const current = groups.find(
              (g) => g.syncId === id,
            );
            if (!current)
              return false;

            const window = (state.snapshot.windows || []).find(
              (candidate) =>
                (candidate.tabs || []).some(
                  (tab) => tab.group?.syncId === id,
                ),
            );
            if (!window)
              return false;

            const groupOrder = [];
            for (const tab of window.tabs || []) {
              const groupId = tab.group?.syncId;
              if (groupId && !groupOrder.includes(groupId))
                groupOrder.push(groupId);
            }

            const index = groupOrder.indexOf(id);
            const target =
              m.direction === "up"
                ? index - 1
                : index + 1;

            if (
              index < 0 ||
              target < 0 ||
              target >= groupOrder.length
            )
              return false;

            [groupOrder[index], groupOrder[target]] = [
              groupOrder[target],
              groupOrder[index],
            ];

            if (!reorderTabGroupBlocks(window, groupOrder))
              return false;

            const firstIndexes = new Map();
            for (let tabIndex = 0; tabIndex < window.tabs.length; tabIndex += 1) {
              const groupId = window.tabs[tabIndex].group?.syncId;
              if (groupId && !firstIndexes.has(groupId))
                firstIndexes.set(groupId, tabIndex);
            }

            for (const group of groups) {
              const firstIndex = firstIndexes.get(group.syncId);
              if (firstIndex !== undefined)
                group.index = firstIndex;
            }

            return true;
          },
        );
      case "restoreBookmarks":
        return restoreBookmarks(m.bookmarks);
      case "missingExtensions":
        return missingExtensions();
      case "rollbackHistory":
        return rollbackHistory(m.revision);
      case "historyData":
        return historyData();
      case "providerStatus": {
        const s = await getSettings();
        return {
          provider: await activeProvider(),
          bound: await providerBound(),
          gistId: s[KEYS.GIST_ID] || "",
          gdriveConnected: !!(await readLocal(["gdriveTokens"])).gdriveTokens,
          webdavUrl: String(
            (await readLocal([KEYS.WEBDAV_URL]))[KEYS.WEBDAV_URL] || "",
          ),
          restoreGroupMode: String(
            s[KEYS.RESTORE_GROUP_MODE] || "ondemand",
          ),
          tabSyncMode: await getTabSyncMode(),
        };
      }
      case "setProvider": {
        const value = ["gdrive", "webdav"].includes(String(m.provider))
          ? String(m.provider)
          : "gist";
        await setSettings({ [KEYS.PROVIDER]: value });
        await setupAlarms();
        return { provider: value };
      }
      case "connectGdrive":
        return connectGoogleDrive(
          String(m.clientId || ""),
          String(m.clientSecret || ""),
        );
      case "disconnectGdrive":
        return disconnectGoogleDrive();
      case "testProvider": {
        const p = await activeProvider();
        if (p === "gist") {
          const s = await getSettings();
          if (!String(s[KEYS.GITHUB_TOKEN] || "").trim())
            throw Error("未配置 GitHub Token");
          await github("/user", {});
        } else if (p === "gdrive") await gdriveTest();
        else await webdavTest();
        return { ok: true, provider: p };
      }
      case "saveWebdav": {
        const url = String(m.url || "").trim();
        if (url) {
          const origin = `${new URL(url).origin}/*`;
          if (
            chrome.permissions?.request &&
            !(await chrome.permissions.contains({ origins: [origin] }))
          ) {
            if (!(await chrome.permissions.request({ origins: [origin] })))
              throw Error("WebDAV 需要允许访问该服务器地址");
          }
        }
        await setSettings({
          [KEYS.WEBDAV_URL]: url,
          [KEYS.WEBDAV_DIR]: String(m.folder || "").trim(),
          [KEYS.WEBDAV_USER]: String(m.user || ""),
          [KEYS.WEBDAV_PASS]: String(m.pass || ""),
        });
        return { ok: true };
      }
      case "setRestoreGroupMode": {
        await setSettings({
          [KEYS.RESTORE_GROUP_MODE]:
            String(m.mode) === "expand" ? "expand" : "ondemand",
        });
        return { mode: String(m.mode) === "expand" ? "expand" : "ondemand" };
      }
      default:
        throw Error(`Unknown message: ${m.type}`);
    }
  })()
    .then(send)
    .catch((e) => send({ error: e.message }));
  return true;
});
