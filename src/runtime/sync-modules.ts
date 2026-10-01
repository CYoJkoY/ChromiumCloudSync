import type {
  BookmarkRecord,
  CloudState,
  ConflictRecord,
  ExtensionRecord,
  Snapshot,
  TabGroupRecord,
  Tombstone,
  UnknownRecord,
  WindowRecord,
} from "./types.js";
import {
  SCHEMA_VERSION,
  checksum,
  clone,
  mergeBookmarksModule,
  mergeExtensionsModule,
  mergeTabsModule,
  stableEqual,
} from "./sync-core.js";
import type { MergeOptions } from "./sync-core.js";

/**
 * Modular synchronization storage.
 * ...
 */
export const STORAGE_FORMAT_VERSION = 1;
export const MODULAR_STORAGE_LAYOUT = "modular-v1";
export const LEGACY_MONOLITHIC_FILE = "current.json";
export const MANIFEST_FILE = "manifest.json";
export const META_FILE = "meta.json";
export const HISTORY_INDEX_FILE = "history/index.json";
export const LEGACY_ALT_FILE = "chromium-cloud-sync.json";

export type SyncModuleId = "extensions" | "bookmarks" | "tabs";

export const SYNC_MODULE_IDS: readonly SyncModuleId[] = [
  "extensions",
  "bookmarks",
  "tabs",
];

export const MODULE_FILES: Record<SyncModuleId, string> = {
  extensions: "extensions.json",
  bookmarks: "bookmarks.json",
  tabs: "tabs.json",
};

export const COLLECTION_MODULES: Record<string, SyncModuleId> = {
  extensions: "extensions",
  bookmarks: "bookmarks",
  windows: "tabs",
  tabs: "tabs",
  groups: "tabs",
};

export interface ExtensionsModuleData {
  extensions: ExtensionRecord[];
}

export interface BookmarksModuleData {
  bookmarks: BookmarkRecord[];
}

export interface TabsModuleData {
  windows: WindowRecord[];
  groups: TabGroupRecord[];
}

export type ModuleData =
  | ExtensionsModuleData
  | BookmarksModuleData
  | TabsModuleData;

export interface ModuleEnvelope {
  schemaVersion: number;
  formatVersion: number;
  module: SyncModuleId;
  file: string;
  revision: number;
  updatedAt: string;
  checksum: string;
  data: ModuleData;
  tombstones: Tombstone[];
}

export interface ModuleIndexEntry {
  module: SyncModuleId;
  file: string;
  revision: number;
  updatedAt: string;
  checksum: string;
  tombstones: number;
}

export interface LegacyMigrationRecord {
  from: string;
  migratedAt: string;
  legacyRevision: number;
  legacyChecksum: string;
  preservedFile: string | null;
}

export interface SyncMetaPayload {
  schemaVersion: number;
  formatVersion: number;
  revision: number;
  updatedAt: string;
  conflicts: ConflictRecord[];
  modules: ModuleIndexEntry[];
  syncMeta?: UnknownRecord;
  orphanTombstones?: Tombstone[];
  migration?: LegacyMigrationRecord;
}

export interface StorageManifest {
  schemaVersion: number;
  formatVersion: number;
  layout: typeof MODULAR_STORAGE_LAYOUT;
  currentFile: null;
  revision: number;
  lastUpdatedAt: string;
  files: Record<string, string>;
  legacyArchive: string | null;
}

export interface ModularCloudState {
  manifest: StorageManifest;
  meta: SyncMetaPayload;
  modules: Record<SyncModuleId, ModuleEnvelope>;
}

export class ModularStorageError extends Error {
  readonly code = "MODULAR_STORAGE_FAILED";
  constructor(message: string) {
    super(message);
    this.name = "ModularStorageError";
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

export function emptySnapshot(): Snapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    extensions: [],
    windows: [],
    bookmarks: [],
    groups: [],
  };
}

function arrayOf<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function moduleForCollection(collection: string): SyncModuleId | null {
  return COLLECTION_MODULES[collection] ?? null;
}

