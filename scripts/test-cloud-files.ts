import assert from "node:assert/strict";
import {
  LEGACY_ALT_FILE,
  listRemoteHistory,
  persistLegacyMigration,
  readHistoryEntryState,
  readRemoteModularState,
  remoteFileNames,
  writeRemoteModularState,
} from "../src/runtime/cloud-files.ts";
import type {
  FileStore,
  FileStoreReadResult,
  HistoryEntry,
} from "../src/runtime/cloud-files.ts";
import {
  LEGACY_MONOLITHIC_FILE,
  MANIFEST_FILE,
  META_FILE,
  MODULE_FILES,
  SYNC_MODULE_IDS,
  splitCloudState,
} from "../src/runtime/sync-modules.ts";
import { LEGACY_ENCRYPTED_FILE } from "../src/runtime/cloud-gist.ts";
import { SCHEMA_VERSION } from "../src/runtime/sync-core.ts";
import { parseAndValidateCloudState } from "../src/runtime/schema.ts";
import type { CloudState, Snapshot } from "../src/runtime/types.ts";

const validateState = (raw: unknown): CloudState =>
  parseAndValidateCloudState(raw);

/**
 * In-memory FileStore that records every operation, so the protocol can be
 * verified without a network provider: which files were uploaded, which were
 * left alone, and what the history archive captured.
 */
interface RecordingStore {
  store: FileStore;
  files: Map<string, string>;
  writes: string[];
  removals: string[];
  archives: Array<{
    label: string;
    names: string[];
    revision: number;
    modules: string[];
  }>;
  history: Array<{
    id: string;
    createdAt: string;
    revision: number;
    modules: string[];
    files: Map<string, string>;
  }>;
}

function createRecordingStore(
  initial: Record<string, string> = {},
  options: { withHistory?: boolean } = {},
): RecordingStore {
  const files = new Map<string, string>(Object.entries(initial));
  const writes: string[] = [];
  const removals: string[] = [];
  const archives: RecordingStore["archives"] = [];
  const history: RecordingStore["history"] = [];
  const withHistory = options.withHistory !== false;

  const store: FileStore = {
    id: "webdav",
    async read(names: string[]): Promise<FileStoreReadResult> {
      const out: Record<string, string | null> = {};
      for (const name of names) out[name] = files.get(name) ?? null;
      return { files: out, updatedAt: "", raw: null };
    },
    async write(entries) {
      for (const [name, text] of Object.entries(entries)) {
        writes.push(name);
        files.set(name, text);
      }
    },
    async remove(names) {
      for (const name of names) {
        removals.push(name);
        files.delete(name);
      }
    },
    async list() {
      return [...files.keys()];
    },
  };

  if (withHistory)
    store.history = {
      async archive(label, entries, meta) {
        const modules = (meta?.modules || []).map((moduleId) => String(moduleId));
        archives.push({
          label,
          names: entries.map((entry) => entry.name),
          revision: Number(meta?.revision) || 0,
          modules,
        });
        const snapshotFiles = new Map<string, string>();
        for (const entry of entries) snapshotFiles.set(entry.name, entry.text);
        history.push({
          id: label,
          createdAt: new Date().toISOString(),
          revision: Number(meta?.revision) || 0,
          modules,
          files: snapshotFiles,
        });
      },
      async list(): Promise<HistoryEntry[]> {
        return history
          .slice()
          .reverse()
          .map((entry, index) => ({
            id: entry.id,
            createdAt: entry.createdAt,
            current: index === 0,
            layout: "modular" as const,
            revision: entry.revision,
            modules: entry.modules as never,
          }));
      },
      async read(id) {
        const entry = history.find((item) => item.id === id);
        if (!entry) throw Error(`missing history entry ${id}`);
        const out: Record<string, string | null> = {};
        for (const name of [
          MANIFEST_FILE,
          META_FILE,
          ...SYNC_MODULE_IDS.map((moduleId) => MODULE_FILES[moduleId]),
          LEGACY_MONOLITHIC_FILE,
        ])
          out[name] = entry.files.get(name) ?? null;
        return out;
      },
    };

  return { store, files, writes, removals, archives, history };
}

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    schemaVersion: SCHEMA_VERSION,
    extensions: [],
    windows: [],
    bookmarks: [],
    groups: [],
    ...overrides,
  };
}

