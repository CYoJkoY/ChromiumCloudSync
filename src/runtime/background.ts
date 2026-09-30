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
import { parseAndValidateCloudState } from "./schema.js";
import { readLocal, writeLocal, removeLocal } from "./storage.js";
import { detectBrowserCapabilities } from "./browser-capabilities.js";
import {
  CLOUD_TAB_STATE_CACHE_KEY,
  CLOUD_TAB_STATE_VERSION,
  buildCanonicalCloudTabState,
  isCacheUsable,
  isCanonicalCloudTabState,
} from "./cloud-tab-state.js";
import {
  classifySyncError,
  getSyncDiagnostics,
  saveSyncDiagnostics,
} from "./diagnostics.js";
import {
  listRemoteHistory,
  readHistoryEntryState,
  readRemoteModularState,
  writeRemoteModularState,
} from "./cloud-files.js";
import {
  LEGACY_MONOLITHIC_FILE as CURRENT_FILE,
  MANIFEST_FILE,
  MODULAR_STORAGE_LAYOUT,
  MODULE_FILES,
  STORAGE_FORMAT_VERSION,
  SYNC_MODULE_IDS,
  bumpModuleRevisions,
  diffModuleChanges,
  mergeModularCloudState,
  serializeModularState,
  splitCloudState,
} from "./sync-modules.js";
import {
  LEGACY_ENCRYPTED_FILE,
  configureGithubTokenSource,
  createGistFileStore,
  createSyncGist,
  gistContainsSyncData,
  githubRequest,
  legacyGistHistoryDeletes,
  readGistRaw,
  validateGithubToken,
} from "./cloud-gist.js";
import {
  connectGoogleDriveBrowser,
  connectGoogleDriveManual,
  createGdriveFileStore,
  disconnectGoogleDrive,
  gdriveAuthState,
  gdriveConnected,
  gdriveStatus,
  gdriveTest,
  invalidateGdriveLayout,
  supportsBrowserManagedDriveAuth,
} from "./cloud-gdrive.js";
import {
  createWebdavFileStore,
  webdavBound,
  webdavConfig,
  webdavTest,
} from "./cloud-webdav.js";

/* ---------------------------------------------------------------------------
 * Provider dispatch
 *
 * Every provider is reduced to the same FileStore contract, and the modular
 * synchronization protocol in cloud-files.ts is the only place that knows how
 * module files are laid out, archived, and migrated.
 * ------------------------------------------------------------------------- */

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
  if (p === "gdrive") return gdriveConnected();
  return webdavBound(await webdavConfig());
}

/** FileStore for the currently selected provider. */
async function providerStore() {
  const p = await activeProvider();
  if (p === "gist") {
    const s = await getSettings();
    if (!s[KEYS.GIST_ID]) throw Error("尚未绑定 GitHub Gist");
    return createGistFileStore(String(s[KEYS.GIST_ID]));
  }
  if (p === "gdrive") return createGdriveFileStore();
  return createWebdavFileStore();
}

async function readRemote() {
  const store = await providerStore();
  const loaded = await readRemoteModularState(store, validatedState);
  return {
    state: loaded.state,
    modular: loaded.modular,
    manifest: loaded.manifest,
    files: loaded.files,
    layout: loaded.layout,
    migratedFromLegacy: loaded.migratedFromLegacy,
    legacyArchive: loaded.legacyArchive,
    store,
    raw: {
      etag: loaded.etag,
      updatedAt: loaded.updatedAt,
      provider: loaded.provider,
      layout: loaded.layout,
      gist: loaded.raw?.gist ?? null,
      legacyEncrypted: !!loaded.raw?.legacyEncrypted,
    },
  };
}