export function partitionTombstones(tombstones: Tombstone[] = []): {
  byModule: Record<SyncModuleId, Tombstone[]>;
  orphans: Tombstone[];
} {
  const byModule: Record<SyncModuleId, Tombstone[]> = {
    extensions: [],
    bookmarks: [],
    tabs: [],
  };
  const orphans: Tombstone[] = [];
  for (const tombstone of arrayOf<Tombstone>(tombstones)) {
    if (!isRecord(tombstone)) continue;
    const moduleId = moduleForCollection(String(tombstone.collection ?? ""));
    if (moduleId) byModule[moduleId].push(clone(tombstone));
    else orphans.push(clone(tombstone));
  }
  return { byModule, orphans };
}

function dataChecksum(data: ModuleData, tombstones: Tombstone[]): string {
  return checksum({ data, tombstones });
}

function buildEnvelope(
  moduleId: SyncModuleId,
  data: ModuleData,
  tombstones: Tombstone[],
  revision: number,
  updatedAt: string,
): ModuleEnvelope {
  return {
    schemaVersion: SCHEMA_VERSION,
    formatVersion: STORAGE_FORMAT_VERSION,
    module: moduleId,
    file: MODULE_FILES[moduleId],
    revision,
    updatedAt,
    checksum: dataChecksum(data, tombstones),
    data,
    tombstones: arrayOf<Tombstone>(tombstones),
  };
}

export interface SplitOptions {
  revision?: number;
  updatedAt?: string;
  conflicts?: ConflictRecord[];
  moduleRevisions?: Partial<Record<SyncModuleId, number>>;
  migration?: LegacyMigrationRecord;
  legacyArchive?: string | null;
  providerFormat?: string;
}

export function splitCloudState(
  state: CloudState | null | undefined,
  options: SplitOptions = {},
): ModularCloudState {
  const snapshot = (
    isRecord(state?.snapshot) ? (state?.snapshot as Snapshot) : emptySnapshot()
  ) as Snapshot;
  const updatedAt = options.updatedAt ?? nowIso();
  const revision = Math.max(
    0,
    Number(options.revision ?? state?.revision ?? 0) || 0,
  );
  const partitioned = partitionTombstones(
    arrayOf<Tombstone>(state?.tombstones),
  );

  const moduleRevisions = options.moduleRevisions ?? {};
  const revisionFor = (moduleId: SyncModuleId): number =>
    Math.max(0, Number(moduleRevisions[moduleId] ?? revision) || 0);

  const modules: Record<SyncModuleId, ModuleEnvelope> = {
    extensions: buildEnvelope(
      "extensions",
      { extensions: arrayOf<ExtensionRecord>(snapshot.extensions) },
      partitioned.byModule.extensions,
      revisionFor("extensions"),
      updatedAt,
    ),
    bookmarks: buildEnvelope(
      "bookmarks",
      { bookmarks: arrayOf<BookmarkRecord>(snapshot.bookmarks) },
      partitioned.byModule.bookmarks,
      revisionFor("bookmarks"),
      updatedAt,
    ),
    tabs: buildEnvelope(
      "tabs",
      {
        windows: arrayOf<WindowRecord>(snapshot.windows),
        groups: arrayOf<TabGroupRecord>(snapshot.groups),
      },
      partitioned.byModule.tabs,
      revisionFor("tabs"),
      updatedAt,
    ),
  };

  const meta: SyncMetaPayload = {
    schemaVersion: SCHEMA_VERSION,
    formatVersion: STORAGE_FORMAT_VERSION,
    revision,
    updatedAt,
    conflicts: arrayOf<ConflictRecord>(
      options.conflicts ?? state?.conflicts ?? [],
    ),
    modules: SYNC_MODULE_IDS.map((moduleId) => ({
      module: moduleId,
      file: MODULE_FILES[moduleId],
      revision: modules[moduleId].revision,
      updatedAt: modules[moduleId].updatedAt,
      checksum: modules[moduleId].checksum,
      tombstones: modules[moduleId].tombstones.length,
    })),
  };
  const syncMeta = snapshot.syncMeta;
  if (isRecord(syncMeta)) meta.syncMeta = clone(syncMeta);
  if (partitioned.orphans.length) meta.orphanTombstones = partitioned.orphans;
  if (options.migration) meta.migration = options.migration;

  const files: Record<string, string> = {
    [MANIFEST_FILE]: MANIFEST_FILE,
    [META_FILE]: META_FILE,
  };
  for (const moduleId of SYNC_MODULE_IDS)
    files[moduleId] = MODULE_FILES[moduleId];

  const manifest: StorageManifest = {
    schemaVersion: SCHEMA_VERSION,
    formatVersion: STORAGE_FORMAT_VERSION,
    layout: MODULAR_STORAGE_LAYOUT,
    currentFile: null,
    revision,
    lastUpdatedAt: updatedAt,
    files,
    legacyArchive: options.legacyArchive ?? null,
  };

  return { manifest, meta, modules };
}