const extension = {
  syncId: "extension-a",
  id: "a".repeat(32),
  name: "A",
  version: "1.0.0",
  enabled: true,
};
const bookmark = {
  syncId: "bookmark-a",
  parentSyncId: null,
  index: 0,
  title: "A",
  url: "https://example.com",
};
const tab = {
  syncId: "tab-a",
  url: "https://example.com/tab",
  title: "Tab",
  pinned: false,
  active: true,
  index: 0,
  group: null,
};
const window = { syncId: "window-a", state: "normal", focused: true, tabs: [tab] };

const v1 = {
  schemaVersion: SCHEMA_VERSION,
  revision: 1,
  updatedAt: "2026-09-20T00:00:00.000Z",
  snapshot: snapshot({
    extensions: [extension],
    bookmarks: [bookmark],
    windows: [window],
  }),
  tombstones: [],
  conflicts: [],
} satisfies CloudState;

const v2 = {
  ...v1,
  revision: 2,
  updatedAt: "2026-09-20T01:00:00.000Z",
  snapshot: snapshot({
    extensions: [extension],
    bookmarks: [{ ...bookmark, title: "Renamed" }],
    windows: [window],
  }),
} satisfies CloudState;

/* --------------------------------------------------------------------------
 * First commit uploads every module file; the read path returns them.
 * ------------------------------------------------------------------------ */
{
  const recording = createRecordingStore();
  const modular = splitCloudState(v1, { revision: 1 });
  await writeRemoteModularState(recording.store, modular, {
    changedModules: [...SYNC_MODULE_IDS],
    priorFiles: {},
  });
  for (const name of [
    MANIFEST_FILE,
    META_FILE,
    MODULE_FILES.extensions,
    MODULE_FILES.bookmarks,
    MODULE_FILES.tabs,
  ])
    assert.equal(recording.files.has(name), true, `${name} uploaded`);

  const loaded = await readRemoteModularState(recording.store, validateState);
  assert.equal(loaded.layout, "modular");
  assert.equal(loaded.migratedFromLegacy, false);
  assert.equal(loaded.state.revision, 1);
  assert.deepEqual(loaded.state.snapshot.bookmarks, v1.snapshot.bookmarks);
  assert.deepEqual(loaded.state.snapshot.windows, v1.snapshot.windows);
  assert.equal(loaded.manifest.currentFile, null);
  assert.deepEqual(remoteFileNames().includes(META_FILE), true);
}

/* --------------------------------------------------------------------------
 * A bookmarks-only change uploads only bookmarks.json (+ control files).
 * ------------------------------------------------------------------------ */
{
  const recording = createRecordingStore();
  await writeRemoteModularState(
    recording.store,
    splitCloudState(v1, { revision: 1 }),
    { changedModules: [...SYNC_MODULE_IDS], priorFiles: {} },
  );
  const prior = await readRemoteModularState(recording.store, validateState);

  recording.writes.length = 0;
  const next = splitCloudState(v2, {
    revision: 2,
    moduleRevisions: { extensions: 1, bookmarks: 2, tabs: 1 },
  });
  const result = await writeRemoteModularState(recording.store, next, {
    changedModules: ["bookmarks"],
    priorFiles: prior.files,
  });

  assert.deepEqual(result.written.sort(), [
    MANIFEST_FILE,
    META_FILE,
    MODULE_FILES.bookmarks,
  ].sort());
  assert.deepEqual(result.skipped, ["extensions", "tabs"]);
  assert.deepEqual(recording.writes.sort(), result.written.sort());
  assert.equal(
    recording.files.get(MODULE_FILES.extensions),
    prior.files[MODULE_FILES.extensions],
    "extensions.json bytes are untouched",
  );
  assert.equal(
    recording.files.get(MODULE_FILES.tabs),
    prior.files[MODULE_FILES.tabs],
    "tabs.json bytes are untouched",
  );

  const reloaded = await readRemoteModularState(recording.store, validateState);
  assert.equal(reloaded.state.revision, 2);
  assert.equal(reloaded.state.snapshot.bookmarks[0]?.title, "Renamed");
  assert.deepEqual(reloaded.state.snapshot.extensions, v1.snapshot.extensions);
  assert.equal(
    reloaded.modular.modules.extensions.revision,
    1,
    "module revision only advances for changed modules",
  );
  assert.equal(reloaded.modular.modules.bookmarks.revision, 2);
}

