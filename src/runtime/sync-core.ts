import type {
  BookmarkRecord,
  ConflictRecord,
  ExtensionRecord,
  MergeResult,
  Snapshot,
  TabGroupRecord,
  TabRecord,
  Tombstone,
  UnknownRecord,
  WindowRecord,
} from "./types.js";

export const SCHEMA_VERSION = 11;
export const HISTORY_LIMIT = 30;

const emptySnapshot = (): Snapshot => ({
  schemaVersion: SCHEMA_VERSION,
  extensions: [],
  windows: [],
  bookmarks: [],
  groups: [],
});
export function clone<T>(value: T): T {
  return value == null ? value : (JSON.parse(JSON.stringify(value)) as T);
}
export function stableEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
function objectId(item: UnknownRecord | null | undefined): string | null {
  if (!item) return null;
  const value = item.syncId ?? item.id ?? item.key;
  return value == null ? null : String(value);
}

const MERGE_POLICIES: Record<
  string,
  Record<string, "latest" | "maxVersion" | "conflict">
> = {
  tabs: {
    title: "latest",
    url: "conflict",
    pinned: "latest",
    active: "latest",
    index: "latest",
    group: "latest",
  },
  bookmarks: {
    title: "latest",
    url: "conflict",
    parentSyncId: "latest",
    index: "latest",
  },
  extensions: {
    enabled: "latest",
    version: "maxVersion",
    homepageUrl: "latest",
    updateUrl: "latest",
    installType: "latest",
  },
  groups: {
    title: "latest",
    color: "latest",
    collapsed: "latest",
    index: "latest",
    updatedAt: "latest",
  },
  windows: { state: "latest", focused: "latest" },
  default: {},
};

export interface MergeOptions {
  tabSyncMode?: "overwrite" | "incremental";
}

