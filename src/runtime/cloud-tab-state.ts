import type {
  CloudState,
  Snapshot,
  TabGroupRecord,
  TabRecord,
  UnknownRecord,
  WindowRecord,
} from "./types.js";
import {
  SCHEMA_VERSION,
  applyTombstones,
  checksum,
  clone,
} from "./sync-core.js";

/**
 * Canonical cloud tab state.
 *
 * The popup restore view and the Settings -> Cloud Tabs management view used to
 * build their own projections of the remote payload. The popup enumerated
 * `snapshot.groups` while the management page enumerated `snapshot.windows` and
 * re-derived groups from `tab.group.syncId`. Those two projections disagree as
 * soon as a group exists without a window reference, or a window tab references
 * a group that is missing from `snapshot.groups`, so one cloud state was
 * rendered as two different tab sets.
 *
 * This module is the single projection consumed by every cloud-tab surface: it
 * applies tombstones, reconciles windows and groups into one dataset, and
 * re-emits a snapshot that restore actions can consume directly.
 */

export const CLOUD_TAB_STATE_VERSION = 1;
export const CLOUD_TAB_STATE_CACHE_KEY = "cloudTabStateCache";
export const CLOUD_TAB_STATE_CACHE_TTL_MS = 15_000;

export type CanonicalTabOrigin = "window" | "group" | "both";
export type CanonicalStateSource = "remote" | "cache";

export interface CanonicalCloudTab {
  syncId: string;
  url: string;
  title: string;
  pinned: boolean;
  active: boolean;
  index: number;
  groupSyncId: string | null;
  windowSyncId: string | null;
  origin: CanonicalTabOrigin;
}

export interface CanonicalCloudGroup {
  syncId: string;
  title: string;
  color: string;
  collapsed: boolean;
  index: number;
  updatedAt: string;
  windowSyncId: string | null;
  tabs: CanonicalCloudTab[];
}

export interface CanonicalCloudWindow {
  syncId: string;
  state: string;
  focused: boolean;
  index: number;
  tabs: CanonicalCloudTab[];
  groups: CanonicalCloudGroup[];
  ungroupedTabs: CanonicalCloudTab[];
}

export interface CanonicalCloudTabCounts {
  windows: number;
  groups: number;
  tabs: number;
  groupedTabs: number;
  ungroupedTabs: number;
  detachedGroups: number;
}

export interface CanonicalCloudTabState {
  version: number;
  provider: string;
  source: CanonicalStateSource;
  fetchedAt: string;
  revision: number;
  updatedAt: string;
  stale: boolean;
  warning?: string;
  checksum: string;
  counts: CanonicalCloudTabCounts;
  windows: CanonicalCloudWindow[];
  groups: CanonicalCloudGroup[];
  detachedGroups: CanonicalCloudGroup[];
  tabs: CanonicalCloudTab[];
  snapshot: Snapshot;
}

