import type { CloudState } from "./types.js";
import {
  HISTORY_INDEX_FILE,
  LEGACY_ALT_FILE,
  LEGACY_MONOLITHIC_FILE,
  MANIFEST_FILE,
  META_FILE,
  MODULE_FILES,
  SYNC_MODULE_IDS,
  combineModularState,
  modularFileNames,
  parseModularFiles,
  serializeModularState,
} from "./sync-modules.js";
import type {
  ModularCloudState,
  StorageManifest,
  SyncModuleId,
} from "./sync-modules.js";

/**
 * Provider-agnostic modular file transport.
 *
 * GitHub Gist, Google Drive, and WebDAV each expose a different object model,
 * but the modular synchronization protocol is identical: read a known set of
 * named JSON files, write only the ones that changed, and keep history separate
 * from the module payloads. Providers implement `FileStore`; this module owns
 * the protocol so no provider can drift into its own storage semantics.
 */

export type CloudProviderId = "gist" | "gdrive" | "webdav";

/**
 * Re-exported so callers have one source of truth for the legacy file names.
 * Both legacy monolithic payloads are preserved as migration archives.
 */
export { LEGACY_ALT_FILE };

export interface FileStoreReadResult {
  /** File name -> text content, or null when the file does not exist. */
  files: Record<string, string | null>;
  etag?: string;
  updatedAt?: string;
  /** Provider-specific payload (for example the raw Gist object). */
  raw?: unknown;
}

export interface HistoryEntry {
  id: string;
  createdAt: string;
  current: boolean;
  layout?: "modular" | "legacy";
  revision?: number;
  /**
   * Modules whose payload this revision changed.
   *
   * History is module-scoped as well as state-scoped: an entry always archives
   * the complete file set so it stays restorable, but it also records which
   * modules actually moved, so a bookmark-only revision is distinguishable from
   * one that rewrote tabs and extensions.
   */
  modules?: SyncModuleId[];
  /** Provider-native identifiers (Gist commit SHA, Drive revision id). */
  sha?: string;
  user?: string;
  changes?: unknown;
}

/** Revision context recorded alongside an archived history entry. */
export interface HistoryArchiveMeta {
  revision?: number;
  modules?: SyncModuleId[];
}

export interface FileStoreHistory {
  /**
   * Archive the previous contents of the files about to be overwritten under a
   * single label. Providers with native versioning may treat this as a no-op.
   */
  archive(
    label: string,
    entries: Array<{ name: string; text: string }>,
    meta?: HistoryArchiveMeta,
  ): Promise<void>;
  list(): Promise<HistoryEntry[]>;
  /** File name -> text for one archived history entry. */
  read(id: string): Promise<Record<string, string | null>>;
}

export interface FileStore {
  readonly id: CloudProviderId;
  read(names: string[]): Promise<FileStoreReadResult>;
  write(entries: Record<string, string>): Promise<void>;
  remove(names: string[]): Promise<void>;
  list(): Promise<string[]>;
  history?: FileStoreHistory;
}

export interface RemoteReadResult {
  state: CloudState;
  modular: ModularCloudState;
  manifest: StorageManifest;
  files: Record<string, string | null>;
  layout: "modular" | "legacy";
  migratedFromLegacy: boolean;
  legacyArchive: string | null;
  etag: string;
  updatedAt: string;
  raw: unknown;
  provider: CloudProviderId;
}

/** Every file the protocol may need, including legacy payloads. */
export function remoteFileNames(): string[] {
  return [
    ...modularFileNames(),
    LEGACY_MONOLITHIC_FILE,
    LEGACY_ALT_FILE,
    HISTORY_INDEX_FILE,
  ];
}

export interface ValidateStateFn {
  (raw: unknown): CloudState;
}

/**
 * Read the canonical remote state through the modular protocol.
 *
 * Legacy `current.json` payloads are detected and migrated in memory; the
 * migration is only persisted by the next write, so a read never mutates or
 * resets cloud data.
 */
export async function readRemoteModularState(
  store: FileStore,
  validateState: ValidateStateFn,
): Promise<RemoteReadResult> {
  const names = remoteFileNames();
  const result = await store.read(names);
  const files = result.files ?? {};
  const parsed = parseModularFiles(files, { validateState });

  const legacyPresent =
    typeof files[LEGACY_MONOLITHIC_FILE] === "string" ||
    typeof files[LEGACY_ALT_FILE] === "string";

  return {
    state: parsed.state,
    modular: parsed.modular,
    manifest: parsed.modular.manifest,
    files,
    layout: parsed.migratedFromLegacy ? "legacy" : "modular",
    migratedFromLegacy: parsed.migratedFromLegacy,
    legacyArchive:
      parsed.modular.manifest.legacyArchive ??
      (legacyPresent ? LEGACY_MONOLITHIC_FILE : null),
    etag: result.etag ?? "",
    updatedAt:
      result.updatedAt ?? parsed.modular.meta.updatedAt ?? "",
    raw: result.raw ?? null,
    provider: store.id,
  };
}