/* --------------------------------------------------------------------------
 * Legacy migration: detected, migrated, and the archive is preserved.
 * ------------------------------------------------------------------------ */
{
  const recording = createRecordingStore({
    [LEGACY_MONOLITHIC_FILE]: JSON.stringify(v1),
  });

  const loaded = await readRemoteModularState(recording.store, validateState);
  assert.equal(loaded.migratedFromLegacy, true);
  assert.equal(loaded.layout, "legacy");
  assert.equal(loaded.state.revision, 1);
  assert.deepEqual(loaded.state.snapshot.bookmarks, v1.snapshot.bookmarks);
  assert.equal(loaded.legacyArchive, LEGACY_MONOLITHIC_FILE);
  assert.equal(loaded.modular.meta.migration?.from, LEGACY_MONOLITHIC_FILE);
  assert.equal(
    recording.writes.length,
    0,
    "a read never mutates or resets cloud data",
  );

  // Persisting the migration must not delete the legacy archive.
  const result = await writeRemoteModularState(
    recording.store,
    loaded.modular,
    {
      changedModules: [...SYNC_MODULE_IDS],
      priorFiles: loaded.files,
      remove: [LEGACY_MONOLITHIC_FILE, LEGACY_ENCRYPTED_FILE, LEGACY_ALT_FILE],
    },
  );
  assert.equal(
    recording.files.has(LEGACY_MONOLITHIC_FILE),
    true,
    "current.json is preserved as the migration archive",
  );
  assert.deepEqual(result.written.sort(), [
    MANIFEST_FILE,
    META_FILE,
    MODULE_FILES.bookmarks,
    MODULE_FILES.extensions,
    MODULE_FILES.tabs,
  ].sort());

  const after = await readRemoteModularState(recording.store, validateState);
  assert.equal(after.layout, "modular");
  assert.equal(after.migratedFromLegacy, false, "migration recorded");
  assert.equal(after.legacyArchive, LEGACY_MONOLITHIC_FILE);
  assert.deepEqual(after.state.snapshot.bookmarks, v1.snapshot.bookmarks);
}

{
  // persistLegacyMigration writes the full modular set for a legacy remote.
  const recording = createRecordingStore({
    [LEGACY_MONOLITHIC_FILE]: JSON.stringify(v1),
  });
  const loaded = await readRemoteModularState(recording.store, validateState);
  const result = await persistLegacyMigration(recording.store, loaded.modular);
  assert.equal(result.written.length, 5);
  assert.equal(recording.files.has(LEGACY_MONOLITHIC_FILE), true);
  assert.deepEqual(recording.removals, []);
}

/* --------------------------------------------------------------------------
 * History entries are complete point-in-time snapshots and can be restored.
 * ------------------------------------------------------------------------ */
{
  const recording = createRecordingStore();
  await writeRemoteModularState(
    recording.store,
    splitCloudState(v1, { revision: 1 }),
    { changedModules: [...SYNC_MODULE_IDS], priorFiles: {} },
  );
  const prior = await readRemoteModularState(recording.store, validateState);

  await writeRemoteModularState(
    recording.store,
    splitCloudState(v2, { revision: 2 }),
    { changedModules: ["bookmarks"], priorFiles: prior.files, historyLabel: "rev-2" },
  );

  assert.equal(recording.archives.length, 1);
  assert.deepEqual(recording.archives[0]?.names.sort(), [
    MANIFEST_FILE,
    META_FILE,
    MODULE_FILES.bookmarks,
    MODULE_FILES.extensions,
    MODULE_FILES.tabs,
  ].sort(), "archive holds the complete previous file set");
  assert.deepEqual(
    recording.archives[0]?.modules,
    ["bookmarks"],
    "history entry records which modules the revision changed",
  );
  assert.equal(recording.archives[0]?.revision, 1, "archived revision context");

  const entries = await listRemoteHistory(recording.store);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.id, "rev-2");
  assert.equal(entries[0]?.current, true);
  assert.deepEqual(entries[0]?.modules, ["bookmarks"]);
  assert.equal(entries[0]?.revision, 1);

  const restored = await readHistoryEntryState(
    recording.store,
    "rev-2",
    validateState,
  );
  assert.equal(restored.revision, 1, "history entry is the pre-write state");
  assert.equal(restored.snapshot.bookmarks[0]?.title, "A");
}

/* --------------------------------------------------------------------------
 * Providers without history support degrade explicitly.
 * ------------------------------------------------------------------------ */
{
  const recording = createRecordingStore({}, { withHistory: false });
  await writeRemoteModularState(
    recording.store,
    splitCloudState(v1, { revision: 1 }),
    { changedModules: [...SYNC_MODULE_IDS], priorFiles: {} },
  );
  assert.deepEqual(await listRemoteHistory(recording.store), []);
  await assert.rejects(
    () => readHistoryEntryState(recording.store, "x", validateState),
    /不支持历史记录/,
  );
}

console.log("cloud-files tests: OK");