/**
 * Legacy artifacts that must be removed once the modular layout is committed.
 *
 * Only artifacts whose content is already represented elsewhere are removed:
 * the decrypted replacement of `LEGACY_ENCRYPTED_FILE` and superseded per-revision
 * history files. The legacy monolithic payloads (`current.json` and
 * `chromium-cloud-sync.json`) are deliberately NOT removed — they stay as
 * read-only migration archives so cloud data is never silently deleted or reset.
 */
function legacyRemovals(priorFiles, provider) {
  if (provider !== "gist") return [];
  const names = Object.keys(priorFiles || {}).filter(
    (name) => priorFiles[name] !== null && priorFiles[name] !== undefined,
  );
  const removals = [];
  if (names.includes(LEGACY_ENCRYPTED_FILE)) removals.push(LEGACY_ENCRYPTED_FILE);
  for (const name of legacyGistHistoryDeletes(names)) removals.push(name);
  return [...new Set(removals)];
}

/**
 * Commit a cloud state through the modular protocol.
 *
 * Only module files whose payload actually changed are uploaded, so a bookmark
 * edit no longer rewrites the complete tab and extension dataset.
 */
async function writeRemote(state, priorLoaded, options = {}) {
  const store = priorLoaded?.store || (await providerStore());
  const priorModular = priorLoaded?.modular || null;
  const globalRevision = Number(state.revision || 0);
  const requested = Array.isArray(options.changedModules)
    ? options.changedModules.filter((id) => SYNC_MODULE_IDS.includes(id))
    : [];
  const changed = requested.length
    ? requested
    : priorLoaded && priorLoaded.layout === "modular" && priorModular
      ? diffModuleChanges(priorModular, splitCloudState(state))
      : SYNC_MODULE_IDS.slice();

  const modular = splitCloudState(state, {
    revision: globalRevision,
    updatedAt: state.updatedAt,
    conflicts: state.conflicts || [],
    moduleRevisions: bumpModuleRevisions(
      priorModular,
      changed,
      globalRevision,
    ),
    migration: priorModular?.meta?.migration,
    legacyArchive: priorLoaded?.legacyArchive ?? null,
  });
  const result = await writeRemoteModularState(store, modular, {
    changedModules: changed,
    priorFiles: priorLoaded?.files || {},
    remove: legacyRemovals(priorLoaded?.files, store.id),
  });
  return { revision: globalRevision, ...result };
}

async function createRemote(state) {
  const p = await activeProvider();
  const modular = splitCloudState(state, {
    revision: Number(state.revision || 1),
    updatedAt: state.updatedAt,
    conflicts: state.conflicts || [],
  });
  if (p === "gist") {
    const created = await createSyncGist(serializeModularState(modular));
    await setSettings({
      [KEYS.GIST_ID]: created.id,
      [KEYS.ETAG]: created.headers.get("ETag") || "",
      [KEYS.BASE_SNAPSHOT]: state.snapshot || {},
      [KEYS.BASE_REVISION]: Number(state.revision || 0),
      [KEYS.SYNC_REVISION]: Number(state.revision || 0),
    });
    return { location: created.id };
  }
  const store = await providerStore();
  const result = await writeRemoteModularState(store, modular, {
    changedModules: SYNC_MODULE_IDS.slice(),
    historyLabel: `initial-${modular.meta.revision || 1}`,
  });
  return { location: p, written: result.written };
}

async function remoteRevisions() {
  const store = await providerStore();
  const entries = await listRemoteHistory(store);
  return entries.map((entry, index) => ({
    sha: entry.sha || entry.id,
    id: entry.id,
    index,
    createdAt: entry.createdAt,
    user: entry.user || "",
    changes: entry.changes || {},
    current: !!entry.current,
    layout: entry.layout || "",
    revision: Number(entry.revision || 0),
    // Modules this revision actually changed; empty for provider-native
    // history (Gist commits) where the change set is not module-labelled.
    modules: (entry.modules || []).filter((moduleId) =>
      SYNC_MODULE_IDS.includes(moduleId),
    ),
  }));
}