/**
 * Reassemble the module files into one coherent cloud state for the UI.
 *
 * IMPORTANT: the property order here must match `mergeModularCloudState`'s
 * `mergedSnapshot` exactly. `checksum()` sorts keys now, so this is defense in
 * depth, but keeping the two constructions identical also avoids surprising
 * diffs when a reader compares the two states by JSON text.
 */
export function combineModularState(modular: ModularCloudState): CloudState {
  const meta = modular.meta;
  const extensionsModule = modular.modules.extensions;
  const bookmarksModule = modular.modules.bookmarks;
  const tabsModule = modular.modules.tabs;

  const snapshot: Snapshot = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt: meta.updatedAt,
    extensions: arrayOf<ExtensionRecord>(
      (extensionsModule.data as ExtensionsModuleData).extensions,
    ),
    windows: arrayOf<WindowRecord>((tabsModule.data as TabsModuleData).windows),
    bookmarks: arrayOf<BookmarkRecord>(
      (bookmarksModule.data as BookmarksModuleData).bookmarks,
    ),
    groups: arrayOf<TabGroupRecord>((tabsModule.data as TabsModuleData).groups),
  };
  if (isRecord(meta.syncMeta)) snapshot.syncMeta = clone(meta.syncMeta);

  const tombstones: Tombstone[] = [
    ...arrayOf<Tombstone>(extensionsModule.tombstones),
    ...arrayOf<Tombstone>(bookmarksModule.tombstones),
    ...arrayOf<Tombstone>(tabsModule.tombstones),
    ...arrayOf<Tombstone>(meta.orphanTombstones),
  ];

  return {
    schemaVersion: SCHEMA_VERSION,
    revision: Number(meta.revision) || 0,
    updatedAt: meta.updatedAt,
    snapshot,
    tombstones,
    conflicts: arrayOf<ConflictRecord>(meta.conflicts),
  };
}

export function isStorageManifest(value: unknown): value is StorageManifest {
  if (!isRecord(value)) return false;
  return (
    value.layout === MODULAR_STORAGE_LAYOUT &&
    Number(value.formatVersion) >= 1 &&
    isRecord(value.files)
  );
}

export function isModuleEnvelope(
  value: unknown,
  moduleId?: SyncModuleId,
): value is ModuleEnvelope {
  if (!isRecord(value)) return false;
  if (Number(value.formatVersion) < 1) return false;
  if (!isRecord(value.data)) return false;
  if (moduleId !== undefined && value.module !== moduleId) return false;
  return SYNC_MODULE_IDS.includes(value.module as SyncModuleId);
}

export function isSyncMetaPayload(value: unknown): value is SyncMetaPayload {
  if (!isRecord(value)) return false;
  return Number(value.formatVersion) >= 1 && Array.isArray(value.modules);
}

export function isLegacyMonolithicPayload(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (isModuleEnvelope(value)) return false;
  if (isSyncMetaPayload(value)) return false;
  const snapshot = isRecord(value.snapshot) ? value.snapshot : value;
  return (
    Array.isArray(snapshot.extensions) ||
    Array.isArray(snapshot.windows) ||
    Array.isArray(snapshot.bookmarks) ||
    Array.isArray(snapshot.groups) ||
    isRecord(value.devices)
  );
}

export interface ModuleMergeResult {
  modules: Record<SyncModuleId, ModuleEnvelope>;
  meta: SyncMetaPayload;
  manifest: StorageManifest;
  conflicts: ConflictRecord[];
  changedModules: SyncModuleId[];
  revision: number;
  snapshot: Snapshot;
  state: CloudState;
}

export interface ModuleMergeInput {
  base: Snapshot;
  local: Snapshot;
  remote: CloudState;
  remoteModular?: ModularCloudState | null;
  options?: MergeOptions;
  revision: number;
  updatedAt?: string;
  migration?: LegacyMigrationRecord;
  legacyArchive?: string | null;
}