export interface WriteOptions {
  changedModules?: SyncModuleId[] | null;
  /** Files as read before the write, used for archiving and legacy handling. */
  priorFiles?: Record<string, string | null>;
  /** Explicit history label; defaults to the new revision. */
  historyLabel?: string;
  /** Extra deletions (legacy artifacts a provider must clean up). */
  remove?: string[];
}

export interface WriteResult {
  written: string[];
  skipped: SyncModuleId[];
  archived: string[];
  /** Modules this write actually changed, as recorded in the history entry. */
  changedModules: SyncModuleId[];
}

/**
 * Commit a modular state.
 *
 * Only module files whose payload changed are uploaded, which keeps per-module
 * history meaningful and avoids rewriting the complete dataset for a
 * single-module change. `manifest.json` and `meta.json` are always written
 * because they carry the revision and module index.
 */
export async function writeRemoteModularState(
  store: FileStore,
  modular: ModularCloudState,
  options: WriteOptions = {},
): Promise<WriteResult> {
  const changed =
    options.changedModules && options.changedModules.length
      ? options.changedModules.slice()
      : SYNC_MODULE_IDS.slice();
  const serialized = serializeModularState(modular, changed);
  const priorFiles = options.priorFiles ?? {};

  // A history entry is a complete point-in-time snapshot of the remote state
  // taken immediately before it is overwritten. Archiving only the changed
  // module files would make older entries unrestorable once another module
  // changes, so the whole protocol file set is archived together.
  const archiveEntries: Array<{ name: string; text: string }> = [];
  for (const name of modularFileNames()) {
    const previous = priorFiles[name];
    if (typeof previous === "string" && previous.trim())
      archiveEntries.push({ name, text: previous });
  }
  const label =
    options.historyLabel ??
    new Date().toISOString().replace(/[:.]/g, "-");
  // A history entry represents the state that is being replaced, so its revision
  // is read from the archived meta.json rather than from the incoming state.
  const archivedMeta = archiveEntries.find(
    (entry) => entry.name === META_FILE,
  )?.text;
  let archivedRevision = 0;
  if (archivedMeta) {
    try {
      archivedRevision =
        Number(
          (JSON.parse(archivedMeta) as { revision?: number }).revision,
        ) || 0;
    } catch {
      archivedRevision = 0;
    }
  }
  if (store.history && archiveEntries.length)
    await store.history.archive(label, archiveEntries, {
      revision: archivedRevision,
      // Modules the replacing revision changed: this is what makes history
      // module-scoped instead of only whole-state.
      modules: changed,
    });

  await store.write(serialized);

  const removals = new Set<string>(options.remove ?? []);
  // The legacy monolithic payload is preserved as a migration archive instead
  // of being deleted: cloud data must never be silently reset.
  removals.delete(LEGACY_MONOLITHIC_FILE);
  removals.delete(LEGACY_ALT_FILE);
  if (removals.size) await store.remove([...removals]);

  const writtenSet = new Set(Object.keys(serialized));
  return {
    written: [...writtenSet],
    skipped: SYNC_MODULE_IDS.filter(
      (moduleId) => !writtenSet.has(MODULE_FILES[moduleId]),
    ),
    archived: archiveEntries.map((entry) => entry.name),
    changedModules: changed,
  };
}

/** Read one history entry back into a validated cloud state. */
export async function readHistoryEntryState(
  store: FileStore,
  entryId: string,
  validateState: ValidateStateFn,
): Promise<CloudState> {
  if (!store.history)
    throw Error("当前云端提供商不支持历史记录");
  const files = await store.history.read(entryId);
  const parsed = parseModularFiles(files ?? {}, { validateState });
  return parsed.state;
}

export async function listRemoteHistory(
  store: FileStore,
): Promise<HistoryEntry[]> {
  if (!store.history) return [];
  return store.history.list();
}

/**
 * Migrate a legacy remote layout in place.
 *
 * Called after a legacy payload is detected so the provider stores the modular
 * files and records the migration. The legacy file itself is left untouched as
 * a read-only archive.
 */
export async function persistLegacyMigration(
  store: FileStore,
  modular: ModularCloudState,
): Promise<WriteResult> {
  return writeRemoteModularState(store, modular, {
    changedModules: SYNC_MODULE_IDS.slice(),
    historyLabel: `migrate-${modular.meta.revision || 0}`,
  });
}

export { MANIFEST_FILE, META_FILE, MODULE_FILES };