async function remoteRevisionState(id) {
  const store = await providerStore();
  return readHistoryEntryState(store, String(id), validatedState);
}

const AUTO_SYNC_MINUTES = 5;
const DEFAULT_AUTO_SYNC_ENABLED = false;
const DEFAULT_TAB_SYNC_MODE = "overwrite";
const MAX_PUSH_RETRIES = 5;
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
/**
 * Kept out of KEYS on purpose: getSettings() reads every KEYS value on each
 * call and the canonical cloud-tab projection is far too large to drag along.
 */
const CLOUD_TAB_CACHE_KEY = CLOUD_TAB_STATE_CACHE_KEY;
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
/**
 * The Gist transport must not depend on the settings layer, so the orchestrator
 * registers the token source once instead of the transport importing it.
 */
configureGithubTokenSource(async () =>
  String((await getSettings())[KEYS.GITHUB_TOKEN] || ""),
);
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
/**
 * Module-scoped merge.
 *
 * The extensions, bookmarks, and tabs modules are merged independently and each
 * produces its own conflict list and module revision, so a bookmark change does
 * not require treating the complete tab and extension dataset as one logical
 * unit. The storage layer then uploads only the modules that changed.
 */
async function buildLocalState(
  localSnapshot,
  remoteState,
  currentBase,
  remoteModular,
) {
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
    merged = mergeModularCloudState({
      base,
      local: localSnapshot,
      remote: remoteState,
      remoteModular: remoteModular || null,
      options: { tabSyncMode },
      revision,
      updatedAt: now,
      migration: remoteModular?.meta?.migration,
      legacyArchive: remoteModular?.manifest?.legacyArchive ?? null,
    }),
    snapshot = merged.snapshot,
    conflicts = merged.conflicts;
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
      priorLoaded = null,
      legacyEncrypted = false;
    if (bound) {
      priorLoaded = await readRemote();
      remoteState = priorLoaded.state;
      legacyEncrypted = !!priorLoaded.raw?.legacyEncrypted;
    }
    settings = await getSettings();
    const currentBase =
      settings[KEYS.BASE_SNAPSHOT] || remoteState.snapshot || {};
    const built = await buildLocalState(
      localSnapshot,
      remoteState,
      currentBase,
      priorLoaded?.modular || null,
    );
    if (!bound) {
      await createRemote(built.state);
      bound = true;
      settings = await getSettings();
      gistId =
        settings[KEYS.GIST_ID] ||
        gistId;
    } else {
      await writeRemote(built.state, priorLoaded);
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
    await publishCanonicalCloudTabState(verify.state);
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

/* ---------------------------------------------------------------------------
 * Canonical cloud tab state (single source of truth for popup + management UI)
 * ------------------------------------------------------------------------- */

/**
 * Notify every open extension surface that the canonical cloud-tab dataset
 * changed, so the popup restore view and the Settings management view can never
 * drift apart after a refresh or a mutation.
 */
function broadcastCloudTabState(canonical) {
  const payload = {
    type: "cloudTabStateChanged",
    provider: canonical.provider,
    revision: canonical.revision,
    fetchedAt: canonical.fetchedAt,
    checksum: canonical.checksum,
    source: canonical.source,
    stale: canonical.stale === true,
    counts: canonical.counts,
  };
  try {
    const result = chrome.runtime.sendMessage(payload);
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch {
    /* no listener (popup closed) is not an error */
  }
}

async function readCloudTabCache() {
  const s = await readLocal([CLOUD_TAB_CACHE_KEY]);
  const cached = s[CLOUD_TAB_CACHE_KEY];
  return isCanonicalCloudTabState(cached) ? cached : null;
}

async function writeCloudTabCache(canonical) {
  await writeLocal({ [CLOUD_TAB_CACHE_KEY]: canonical });
}

async function invalidateCloudTabCache() {
  await removeLocal([CLOUD_TAB_CACHE_KEY]);
}

/**
 * Coherent overall view of the split storage.
 *
 * The provider payload is now several independent module files, so the UI needs
 * one summary that reports the layout, every module file with its own revision,
 * and whether a legacy archive is still present.
 */
async function storageLayoutStatus() {
  const provider = await activeProvider();
  const summary = {
    provider,
    bound: await providerBound(),
    layout: "unknown",
    storageLayout: MODULAR_STORAGE_LAYOUT,
    formatVersion: STORAGE_FORMAT_VERSION,
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    updatedAt: "",
    legacyArchive: "",
    migratedFromLegacy: false,
    modules: [],
    files: [],
  };
  if (!summary.bound) return summary;
  try {
    const loaded = await readRemote();
    const meta = loaded.modular?.meta;
    return {
      ...summary,
      layout: loaded.layout,
      revision: Number(loaded.state?.revision || 0),
      updatedAt: String(loaded.state?.updatedAt || ""),
      legacyArchive: String(loaded.legacyArchive || ""),
      migratedFromLegacy: !!loaded.migratedFromLegacy,
      modules: (meta?.modules || []).map((entry) => ({
        module: entry.module,
        file: entry.file,
        revision: Number(entry.revision || 0),
        updatedAt: String(entry.updatedAt || ""),
        checksum: String(entry.checksum || ""),
        tombstones: Number(entry.tombstones || 0),
      })),
      files: Object.keys(loaded.files || {}).filter(
        (name) => loaded.files?.[name] !== null && loaded.files?.[name] !== undefined,
      ),
      migration: meta?.migration || null,
    };
  } catch (error) {
    return { ...summary, error: error?.message || String(error) };
  }
}

/** Diagnostics summary of the cached canonical projection (never the payload). */
async function cloudTabCacheSummary() {
  const cached = await readCloudTabCache();
  if (!cached) return { present: false };
  const provider = await activeProvider();
  return {
    present: true,
    provider: cached.provider,
    matchesActiveProvider: cached.provider === provider,
    usable: isCacheUsable(cached, provider),
    fetchedAt: cached.fetchedAt,
    revision: cached.revision,
    checksum: cached.checksum,
    counts: cached.counts,
  };
}

/**
 * Resolve the canonical cloud-tab dataset.
 *
 * `forceRemote: true` gives the action an unambiguous "force remote refresh"
 * semantic: the cached projection is ignored, the active provider is read, the
 * cache is replaced with the fetched state, and listeners are notified. Without
 * it a fresh cache may be reused; a cache that is stale or belongs to another
 * provider is never presented as cloud state.
 */
async function resolveCanonicalCloudTabState(options = {}) {
  const forceRemote = options.forceRemote === true;
  const provider = await activeProvider();
  if (!(await providerBound())) {
    await invalidateCloudTabCache();
    throw Error("尚未配置云同步后端");
  }

  if (!forceRemote) {
    const cached = await readCloudTabCache();
    if (cached && isCacheUsable(cached, provider)) {
      return { ...cached, source: "cache", stale: false };
    }
  }

  try {
    const state = await pullState();
    const canonical = buildCanonicalCloudTabState(state, {
      provider,
      source: "remote",
      fetchedAt: new Date().toISOString(),
      stale: false,
    });
    await writeCloudTabCache(canonical);
    broadcastCloudTabState(canonical);
    return canonical;
  } catch (error) {
    if (forceRemote) throw error;
    const cached = await readCloudTabCache();
    if (cached && cached.provider === provider)
      return {
        ...cached,
        source: "cache",
        stale: true,
        warning: error?.message || String(error),
      };
    throw error;
  }
}

/**
 * Publish a canonical projection built from a state that was just read back
 * from the provider (post-write verification), so the cache always mirrors the
 * committed cloud state instead of an optimistic local guess.
 */
async function publishCanonicalCloudTabState(state) {
  try {
    const provider = await activeProvider();
    const canonical = buildCanonicalCloudTabState(state, {
      provider,
      source: "remote",
      fetchedAt: new Date().toISOString(),
      stale: false,
    });
    await writeCloudTabCache(canonical);
    broadcastCloudTabState(canonical);
    return canonical;
  } catch (error) {
    await invalidateCloudTabCache();
    console.warn("Canonical cloud tab publish failed", error);
    return null;
  }
}

/**
 * Every mutation of the cloud state must refresh the canonical projection so
 * the next reader (popup or management page) observes the same dataset.
 */
async function refreshCanonicalCloudTabStateAfterMutation(providerOverride = "") {
  try {
    if (!(await providerBound())) {
      await invalidateCloudTabCache();
      return null;
    }
    const provider = providerOverride || (await activeProvider());
    const state = await readRemoteStateOnly();
    const canonical = buildCanonicalCloudTabState(state, {
      provider,
      source: "remote",
      fetchedAt: new Date().toISOString(),
      stale: false,
    });
    await writeCloudTabCache(canonical);
    broadcastCloudTabState(canonical);
    return canonical;
  } catch (error) {
    await invalidateCloudTabCache();
    console.warn("Canonical cloud tab refresh failed", error);
    return null;
  }
}

async function readRemoteStateOnly() {
  const loaded = await readRemote();
  return loaded.state;
}

/** Local browser context shown next to the canonical cloud dataset. */
async function localCloudTabContext() {
  const local = await createSnapshot();
  const localEntities = extractEntities(local);
  return {
    mode: await getTabSyncMode(),
    localTabIds: [...localEntities.keys()]
      .filter((key) => key.startsWith("tabs:"))
      .map((key) => key.slice("tabs:".length)),
    localGroupIds: [...localEntities.keys()]
      .filter((key) => key.startsWith("groups:"))
      .map((key) => key.slice("groups:".length)),
  };
}

/**
 * Single payload shape shared by the popup and the Settings management page so
 * both surfaces render the identical canonical dataset.
 */
function canonicalCloudTabPayload(canonical, local) {
  return {
    version: CLOUD_TAB_STATE_VERSION,
    mode: local.mode,
    localTabIds: local.localTabIds,
    localGroupIds: local.localGroupIds,
    // Canonical reconciliation of windows + groups.
    windows: canonical.windows,
    groups: canonical.groups,
    detachedGroups: canonical.detachedGroups,
    tabs: canonical.tabs,
    counts: canonical.counts,
    // Reconciled snapshot: identical for restore and management paths.
    // Tombstones are already applied by the canonical projection.
    snapshot: canonical.snapshot,
    tombstonesApplied: true,
    revision: canonical.revision,
    updatedAt: canonical.updatedAt,
    checksum: canonical.checksum,
    provider: canonical.provider,
    source: canonical.source,
    stale: canonical.stale,
    warning: canonical.warning || "",
    fetchedAt: canonical.fetchedAt,
  };
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
  // Restore exactly what the canonical projection shows in both UIs.
  const canonical = await resolveCanonicalCloudTabState({});
  const g = (canonical.snapshot?.groups || []).find(
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
/**
 * Provider-agnostic history view.
 *
 * Gist uses native commit history; Google Drive and WebDAV use the
 * application-managed `history/index.json` control file. The shape returned to
 * the UI is identical for all three.
 */
async function historyData() {
  if (!(await providerBound())) throw Error("尚未配置云同步后端");
  const s = await getSettings();
  const provider = await activeProvider();
  const loaded = await readRemote();
  return {
    provider,
    layout: loaded.layout,
    storageLayout: MODULAR_STORAGE_LAYOUT,
    formatVersion: STORAGE_FORMAT_VERSION,
    gistId: s[KEYS.GIST_ID] || "",
    location: provider === "gist" ? s[KEYS.GIST_ID] || "" : provider,
    revision: Number(loaded.state?.revision || loaded.manifest?.revision || 0),
    commits: await remoteRevisions(),
    state: loaded.state,
    modules: loaded.modular?.meta?.modules || [],
    legacyArchive: loaded.legacyArchive || "",
    migratedFromLegacy: !!loaded.migratedFromLegacy,
  };
}
async function rollbackHistory(revision) {
  const settings = await getSettings();
  if (!(await providerBound())) throw Error("尚未配置云同步后端");
  if (!revision) throw Error("缺少历史 Revision");
  const current = await readRemote(),
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
          strategy: "provider-history",
          revision,
          at: now,
        },
      ]),
    };
  next.snapshot.updatedAt = now;
  return {
    ok: true,
    revision: (await saveState(current, next)).revision,
    sourceRevision: revision,
  };
}
async function saveState(loaded, nextState) {
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
  await writeRemote(state, loaded);
  await refreshCanonicalCloudTabStateAfterMutation();
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

    await writeRemote(state, loaded);
    const verify = await readRemote();

    if (
      Number(verify.state.revision) === revision &&
      checksum(verify.state) === checksum(state)
    ) {
      await publishCanonicalCloudTabState(verify.state);
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
        const gdrive = await gdriveStatus();
        return {
          provider,
          bound,
          authenticated:
            (provider === "gist" && !!s[KEYS.GITHUB_TOKEN]) ||
            (provider === "gdrive" && gdrive.connected),
          // Browser-managed OAuth is the normal Drive path; the manual client
          // configuration is only offered where the Identity API cannot mint a
          // token, so the UI needs to know which one applies.
          gdriveConnected: gdrive.connected,
          gdriveMode: gdrive.mode,
          gdriveEmail: gdrive.email,
          gdriveDisplayName: gdrive.displayName,
          gdriveScope: gdrive.scope,
          gdriveConnectedAt: gdrive.connectedAt,
          gdriveBrowserManaged:
            gdrive.browserManagedAvailable &&
            supportsBrowserManagedDriveAuth(),
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
          return { ok: true, ...(await validateGithubToken(m.token || "")) };
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
        const r = await readGistRaw(String(m.gistId), token);
        if (!gistContainsSyncData(r.files))
          throw Error("指定 Gist 不包含 Chromium Cloud Sync 数据");
        await setSettings({
          [KEYS.GITHUB_TOKEN]: token,
          [KEYS.GIST_ID]: m.gistId,
          [KEYS.ETAG]: r.headers.get("ETag") || "",
        });
        await invalidateCloudTabCache();
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
          created = await createRemote(state);
        await setSettings({
          [KEYS.SYNC_REVISION]: 1,
          [KEYS.BASE_SNAPSHOT]: snap,
          [KEYS.BASE_REVISION]: 1,
          [KEYS.LAST_SYNC]: snap.updatedAt,
        });
        await publishCanonicalCloudTabState(state);
        return { id: String(created.location || ""), revision: 1 };
      }
      case "snapshot":
        return createSnapshot();
      case "sync":
        return runSyncWithDiagnostics();
      case "pull": {
        // The popup restore view reads the canonical projection so it can never
        // show a different cloud tab set than the management page.
        const canonical = await resolveCanonicalCloudTabState({
          forceRemote: m.forceRemote === true,
        });
        return canonical.snapshot;
      }
      case "pullState": {
        const canonical = await resolveCanonicalCloudTabState({
          forceRemote: m.forceRemote === true,
        });
        return {
          schemaVersion: canonical.snapshot.schemaVersion,
          revision: canonical.revision,
          updatedAt: canonical.updatedAt,
          snapshot: canonical.snapshot,
          source: canonical.source,
          stale: canonical.stale,
          provider: canonical.provider,
          fetchedAt: canonical.fetchedAt,
        };
      }
      case "restoreTabs":
        return restoreTabs(m.windows, {
          includeGroups: m.includeGroups === true,
          restoreGroupMode: m.restoreGroupMode,
        });
      case "cloudGroups": {
        const canonical = await resolveCanonicalCloudTabState({
          forceRemote: m.forceRemote === true,
        });
        return {
          groups: canonical.groups.map((g) => ({
            syncId: g.syncId,
            title: g.title || "",
            color: g.color || "grey",
            collapsed: !!g.collapsed,
            windowSyncId: g.windowSyncId || "",
            tabCount: g.tabs.length,
            updatedAt: g.updatedAt || "",
            tabs: g.tabs.map((tab) => ({
              syncId: tab.syncId,
              title: tab.title || "",
              url: tab.url || "",
              index: Number.isFinite(tab.index) ? tab.index : 0,
              pinned: !!tab.pinned,
            })),
          })),
          counts: canonical.counts,
          source: canonical.source,
          stale: canonical.stale,
          warning: canonical.warning || "",
          provider: canonical.provider,
          revision: canonical.revision,
          fetchedAt: canonical.fetchedAt,
          checksum: canonical.checksum,
        };
      }
      case "refreshCloudTabState":
        // Explicit force-remote-refresh semantic for the management UI.
        return canonicalCloudTabPayload(
          await resolveCanonicalCloudTabState({ forceRemote: true }),
          await localCloudTabContext(),
        );
      case "restoreGroup":
        return restoreGroup(m.groupSyncId);
      case "cloudTabState": {
        const canonical = await resolveCanonicalCloudTabState({
          forceRemote: m.forceRemote === true,
        });
        return canonicalCloudTabPayload(
          canonical,
          await localCloudTabContext(),
        );
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
        const canonical = await resolveCanonicalCloudTabState({});
        const found = findCloudTab(
          canonical.snapshot,
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
        const webdav = await webdavConfig();
        return {
          provider: await activeProvider(),
          bound: await providerBound(),
          gistId: s[KEYS.GIST_ID] || "",
          gdriveConnected: await gdriveConnected(),
          gdrive: await gdriveStatus(),
          webdavUrl: webdav.url,
          webdavFolder: webdav.folder,
          restoreGroupMode: String(
            s[KEYS.RESTORE_GROUP_MODE] || "ondemand",
          ),
          tabSyncMode: await getTabSyncMode(),
          cloudTabCache: await cloudTabCacheSummary(),
        };
      }
      case "storageLayout":
        return storageLayoutStatus();
      case "setProvider": {
        const value = ["gdrive", "webdav"].includes(String(m.provider))
          ? String(m.provider)
          : "gist";
        await setSettings({ [KEYS.PROVIDER]: value });
        await invalidateCloudTabCache();
        await setupAlarms();
        return { provider: value };
      }
      case "connectGdrive": {
        // Browser-managed OAuth is the normal path: Chromium's account chooser
        // authorizes the minimum drive.file scope and no client configuration is
        // requested. An explicit clientId selects the manual fallback instead.
        const clientId = String(m.clientId || "").trim();
        const auth = clientId
          ? await connectGoogleDriveManual(
              clientId,
              String(m.clientSecret || ""),
            )
          : await connectGoogleDriveBrowser(String(m.email || ""));
        await invalidateCloudTabCache();
        await invalidateGdriveLayout();
        return { ok: true, ...auth };
      }
      case "disconnectGdrive": {
        await disconnectGoogleDrive();
        await invalidateCloudTabCache();
        return { ok: true };
      }
      case "gdriveAuth":
        return gdriveAuthState();
      case "testProvider": {
        const p = await activeProvider();
        if (p === "gist") {
          const s = await getSettings();
          if (!String(s[KEYS.GITHUB_TOKEN] || "").trim())
            throw Error("未配置 GitHub Token");
          await githubRequest("/user", {});
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
        await invalidateCloudTabCache();
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