function timeOf(value: UnknownRecord | null | undefined): string {
  return String(value?.updatedAt ?? value?.modifiedAt ?? "");
}
function versionTuple(version: unknown): number[] {
  return String(version ?? "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}
function compareVersions(a: unknown, b: unknown): number {
  const A = versionTuple(a),
    B = versionTuple(b);
  for (let i = 0; i < Math.max(A.length, B.length); i += 1) {
    if ((A[i] ?? 0) !== (B[i] ?? 0)) return (A[i] ?? 0) - (B[i] ?? 0);
  }
  return 0;
}
function winnerByLatest(
  local: UnknownRecord,
  remote: UnknownRecord,
): "local" | "remote" {
  const lt = timeOf(local),
    rt = timeOf(remote);
  return lt !== rt ? (lt > rt ? "local" : "remote") : "local";
}

export function mergeField(
  base: unknown,
  local: unknown,
  remote: unknown,
  type: string,
  field: string,
  conflicts: ConflictRecord[],
  path: string,
): unknown {
  if (stableEqual(local, remote)) return clone(local);
  if (stableEqual(local, base)) return clone(remote);
  if (stableEqual(remote, base)) return clone(local);
  const policy = MERGE_POLICIES[type]?.[field] ?? "conflict";
  if (policy === "latest") {
    const side = winnerByLatest(
      (local ?? {}) as UnknownRecord,
      (remote ?? {}) as UnknownRecord,
    );
    conflicts.push({
      type: "field-auto-resolved",
      collection: type,
      syncId: path,
      field,
      status: "resolved",
      winner: side,
      strategy: "latest",
    });
    return clone(side === "local" ? local : remote);
  }
  if (policy === "maxVersion") {
    const side = compareVersions(local, remote) >= 0 ? "local" : "remote";
    conflicts.push({
      type: "field-auto-resolved",
      collection: type,
      syncId: path,
      field,
      status: "resolved",
      winner: side,
      strategy: "maxVersion",
    });
    return clone(side === "local" ? local : remote);
  }
  conflicts.push({
    type: "field-conflict",
    collection: type,
    syncId: path,
    field,
    base: clone(base) as never,
    local: clone(local) as never,
    remote: clone(remote) as never,
    status: "unresolved",
    strategy: "manual",
  });
  return clone(local);
}

export function mergeEntity(
  base: UnknownRecord = {},
  local: UnknownRecord = {},
  remote: UnknownRecord = {},
  type: string,
  conflicts: ConflictRecord[],
  path: string,
): UnknownRecord {
  if (stableEqual(local, remote)) return clone(local);
  if (stableEqual(local, base)) return clone(remote);
  if (stableEqual(remote, base)) return clone(local);
  const out: UnknownRecord = {};
  const keys = new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);
  for (const key of keys) {
    const hasB = Object.prototype.hasOwnProperty.call(base, key),
      hasL = Object.prototype.hasOwnProperty.call(local, key),
      hasR = Object.prototype.hasOwnProperty.call(remote, key);
    const b = hasB ? base[key] : undefined,
      l = hasL ? local[key] : undefined,
      r = hasR ? remote[key] : undefined;
    if (Array.isArray(l) && Array.isArray(r)) {
      out[key] = mergeArray(b, l, r, conflicts, `${path}.${key}`);
      continue;
    }
    if (
      l &&
      r &&
      typeof l === "object" &&
      typeof r === "object" &&
      !Array.isArray(l) &&
      !Array.isArray(r)
    ) {
      out[key] = mergeEntity(
        (b && typeof b === "object" && !Array.isArray(b)
          ? b
          : {}) as UnknownRecord,
        l as UnknownRecord,
        r as UnknownRecord,
        type,
        conflicts,
        `${path}.${key}`,
      );
      continue;
    }
    if (!hasL && !hasR) continue;
    if (!hasL) {
      if (hasB && !stableEqual(r, b))
        conflicts.push({
          type: "delete-vs-modify",
          collection: type,
          syncId: path,
          field: key,
          status: "unresolved",
          winner: "remote",
        });
      if (hasR) out[key] = clone(r);
      continue;
    }
    if (!hasR) {
      if (hasB && !stableEqual(l, b))
        conflicts.push({
          type: "delete-vs-modify",
          collection: type,
          syncId: path,
          field: key,
          status: "unresolved",
          winner: "local",
        });
      out[key] = clone(l);
      continue;
    }
    out[key] = mergeField(b, l, r, type, key, conflicts, `${path}.${key}`);
  }
  return out;
}

function mergeArray<T extends UnknownRecord = UnknownRecord>(
  base: unknown,
  local: unknown[],
  remote: unknown[],
  conflicts: ConflictRecord[],
  path: string,
  preserveNestedTabs = false,
): T[] {
  const B = Array.isArray(base) ? base : [];
  if (stableEqual(local, remote)) return clone(local) as T[];
  if (!preserveNestedTabs && stableEqual(local, B))
    return clone(remote) as T[];
  if (!preserveNestedTabs && stableEqual(remote, B))
    return clone(local) as T[];

  const BObjects = B.filter(
    (x): x is UnknownRecord =>
      !!x && typeof x === "object" && !Array.isArray(x),
  );
  const LObjects = local.filter(
    (x): x is UnknownRecord =>
      !!x && typeof x === "object" && !Array.isArray(x),
  );
  const RObjects = remote.filter(
    (x): x is UnknownRecord =>
      !!x && typeof x === "object" && !Array.isArray(x),
  );

  if ([...BObjects, ...LObjects, ...RObjects].some((x) => !objectId(x))) {
    conflicts.push({
      type: "array-conflict",
      collection: path,
      syncId: path,
      status: "unresolved",
      winner: "local",
      base: clone(B) as never,
      local: clone(local) as never,
      remote: clone(remote) as never,
    });
    return clone(local) as T[];
  }

  const bm = new Map(BObjects.map((x) => [String(objectId(x)), x]));
  const lm = new Map(LObjects.map((x) => [String(objectId(x)), x]));
  const rm = new Map(RObjects.map((x) => [String(objectId(x)), x]));
  const out: T[] = [];

  for (const id of new Set([...bm.keys(), ...lm.keys(), ...rm.keys()])) {
    const b = bm.get(id);
    const l = lm.get(id);
    const r = rm.get(id);
    const type = path.endsWith(".tabs")
    ? "tabs"
    : path.split(".")[0] || "objects";
    if (!l && !r) continue;
    if (l && !r) {
      if (b && !stableEqual(l, b))
        conflicts.push({
          type: "delete-vs-modify",
          collection: type,
          syncId: id,
          status: "unresolved",
          winner: "local",
        });
      out.push(clone(l) as T);
      continue;
    }
    if (!l && r) {
      if (b && !stableEqual(r, b))
        conflicts.push({
          type: "delete-vs-modify",
          collection: type,
          syncId: id,
          status: "unresolved",
          winner: "remote",
        });
      out.push(clone(r) as T);
      continue;
    }
    const merged = mergeEntity(
      b ?? {},
      l!,
      r!,
      type,
      conflicts,
      `${type}.${id}`,
    ) as T;

    if (preserveNestedTabs && (type === "windows" || type === "groups")) {
      (merged as UnknownRecord).tabs = mergeArray(
        (b?.tabs as unknown[]) ?? [],
        (l?.tabs as unknown[]) ?? [],
        (r?.tabs as unknown[]) ?? [],
        conflicts,
        "tabs",
        true,
      );
    }

    out.push(merged);
  }

  out.sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
  return out;
}

function preserveRemoteOrder<T extends UnknownRecord>(
  merged: T[],
  remote: unknown[],
): T[] {
  const remoteOrder = new Map<string, number>();

  for (let index = 0; index < remote.length; index += 1) {
    const raw = remote[index];
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      continue;

    const id = objectId(raw as UnknownRecord);
    if (id) remoteOrder.set(id, index);
  }

  return merged
    .slice()
    .sort((a, b) => {
      const ai = remoteOrder.get(String(objectId(a)));
      const bi = remoteOrder.get(String(objectId(b)));

      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return Number(a.index ?? 0) - Number(b.index ?? 0);
    })
    .map((item, index) => ({
      ...item,
      index,
    }));
}

export function mergeSnapshots(
  base: Snapshot = emptySnapshot(),
  local: Snapshot = emptySnapshot(),
  remote: Snapshot = emptySnapshot(),
  options: MergeOptions = {},
): MergeResult {
  const conflicts: ConflictRecord[] = [];
  const out: Snapshot = {
    schemaVersion: SCHEMA_VERSION,
    extensions: [],
    windows: [],
    bookmarks: [],
    groups: [],
  };
  const syncMeta = local.syncMeta ?? remote.syncMeta ?? base.syncMeta;
  if (syncMeta !== undefined) out.syncMeta = clone(syncMeta);
  if (local.device !== undefined) out.device = clone(local.device);
  const BWin = base.windows ?? [],
    LWin = local.windows ?? [],
    RWin = remote.windows ?? [];
  if (options.tabSyncMode === "incremental") {
    out.windows = mergeArray<WindowRecord>(
      BWin,
      LWin,
      RWin,
      conflicts,
      "windows",
      true,
    );
  } else if (stableEqual(LWin, RWin)) {
    out.windows = clone(LWin);
  } else if (stableEqual(LWin, BWin)) {
    out.windows = clone(RWin);
  } else if (stableEqual(RWin, BWin)) {
    out.windows = clone(LWin);
  } else {
    out.windows = clone(LWin);
    conflicts.push({
      type: "collection-auto-resolved",
      collection: "windows",
      status: "resolved",
      winner: "local",
      strategy: "device-live-state",
    });
  }
  out.groups = mergeArray<TabGroupRecord>(
    base.groups ?? [],
    local.groups ?? [],
    remote.groups ?? [],
    conflicts,
    "groups",
    true,
  );
  if (options.tabSyncMode === "incremental")
    out.groups = preserveRemoteOrder(
      out.groups,
      remote.groups ?? [],
    );
  out.extensions = mergeArray<ExtensionRecord>(
    base.extensions,
    local.extensions,
    remote.extensions,
    conflicts,
    "extensions",
  );
  out.bookmarks = mergeArray<BookmarkRecord>(
    base.bookmarks,
    local.bookmarks,
    remote.bookmarks,
    conflicts,
    "bookmarks",
  );
  if (options.tabSyncMode === "incremental") {
    const remoteWindows = new Map(
      RWin.map((window) => [
        window.syncId,
        window,
      ]),
    );

    for (const window of out.windows) {
      const remoteWindow = remoteWindows.get(
        window.syncId,
      );
      if (remoteWindow) {
        window.tabs = preserveRemoteOrder(
          window.tabs ?? [],
          remoteWindow.tabs ?? [],
        );
      }
    }

    const remoteGroups = new Map(
      (remote.groups ?? []).map((group) => [
        group.syncId,
        group,
      ]),
    );

    for (const group of out.groups) {
      const remoteGroup = remoteGroups.get(
        group.syncId,
      );
      if (remoteGroup) {
        group.tabs = preserveRemoteOrder(
          group.tabs ?? [],
          remoteGroup.tabs ?? [],
        );
      }
    }
  }

  out.updatedAt = new Date().toISOString();
  return { snapshot: out, conflicts };
}

export function extractEntities(
  snapshot: Snapshot,
): Map<string, UnknownRecord> {
  const result = new Map<string, UnknownRecord>();
  const put = (collection: string, item: UnknownRecord): void => {
    const id = objectId(item);
    if (id) result.set(`${collection}:${id}`, clone(item));
  };
  for (const extension of snapshot.extensions ?? [])
    put("extensions", extension);
  for (const window of snapshot.windows ?? []) {
    put("windows", window);
    for (const tab of window.tabs ?? []) {
      put("tabs", tab);
      if (tab.group?.syncId) put("groups", tab.group);
    }
  }
  for (const group of snapshot.groups ?? []) {
    put("groups", group);
    for (const tab of group.tabs ?? []) put("tabs", tab);
  }
  for (const bookmark of snapshot.bookmarks ?? []) put("bookmarks", bookmark);
  return result;
}

export function deriveTombstones(
  base: Snapshot,
  local: Snapshot,
  prior: Tombstone[] = [],
  revision = 0,
  updatedAt = new Date().toISOString(),
  preserveLiveCollections = false,
): Tombstone[] {
  const bm = extractEntities(base),
    lm = extractEntities(local);
  const preservedCollections = new Set([
    "windows",
    "tabs",
    "groups",
  ]);
  const map = new Map<string, Tombstone>(
    (prior ?? []).map((t) => [
      t.collection + ":" + t.syncId,
      clone(t),
    ]),
  );
  for (const key of bm.keys()) {
    if (lm.has(key)) continue;
    const parts = key.split(/:(.+)/);
    const collection = parts[0] || "";
    const syncId = parts[1] || "";
    if (
      preserveLiveCollections &&
      preservedCollections.has(collection)
    )
      continue;
    if (collection && syncId)
      map.set(key, {
        collection,
        syncId,
        deletedAt: updatedAt,
        revision,
      });
  }
  for (const key of lm.keys()) {
    const collection = key.split(/:(.+)/)[0] || "";
    if (
      preserveLiveCollections &&
      preservedCollections.has(collection)
    )
      continue;
    map.delete(key);
  }
  return [...map.values()];
}
export function mergeTombstones(...sources: Tombstone[][]): Tombstone[] {
  const map = new Map<string, Tombstone>();
  for (const list of sources)
    for (const tombstone of list ?? []) {
      const key = `${tombstone.collection}:${tombstone.syncId}`,
        old = map.get(key);
      if (!old || String(tombstone.deletedAt) > String(old.deletedAt))
        map.set(key, clone(tombstone));
    }
  return [...map.values()];
}
export function applyTombstones(
  snapshot: Snapshot,
  tombstones: Tombstone[] = [],
): Snapshot {
  const deleted = new Set(
      (tombstones ?? []).map((t) => `${t.collection}:${t.syncId}`),
    ),
    out = clone(snapshot);
  out.extensions = (out.extensions ?? []).filter(
    (x) => !deleted.has(`extensions:${objectId(x)}`),
  );
  out.windows = (out.windows ?? []).filter(
    (w) => !deleted.has(`windows:${objectId(w)}`),
  );
  for (const window of out.windows)
    window.tabs = (window.tabs ?? []).filter(
      (t) => !deleted.has(`tabs:${objectId(t)}`),
    );
  out.bookmarks = (out.bookmarks ?? []).filter(
    (b) => !deleted.has(`bookmarks:${objectId(b)}`),
  );
  out.groups = (out.groups ?? []).filter(
    (g) => !deleted.has(`groups:${objectId(g)}`),
  );

  for (const g of out.groups ?? []) {
    if (Array.isArray(g.tabs)) {
      g.tabs = (g.tabs as TabRecord[]).filter(
        (t) => !deleted.has(`tabs:${objectId(t)}`),
      );
    }
  }
  return out;
}
export function mergeDeviceStates(
  devices: Record<string, unknown>,
): Snapshot | null {
  const entries = Object.values(devices ?? {}).filter(
    (entry): entry is UnknownRecord =>
      !!entry && typeof entry === "object" && !Array.isArray(entry),
  );
  if (!entries.length) return null;
  entries.sort((a, b) =>
    String(a.updatedAt ?? "").localeCompare(String(b.updatedAt ?? "")),
  );
  const merged: Snapshot = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: String(entries.at(-1)?.updatedAt ?? new Date().toISOString()),
    extensions: [],
    bookmarks: [],
    windows: [],
    groups: [],
  };
  const collections: Array<"extensions" | "bookmarks" | "windows" | "groups"> =
    ["extensions", "bookmarks", "windows", "groups"];
  for (const collection of collections) {
    const map = new Map<string, { item: UnknownRecord; updatedAt: string }>();
    for (const entry of entries) {
      const snap = entry.snapshot as UnknownRecord | undefined;
      const array =
        snap && Array.isArray(snap[collection]) ? snap[collection] : [];
      for (const raw of array as unknown[]) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const item = raw as UnknownRecord,
          id = objectId(item);
        if (!id) continue;
        const candidate = { item, updatedAt: String(entry.updatedAt ?? "") },
          previous = map.get(id);
        if (!previous || candidate.updatedAt >= previous.updatedAt)
          map.set(id, candidate);
      }
    }
    merged[collection] = [...map.values()].map((x) => clone(x.item)) as never;
  }
  return merged;
}
export function cleanConflicts(
  conflicts: ConflictRecord[] = [],
): ConflictRecord[] {
  return (conflicts ?? []).filter((conflict) => {
    if (
      !conflict ||
      conflict.status === "resolved" ||
      conflict.status === "ignored"
    )
      return false;
    const values = [conflict.base, conflict.local, conflict.remote].filter(
      (value) => value !== undefined && value !== null,
    );
    const meaningful = values.some((value) =>
      typeof value === "object" && value !== null
        ? Object.keys(value as object).length > 0
        : String(value) !== "",
    );
    return (
      (meaningful || conflict.type === "rollback") &&
      (!!conflict.collection || !!conflict.type)
    );
  });
}
export function checksum(value: unknown): string {
  let hash = 2166136261;
  const serialized = JSON.stringify(value);
  for (let i = 0; i < serialized.length; i += 1) {
    hash ^= serialized.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
export function pushHistoryIndex<T>(history: T[], entry: T): T[] {
  return [entry, ...(history ?? [])].slice(0, HISTORY_LIMIT);
}