export interface CanonicalProjectionOptions {
  provider?: string;
  source?: CanonicalStateSource;
  fetchedAt?: string;
  stale?: boolean;
  warning?: string;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRestorableUrl(value: unknown): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function normalizeIndex(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function byIndex(a: { index: number }, b: { index: number }): number {
  return a.index - b.index;
}

function emptySnapshot(schemaVersion: number): Snapshot {
  return {
    schemaVersion: Number.isFinite(schemaVersion) && schemaVersion > 0
      ? schemaVersion
      : SCHEMA_VERSION,
    extensions: [],
    windows: [],
    bookmarks: [],
    groups: [],
  };
}

function syncIdOf(value: unknown, fallback: string): string {
  if (isRecord(value) && typeof value.syncId === "string" && value.syncId)
    return value.syncId;
  return fallback;
}

/**
 * Project a cloud state into the single canonical cloud-tab dataset.
 *
 * Windows and groups are reconciled instead of competing: a tab reachable from
 * either side appears exactly once, and every group is attached to the window
 * that references it or reported as a detached cloud-only group.
 */
export function buildCanonicalCloudTabState(
  state: CloudState | null | undefined,
  options: CanonicalProjectionOptions = {},
): CanonicalCloudTabState {
  const input = isRecord(state) ? (state as CloudState) : null;
  const schemaVersion = Number(
    input?.snapshot?.schemaVersion ?? input?.schemaVersion ?? SCHEMA_VERSION,
  );
  const rawSnapshot = isRecord(input?.snapshot)
    ? (input.snapshot as Snapshot)
    : emptySnapshot(schemaVersion);
  const snapshot = applyTombstones(
    clone(rawSnapshot),
    Array.isArray(input?.tombstones) ? (input.tombstones ?? []) : [],
  );

  const groupMeta = new Map<string, TabGroupRecord>();
  for (const group of snapshot.groups ?? []) {
    if (!isRecord(group)) continue;
    const id = syncIdOf(group, "");
    if (id) groupMeta.set(id, group as TabGroupRecord);
  }

  interface WindowDraft {
    syncId: string;
    state: string;
    focused: boolean;
    index: number;
    tabs: CanonicalCloudTab[];
    ungroupedTabs: CanonicalCloudTab[];
    groupIds: string[];
  }

  const windowDrafts: WindowDraft[] = [];
  const groupOrder: string[] = [];
  const groupWindow = new Map<string, string>();
  const groupBuckets = new Map<string, CanonicalCloudTab[]>();
  const knownTabs = new Map<string, CanonicalCloudTab>();

  const bucketFor = (id: string): CanonicalCloudTab[] => {
    const existing = groupBuckets.get(id);
    if (existing) return existing;
    const created: CanonicalCloudTab[] = [];
    groupBuckets.set(id, created);
    return created;
  };

  (snapshot.windows ?? []).forEach((rawWindow, windowIndex) => {
    if (!isRecord(rawWindow)) return;
    const window = rawWindow as WindowRecord;
    const windowSyncId = syncIdOf(window, `window-${windowIndex}`);
    const draft: WindowDraft = {
      syncId: windowSyncId,
      state:
        typeof window.state === "string" && window.state
          ? window.state
          : "normal",
      focused: window.focused === true,
      index: windowIndex,
      tabs: [],
      ungroupedTabs: [],
      groupIds: [],
    };

    const rawTabs = Array.isArray(window.tabs) ? window.tabs : [];
    const usable = rawTabs
      .map((tab, position) => ({ tab, position }))
      .filter(
        (entry): entry is { tab: TabRecord; position: number } =>
          isRecord(entry.tab) && isRestorableUrl(entry.tab.url),
      )
      .sort(
        (a, b) =>
          normalizeIndex(a.tab.index, a.position) -
          normalizeIndex(b.tab.index, b.position),
      );

    usable.forEach((entry, orderedPosition) => {
      const tab = entry.tab;
      const inlineGroup = isRecord(tab.group)
        ? (tab.group as TabGroupRecord)
        : null;
      const groupSyncId = inlineGroup ? syncIdOf(inlineGroup, "") : "";
      if (groupSyncId && !groupMeta.has(groupSyncId) && inlineGroup)
        groupMeta.set(groupSyncId, inlineGroup);

      const canonical: CanonicalCloudTab = {
        syncId: syncIdOf(tab, `tab-${windowSyncId}-${entry.position}`),
        url: String(tab.url),
        title: typeof tab.title === "string" ? tab.title : "",
        pinned: tab.pinned === true,
        active: tab.active === true,
        index: normalizeIndex(tab.index, orderedPosition),
        groupSyncId: groupSyncId || null,
        windowSyncId,
        origin: "window",
      };
      draft.tabs.push(canonical);

      const previous = knownTabs.get(canonical.syncId);
      if (previous) previous.origin = "both";
      else knownTabs.set(canonical.syncId, canonical);

      if (!groupSyncId) {
        draft.ungroupedTabs.push(canonical);
        return;
      }
      if (!draft.groupIds.includes(groupSyncId)) draft.groupIds.push(groupSyncId);
      if (!groupOrder.includes(groupSyncId)) groupOrder.push(groupSyncId);
      if (!groupWindow.has(groupSyncId)) groupWindow.set(groupSyncId, windowSyncId);
      // Group buckets hold their own copies: index means "position inside the
      // group" there, while the window copy keeps "position inside the window".
      bucketFor(groupSyncId).push({ ...canonical, origin: "window" });
    });

    draft.tabs.sort(byIndex).forEach((tab, index) => {
      tab.index = index;
    });
    draft.ungroupedTabs.sort(byIndex);
    windowDrafts.push(draft);
  });

  // Groups declared in snapshot.groups but never referenced by a window still
  // belong to the canonical dataset, otherwise the popup (which enumerates
  // groups) and the management page (which enumerates windows) diverge.
  for (const rawGroup of snapshot.groups ?? []) {
    if (!isRecord(rawGroup)) continue;
    const group = rawGroup as TabGroupRecord;
    const id = syncIdOf(group, "");
    if (!id) continue;
    if (!groupOrder.includes(id)) groupOrder.push(id);
    const bucket = bucketFor(id);
    for (const rawTab of Array.isArray(group.tabs) ? group.tabs : []) {
      if (!isRecord(rawTab) || !isRestorableUrl(rawTab.url)) continue;
      const tab = rawTab as TabRecord;
      const tabSyncId = syncIdOf(tab, "");
      if (!tabSyncId) continue;
      const alreadyBucketed = bucket.find(
        (entry) => entry.syncId === tabSyncId,
      );
      if (alreadyBucketed) {
        // Declared by a window and by snapshot.groups: one tab, two sources.
        alreadyBucketed.origin = "both";
        const seen = knownTabs.get(tabSyncId);
        if (seen) seen.origin = "both";
        continue;
      }
      const seen = knownTabs.get(tabSyncId);
      if (seen) {
        seen.origin = "both";
        bucket.push({ ...seen, groupSyncId: id, origin: "both" });
        continue;
      }
      const canonical: CanonicalCloudTab = {
        syncId: tabSyncId,
        url: String(tab.url),
        title: typeof tab.title === "string" ? tab.title : "",
        pinned: tab.pinned === true,
        active: tab.active === true,
        index: normalizeIndex(tab.index, bucket.length),
        groupSyncId: id,
        windowSyncId: null,
        origin: "group",
      };
      knownTabs.set(tabSyncId, canonical);
      bucket.push({ ...canonical });
    }
  }

  const groups: CanonicalCloudGroup[] = groupOrder.map((id, order) => {
    const meta = groupMeta.get(id);
    const bucket = (groupBuckets.get(id) ?? []).slice().sort(byIndex);
    const seen = new Set<string>();
    const tabs = bucket.filter((tab) => {
      if (seen.has(tab.syncId)) return false;
      seen.add(tab.syncId);
      return true;
    });
    tabs.forEach((tab, index) => {
      tab.index = index;
    });
    const declared =
      typeof meta?.index === "number" && Number.isFinite(meta.index)
        ? meta.index
        : order;
    return {
      syncId: id,
      title: typeof meta?.title === "string" ? meta.title : "",
      color:
        typeof meta?.color === "string" && meta.color ? meta.color : "grey",
      collapsed: meta?.collapsed === true,
      index: declared < 0 ? order : declared,
      updatedAt: typeof meta?.updatedAt === "string" ? meta.updatedAt : "",
      windowSyncId: groupWindow.get(id) ?? null,
      tabs,
    };
  });

  const windows: CanonicalCloudWindow[] = windowDrafts.map((draft) => ({
    syncId: draft.syncId,
    state: draft.state,
    focused: draft.focused,
    index: draft.index,
    tabs: draft.tabs,
    groups: draft.groupIds
      .map((id) => groups.find((group) => group.syncId === id))
      .filter((group): group is CanonicalCloudGroup => !!group),
    ungroupedTabs: draft.ungroupedTabs,
  }));

  const detachedGroups = groups.filter((group) => !group.windowSyncId);
  const allTabs = [...knownTabs.values()].sort((a, b) =>
    a.syncId.localeCompare(b.syncId),
  );
  const groupedTabs = allTabs.filter((tab) => tab.groupSyncId).length;
  const reconciled = reconcileSnapshot(snapshot, windows, groups);
  reconciled.schemaVersion =
    Number(snapshot.schemaVersion) > 0
      ? Number(snapshot.schemaVersion)
      : SCHEMA_VERSION;
  const fetchedAt = options.fetchedAt ?? new Date().toISOString();
  const payload: CanonicalCloudTabState = {
    version: CLOUD_TAB_STATE_VERSION,
    provider: options.provider ?? "",
    source: options.source ?? "remote",
    fetchedAt,
    revision: Number(input?.revision ?? 0) || 0,
    updatedAt:
      typeof input?.updatedAt === "string" && input.updatedAt
        ? input.updatedAt
        : (reconciled.updatedAt ?? fetchedAt),
    stale: options.stale === true,
    checksum: checksum({
      windows: reconciled.windows,
      groups: reconciled.groups,
    }),
    counts: {
      windows: windows.length,
      groups: groups.length,
      tabs: allTabs.length,
      groupedTabs,
      ungroupedTabs: allTabs.length - groupedTabs,
      detachedGroups: detachedGroups.length,
    },
    windows,
    groups,
    detachedGroups,
    tabs: allTabs,
    snapshot: reconciled,
  };
  if (options.warning) payload.warning = options.warning;
  return payload;
}

function reconcileSnapshot(
  snapshot: Snapshot,
  windows: CanonicalCloudWindow[],
  groups: CanonicalCloudGroup[],
): Snapshot {
  const groupById = new Map(groups.map((group) => [group.syncId, group]));

  const toTabRecord = (tab: CanonicalCloudTab): TabRecord => {
    const group = tab.groupSyncId ? groupById.get(tab.groupSyncId) : undefined;
    return {
      syncId: tab.syncId,
      url: tab.url,
      title: tab.title,
      pinned: tab.pinned,
      active: tab.active,
      index: tab.index,
      group: group
        ? {
            syncId: group.syncId,
            title: group.title,
            color: group.color,
            collapsed: group.collapsed,
          }
        : null,
    };
  };

  const reconciledWindows: WindowRecord[] = windows.map((window) => ({
    syncId: window.syncId,
    state: window.state,
    focused: window.focused,
    tabs: window.tabs.slice().sort(byIndex).map(toTabRecord),
  }));

  const reconciledGroups: TabGroupRecord[] = groups.map((group) => {
    const record: TabGroupRecord = {
      syncId: group.syncId,
      title: group.title,
      color: group.color,
      collapsed: group.collapsed,
      index: group.index,
      tabs: group.tabs.slice().sort(byIndex).map(toTabRecord),
    };
    if (group.updatedAt) record.updatedAt = group.updatedAt;
    const meta = (snapshot.groups ?? []).find(
      (entry) => syncIdOf(entry, "") === group.syncId,
    );
    if (meta) {
      if (typeof meta.localId === "number") record.localId = meta.localId;
      if (typeof meta.windowId === "number") record.windowId = meta.windowId;
    }
    return record;
  });

  return {
    ...clone(snapshot),
    windows: reconciledWindows,
    groups: reconciledGroups,
  };
}

export function isCanonicalCloudTabState(
  value: unknown,
): value is CanonicalCloudTabState {
  if (!isRecord(value)) return false;
  const candidate = value as Partial<CanonicalCloudTabState>;
  return (
    candidate.version === CLOUD_TAB_STATE_VERSION &&
    Array.isArray(candidate.windows) &&
    Array.isArray(candidate.groups) &&
    Array.isArray(candidate.tabs) &&
    isRecord(candidate.snapshot) &&
    isRecord(candidate.counts) &&
    typeof candidate.fetchedAt === "string"
  );
}

/**
 * A cached projection is reusable only for the provider that produced it and
 * only inside the freshness window. Anything else must be re-read from the
 * cloud so stale local data is never presented as the latest cloud state.
 */
export function isCacheUsable(
  cache: unknown,
  provider: string,
  now: number = Date.now(),
  ttlMs: number = CLOUD_TAB_STATE_CACHE_TTL_MS,
): cache is CanonicalCloudTabState {
  if (!isCanonicalCloudTabState(cache)) return false;
  if (cache.provider !== provider) return false;
  const fetched = Date.parse(cache.fetchedAt);
  if (!Number.isFinite(fetched)) return false;
  return now - fetched <= ttlMs;
}

export function cacheAgeMs(
  cache: CanonicalCloudTabState,
  now: number = Date.now(),
): number {
  const fetched = Date.parse(cache.fetchedAt);
  return Number.isFinite(fetched) ? now - fetched : Number.POSITIVE_INFINITY;
}