export function mergeModularCloudState(
  input: ModuleMergeInput,
): ModuleMergeResult {
  const { base, local, remote } = input;
  const options = input.options ?? {};
  const updatedAt = input.updatedAt ?? nowIso();
  const remoteSplit =
    input.remoteModular ?? splitCloudState(remote, { updatedAt });

  const baseSnapshot = isRecord(base) ? (base as Snapshot) : emptySnapshot();
  const localSnapshot = isRecord(local) ? (local as Snapshot) : emptySnapshot();
  const remoteSnapshot = isRecord(remote?.snapshot)
    ? (remote.snapshot as Snapshot)
    : emptySnapshot();

  const tabs = mergeTabsModule(
    baseSnapshot,
    localSnapshot,
    remoteSnapshot,
    options,
  );
  const extensions = mergeExtensionsModule(
    baseSnapshot,
    localSnapshot,
    remoteSnapshot,
  );
  const bookmarks = mergeBookmarksModule(
    baseSnapshot,
    localSnapshot,
    remoteSnapshot,
  );

  const conflicts: ConflictRecord[] = [
    ...tagModule("tabs", tabs.conflicts),
    ...tagModule("extensions", extensions.conflicts),
    ...tagModule("bookmarks", bookmarks.conflicts),
  ];

  const mergedSnapshot: Snapshot = {
    schemaVersion: SCHEMA_VERSION,
    updatedAt,
    extensions: extensions.extensions,
    windows: tabs.windows,
    bookmarks: bookmarks.bookmarks,
    groups: tabs.groups,
  };
  const syncMeta =
    localSnapshot.syncMeta ?? remoteSnapshot.syncMeta ?? baseSnapshot.syncMeta;
  if (isRecord(syncMeta)) mergedSnapshot.syncMeta = clone(syncMeta);

  const mergedState: CloudState = {
    schemaVersion: SCHEMA_VERSION,
    revision: Number(input.revision) || 0,
    updatedAt,
    snapshot: mergedSnapshot,
    tombstones: arrayOf<Tombstone>(remote?.tombstones),
    conflicts,
  };

  const next = splitCloudState(mergedState, {
    revision: Number(input.revision) || 0,
    updatedAt,
    conflicts,
    migration: input.migration,
    legacyArchive: input.legacyArchive ?? null,
  });

  const changedModules: SyncModuleId[] = [];
  const moduleRevisions: Record<SyncModuleId, number> = {
    extensions: 0,
    bookmarks: 0,
    tabs: 0,
  };
  for (const moduleId of SYNC_MODULE_IDS) {
    const previous = remoteSplit.modules[moduleId];
    const candidate = next.modules[moduleId];
    const changed =
      !previous ||
      previous.checksum !== candidate.checksum ||
      !stableEqual(previous.data, candidate.data) ||
      !stableEqual(previous.tombstones, candidate.tombstones);
    const previousRevision = Math.max(0, Number(previous?.revision ?? 0) || 0);
    moduleRevisions[moduleId] = changed
      ? previousRevision + 1
      : previousRevision;
    if (changed) changedModules.push(moduleId);
  }

  const finalModules = splitCloudState(mergedState, {
    revision: Number(input.revision) || 0,
    updatedAt,
    conflicts,
    moduleRevisions,
    migration: input.migration,
    legacyArchive: input.legacyArchive ?? null,
  });

  return {
    modules: finalModules.modules,
    meta: finalModules.meta,
    manifest: finalModules.manifest,
    conflicts,
    changedModules,
    revision: Number(input.revision) || 0,
    snapshot: mergedSnapshot,
    state: {
      ...mergedState,
      conflicts: finalModules.meta.conflicts,
    },
  };
}

function tagModule(
  moduleId: SyncModuleId,
  conflicts: ConflictRecord[],
): ConflictRecord[] {
  return conflicts.map((conflict) => ({
    ...clone(conflict),
    module: moduleId,
  }));
}

export function modularFileNames(): string[] {
  return [
    MANIFEST_FILE,
    META_FILE,
    ...SYNC_MODULE_IDS.map((id) => MODULE_FILES[id]),
  ];
}

export function serializeModularState(
  modular: ModularCloudState,
  changedModules?: SyncModuleId[] | null,
): Record<string, string> {
  const changed =
    changedModules && changedModules.length
      ? new Set<string>(changedModules.map((id) => MODULE_FILES[id]))
      : null;
  const files: Record<string, string> = {
    [MANIFEST_FILE]: JSON.stringify(modular.manifest, null, 2),
    [META_FILE]: JSON.stringify(modular.meta, null, 2),
  };
  for (const moduleId of SYNC_MODULE_IDS) {
    const name = MODULE_FILES[moduleId];
    if (changed && !changed.has(name)) continue;
    files[name] = JSON.stringify(modular.modules[moduleId], null, 2);
  }
  return files;
}

export interface ParseModularOptions {
  validateState: (raw: unknown) => CloudState;
}

export interface ParsedModularState {
  modular: ModularCloudState;
  state: CloudState;
  migratedFromLegacy: boolean;
  legacyPayload?: unknown;
}

export function parseModularFiles(
  files: Record<string, string | null | undefined>,
  options: ParseModularOptions,
): ParsedModularState {
  const readJson = (name: string): unknown => {
    const text = files[name];
    if (typeof text !== "string" || !text.trim()) return null;
    try {
      return JSON.parse(text);
    } catch {
      throw new ModularStorageError(`无法解析 ${name}`);
    }
  };

  const manifestRaw = readJson(MANIFEST_FILE);
  const metaRaw = readJson(META_FILE);
  const moduleRaw: Partial<Record<SyncModuleId, unknown>> = {};
  let presentModules = 0;
  for (const moduleId of SYNC_MODULE_IDS) {
    const parsed = readJson(MODULE_FILES[moduleId]);
    moduleRaw[moduleId] = parsed;
    if (isModuleEnvelope(parsed, moduleId)) presentModules += 1;
  }

  const hasModularLayout =
    isStorageManifest(manifestRaw) && isSyncMetaPayload(metaRaw);

  const legacyName = [LEGACY_MONOLITHIC_FILE, LEGACY_ALT_FILE].find((name) => {
    const text = files[name];
    return typeof text === "string" && text.trim().length > 0;
  });
  const legacyRaw = legacyName ? readJson(legacyName) : null;

  if (hasModularLayout && presentModules === SYNC_MODULE_IDS.length) {
    const modular = rebuildModularState(
      manifestRaw as StorageManifest,
      metaRaw as SyncMetaPayload,
      moduleRaw as Record<SyncModuleId, ModuleEnvelope>,
    );
    if (legacyRaw !== null) {
      const legacyState = options.validateState(legacyRaw);
      if (isNewer(legacyState, combineModularState(modular)))
        return {
          modular: migrateLegacyToModular(legacyState, {
            legacyFile: legacyName,
            preservedFile: legacyName ?? null,
            priorModular: modular,
          }),
          state: legacyState,
          migratedFromLegacy: true,
          legacyPayload: legacyRaw,
        };
    }
    return {
      modular,
      state: options.validateState(combineModularState(modular)),
      migratedFromLegacy: false,
    };
  }

  if (legacyRaw === null) {
    if (presentModules > 0 && isSyncMetaPayload(metaRaw))
      throw new ModularStorageError(
        `模块化同步数据不完整：缺少 ${SYNC_MODULE_IDS.filter(
          (id) => !isModuleEnvelope(moduleRaw[id], id),
        )
          .map((id) => MODULE_FILES[id])
          .join(", ")}`,
      );
    if (presentModules > 0 || hasModularLayout)
      throw new ModularStorageError(
        `模块化同步数据不完整：缺少 ${META_FILE} 或模块文件`,
      );
    throw new ModularStorageError("云端没有同步数据");
  }

  const legacyState = options.validateState(legacyRaw);
  const modular = migrateLegacyToModular(legacyState, {
    legacyFile: legacyName,
    preservedFile: legacyName ?? null,
  });
  return {
    modular,
    state: options.validateState(combineModularState(modular)),
    migratedFromLegacy: true,
    legacyPayload: legacyRaw,
  };
}

function isNewer(candidate: CloudState, other: CloudState): boolean {
  const a = Number(candidate?.revision) || 0;
  const b = Number(other?.revision) || 0;
  if (a !== b) return a > b;
  return String(candidate?.updatedAt ?? "") > String(other?.updatedAt ?? "");
}

export function bumpModuleRevisions(
  prior: ModularCloudState | null | undefined,
  changed: SyncModuleId[],
  globalRevision = 0,
): Partial<Record<SyncModuleId, number>> {
  const out: Partial<Record<SyncModuleId, number>> = {};
  const changedSet = new Set(changed || []);
  for (const moduleId of SYNC_MODULE_IDS) {
    if (!prior || !isRecord(prior.modules)) {
      out[moduleId] = Math.max(0, Number(globalRevision) || 0);
      continue;
    }
    const previous = Math.max(
      0,
      Number(prior.modules[moduleId]?.revision) || 0,
    );
    out[moduleId] = changedSet.has(moduleId) ? previous + 1 : previous;
  }
  return out;
}

export function diffModuleChanges(
  prior: ModularCloudState | null | undefined,
  next: ModularCloudState,
): SyncModuleId[] {
  if (!prior || !isRecord(prior.modules)) return SYNC_MODULE_IDS.slice();
  return SYNC_MODULE_IDS.filter((moduleId) => {
    const before = prior.modules[moduleId];
    const after = next.modules[moduleId];
    if (!before) return true;
    return (
      before.checksum !== after.checksum ||
      !stableEqual(before.data, after.data) ||
      !stableEqual(before.tombstones, after.tombstones)
    );
  });
}

function rebuildModularState(
  manifest: StorageManifest,
  meta: SyncMetaPayload,
  modules: Record<SyncModuleId, ModuleEnvelope>,
): ModularCloudState {
  const rebuilt: Record<SyncModuleId, ModuleEnvelope> = {
    extensions: modules.extensions,
    bookmarks: modules.bookmarks,
    tabs: modules.tabs,
  };
  for (const moduleId of SYNC_MODULE_IDS) {
    const envelope = rebuilt[moduleId];
    envelope.schemaVersion = SCHEMA_VERSION;
    envelope.formatVersion = STORAGE_FORMAT_VERSION;
    envelope.file = MODULE_FILES[moduleId];
    envelope.tombstones = arrayOf<Tombstone>(envelope.tombstones);
    envelope.checksum =
      typeof envelope.checksum === "string" && envelope.checksum
        ? envelope.checksum
        : dataChecksum(envelope.data, envelope.tombstones);
  }
  return {
    manifest: {
      ...manifest,
      schemaVersion: SCHEMA_VERSION,
      formatVersion: STORAGE_FORMAT_VERSION,
      layout: MODULAR_STORAGE_LAYOUT,
      currentFile: null,
    },
    meta: {
      ...meta,
      schemaVersion: SCHEMA_VERSION,
      formatVersion: STORAGE_FORMAT_VERSION,
      modules: SYNC_MODULE_IDS.map((moduleId) => ({
        module: moduleId,
        file: MODULE_FILES[moduleId],
        revision: Number(rebuilt[moduleId].revision) || 0,
        updatedAt: String(rebuilt[moduleId].updatedAt ?? ""),
        checksum: rebuilt[moduleId].checksum,
        tombstones: rebuilt[moduleId].tombstones.length,
      })),
    },
    modules: rebuilt,
  };
}

export function migrateLegacyToModular(
  legacyState: CloudState,
  context: {
    legacyFile?: string;
    preservedFile?: string | null;
    priorModular?: ModularCloudState | null;
  } = {},
): ModularCloudState {
  const legacyFile = context.legacyFile ?? LEGACY_MONOLITHIC_FILE;
  const legacyRevision = Number(legacyState?.revision) || 0;
  const migration: LegacyMigrationRecord = {
    from: legacyFile,
    migratedAt: nowIso(),
    legacyRevision,
    legacyChecksum: checksum(legacyState?.snapshot ?? {}),
    preservedFile: context.preservedFile ?? legacyFile,
  };
  const prior = context.priorModular;
  const moduleRevisions: Partial<Record<SyncModuleId, number>> = {};
  if (prior)
    for (const moduleId of SYNC_MODULE_IDS)
      moduleRevisions[moduleId] = Math.max(
        Number(prior.modules?.[moduleId]?.revision) || 0,
        legacyRevision,
      );
  return splitCloudState(legacyState, {
    revision: Math.max(legacyRevision, Number(prior?.meta?.revision) || 0),
    updatedAt:
      typeof legacyState?.updatedAt === "string" && legacyState.updatedAt
        ? legacyState.updatedAt
        : nowIso(),
    conflicts: arrayOf<ConflictRecord>(legacyState?.conflicts),
    moduleRevisions,
    migration,
    legacyArchive: migration.preservedFile,
  });
}
