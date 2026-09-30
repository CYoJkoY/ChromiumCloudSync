import assert from "node:assert/strict";
import {
  LEGACY_MONOLITHIC_FILE,
  MANIFEST_FILE,
  META_FILE,
  MODULE_FILES,
  MODULAR_STORAGE_LAYOUT,
  STORAGE_FORMAT_VERSION,
  SYNC_MODULE_IDS,
  bumpModuleRevisions,
  combineModularState,
  diffModuleChanges,
  isLegacyMonolithicPayload,
  isModuleEnvelope,
  isStorageManifest,
  isSyncMetaPayload,
  mergeModularCloudState,
  migrateLegacyToModular,
  moduleForCollection,
  parseModularFiles,
  partitionTombstones,
  serializeModularState,
  splitCloudState,
} from "../src/runtime/sync-modules.ts";
import { SCHEMA_VERSION } from "../src/runtime/sync-core.ts";
import { parseAndValidateCloudState } from "../src/runtime/schema.ts";
import type { CloudState, Snapshot } from "../src/runtime/types.ts";

const validateState = (raw: unknown): CloudState =>
  parseAndValidateCloudState(raw);

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

function cloudState(overrides: Partial<CloudState> = {}): CloudState {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 5,
    updatedAt: "2026-09-20T00:00:00.000Z",
    snapshot: snapshot(),
    tombstones: [],
    conflicts: [],
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
const window = {
  syncId: "window-a",
  state: "normal",
  focused: true,
  tabs: [tab],
};

const full = cloudState({
  snapshot: snapshot({
    extensions: [extension],
    bookmarks: [bookmark],
    windows: [window],
    groups: [],
  }),
});

/* --------------------------------------------------------------------------
 * The three required module files exist and carry no control data.
 * ------------------------------------------------------------------------ */
assert.equal(MODULE_FILES.extensions, "extensions.json");
assert.equal(MODULE_FILES.bookmarks, "bookmarks.json");
assert.equal(MODULE_FILES.tabs, "tabs.json");
assert.deepEqual([...SYNC_MODULE_IDS], ["extensions", "bookmarks", "tabs"]);

{
  const modular = splitCloudState(full, { revision: 5 });
  assert.equal(modular.manifest.layout, MODULAR_STORAGE_LAYOUT);
  assert.equal(modular.manifest.formatVersion, STORAGE_FORMAT_VERSION);
  assert.equal(modular.manifest.currentFile, null, "no monolithic payload");
  assert.equal(modular.manifest.schemaVersion, SCHEMA_VERSION);
  assert.equal(modular.meta.schemaVersion, SCHEMA_VERSION);

  const extensions = modular.modules.extensions;
  assert.equal(isModuleEnvelope(extensions, "extensions"), true);
  assert.deepEqual(
    Object.keys(extensions.data).sort(),
    ["extensions"],
    "extensions.json carries only the extension inventory",
  );
  assert.deepEqual(
    Object.keys(modular.modules.bookmarks.data).sort(),
    ["bookmarks"],
  );
  assert.deepEqual(
    Object.keys(modular.modules.tabs.data).sort(),
    ["groups", "windows"],
  );
  // Control data stays out of the module payloads.
  for (const moduleId of SYNC_MODULE_IDS) {
    const envelope = modular.modules[moduleId] as unknown as Record<string, unknown>;
    assert.equal(envelope.conflicts, undefined, `${moduleId} holds no conflicts`);
    assert.equal(envelope.revision !== undefined, true);
    assert.equal(typeof envelope.checksum, "string");
  }
  assert.equal(
    isSyncMetaPayload(modular.meta),
    true,
    "meta.json is the control file",
  );
  assert.equal(isStorageManifest(modular.manifest), true);
}

/* --------------------------------------------------------------------------
 * Split -> combine round-trips losslessly and stays schema-valid.
 * ------------------------------------------------------------------------ */
{
  const modular = splitCloudState(full, { revision: 5 });
  const combined = combineModularState(modular);
  assert.deepEqual(combined.snapshot.extensions, full.snapshot.extensions);
  assert.deepEqual(combined.snapshot.bookmarks, full.snapshot.bookmarks);
  assert.deepEqual(combined.snapshot.windows, full.snapshot.windows);
  assert.equal(combined.revision, 5);
  validateState(combined);
}

/* --------------------------------------------------------------------------
 * Tombstones are partitioned to the module that owns the collection.
 * ------------------------------------------------------------------------ */
{
  assert.equal(moduleForCollection("extensions"), "extensions");
  assert.equal(moduleForCollection("bookmarks"), "bookmarks");
  assert.equal(moduleForCollection("windows"), "tabs");
  assert.equal(moduleForCollection("tabs"), "tabs");
  assert.equal(moduleForCollection("groups"), "tabs");
  assert.equal(moduleForCollection("unknown"), null);

  const partitioned = partitionTombstones([
    { collection: "extensions", syncId: "e1", deletedAt: "x", revision: 1 },
    { collection: "bookmarks", syncId: "b1", deletedAt: "x", revision: 1 },
    { collection: "tabs", syncId: "t1", deletedAt: "x", revision: 1 },
    { collection: "groups", syncId: "g1", deletedAt: "x", revision: 1 },
    { collection: "windows", syncId: "w1", deletedAt: "x", revision: 1 },
    { collection: "mystery", syncId: "m1", deletedAt: "x", revision: 1 },
  ]);
  assert.equal(partitioned.byModule.extensions.length, 1);
  assert.equal(partitioned.byModule.bookmarks.length, 1);
  assert.equal(partitioned.byModule.tabs.length, 3);
  assert.equal(partitioned.orphans.length, 1);

  const modular = splitCloudState(
    cloudState({
      snapshot: full.snapshot,
      tombstones: [
        { collection: "bookmarks", syncId: "b1", deletedAt: "x", revision: 1 },
        { collection: "tabs", syncId: "t1", deletedAt: "x", revision: 1 },
        { collection: "mystery", syncId: "m1", deletedAt: "x", revision: 1 },
      ],
    }),
    { revision: 5 },
  );
  assert.equal(modular.modules.bookmarks.tombstones.length, 1);
  assert.equal(modular.modules.tabs.tombstones.length, 1);
  assert.equal(modular.modules.extensions.tombstones.length, 0);
  assert.equal(modular.meta.orphanTombstones?.length, 1, "orphans not lost");
  assert.equal(combineModularState(modular).tombstones.length, 3);
}

/* --------------------------------------------------------------------------
 * Legacy detection and migration.
 * ------------------------------------------------------------------------ */
{
  assert.equal(isLegacyMonolithicPayload(full), true);
  assert.equal(
    isLegacyMonolithicPayload({ devices: { a: { revision: 1 } } }),
    true,
  );
  const modular = splitCloudState(full);
  assert.equal(isLegacyMonolithicPayload(modular.modules.tabs), false);
  assert.equal(isLegacyMonolithicPayload(modular.meta), false);
  assert.equal(isLegacyMonolithicPayload(modular.manifest), false);

  const migrated = migrateLegacyToModular(full, {
    legacyFile: LEGACY_MONOLITHIC_FILE,
    preservedFile: LEGACY_MONOLITHIC_FILE,
  });
  assert.equal(migrated.meta.migration?.from, LEGACY_MONOLITHIC_FILE);
  assert.equal(migrated.meta.migration?.legacyRevision, 5);
  assert.equal(migrated.manifest.legacyArchive, LEGACY_MONOLITHIC_FILE);
  assert.ok(migrated.meta.migration?.migratedAt);
  assert.ok(migrated.meta.migration?.legacyChecksum);
  const combined = combineModularState(migrated);
  assert.deepEqual(combined.snapshot.extensions, full.snapshot.extensions);
  assert.deepEqual(combined.snapshot.bookmarks, full.snapshot.bookmarks);
  assert.deepEqual(combined.snapshot.windows, full.snapshot.windows);
  assert.equal(combined.revision, 5, "existing synchronized data preserved");
}

/* --------------------------------------------------------------------------
 * parseModularFiles: modular layout, legacy layout, and mixed layout.
 * ------------------------------------------------------------------------ */
function filesOf(modular: ReturnType<typeof splitCloudState>) {
  const serialized = serializeModularState(modular);
  const files: Record<string, string> = {};
  for (const [name, text] of Object.entries(serialized)) files[name] = text;
  return files;
}

{
  const modular = splitCloudState(full, { revision: 5 });
  const parsed = parseModularFiles(filesOf(modular), { validateState });
  assert.equal(parsed.migratedFromLegacy, false);
  assert.deepEqual(parsed.state.snapshot.bookmarks, full.snapshot.bookmarks);
  assert.equal(parsed.modular.manifest.layout, MODULAR_STORAGE_LAYOUT);
}

{
  // Only the legacy monolithic payload exists.
  const files = {
    [LEGACY_MONOLITHIC_FILE]: JSON.stringify(full),
  };
  const parsed = parseModularFiles(files, { validateState });
  assert.equal(parsed.migratedFromLegacy, true);
  assert.equal(parsed.state.revision, 5);
  assert.deepEqual(parsed.state.snapshot.extensions, full.snapshot.extensions);
  assert.equal(parsed.modular.meta.migration?.from, LEGACY_MONOLITHIC_FILE);
}

{
  // Mixed layout: a pre-modular client wrote a newer current.json afterwards.
  const modular = splitCloudState(full, { revision: 5 });
  const newerLegacy = cloudState({
    revision: 9,
    updatedAt: "2026-09-21T00:00:00.000Z",
    snapshot: snapshot({ bookmarks: [{ ...bookmark, title: "Newer" }] }),
  });
  const files = {
    ...filesOf(modular),
    [LEGACY_MONOLITHIC_FILE]: JSON.stringify(newerLegacy),
  };
  const parsed = parseModularFiles(files, { validateState });
  assert.equal(parsed.migratedFromLegacy, true, "newer legacy payload wins");
  assert.equal(parsed.state.revision, 9);
  assert.equal(parsed.state.snapshot.bookmarks[0]?.title, "Newer");
  assert.equal(
    parsed.modular.meta.migration?.legacyRevision,
    9,
    "migration re-recorded against the newer payload",
  );
}

{
  // Mixed layout: the modular files are newer, so they win.
  const newer = cloudState({
    revision: 12,
    updatedAt: "2026-09-22T00:00:00.000Z",
    snapshot: snapshot({ bookmarks: [{ ...bookmark, title: "Modular" }] }),
  });
  const files = {
    ...filesOf(splitCloudState(newer, { revision: 12 })),
    [LEGACY_MONOLITHIC_FILE]: JSON.stringify(full),
  };
  const parsed = parseModularFiles(files, { validateState });
  assert.equal(parsed.migratedFromLegacy, false);
  assert.equal(parsed.state.snapshot.bookmarks[0]?.title, "Modular");
}

{
  // An incomplete modular layout is an explicit error, never silent data loss.
  const modular = splitCloudState(full, { revision: 5 });
  const files = filesOf(modular);
  delete files[MODULE_FILES.bookmarks];
  assert.throws(
    () => parseModularFiles(files, { validateState }),
    /模块化同步数据不完整/,
  );
  assert.throws(
    () => parseModularFiles({}, { validateState }),
    /云端没有同步数据/,
  );
}

/* --------------------------------------------------------------------------
 * Module-scoped change detection and independent versioning.
 * ------------------------------------------------------------------------ */
{
  const prior = splitCloudState(full, { revision: 5 });
  const bookmarkEdited = cloudState({
    revision: 6,
    snapshot: snapshot({
      extensions: full.snapshot.extensions,
      bookmarks: [{ ...bookmark, title: "Renamed" }],
      windows: full.snapshot.windows,
    }),
  });
  const next = splitCloudState(bookmarkEdited, { revision: 6 });
  const changed = diffModuleChanges(prior, next);
  assert.deepEqual(changed, ["bookmarks"], "only bookmarks.json changed");

  const revisions = bumpModuleRevisions(prior, changed, 6);
  assert.equal(revisions.bookmarks, 6);
  assert.equal(revisions.extensions, 5, "untouched module keeps its revision");
  assert.equal(revisions.tabs, 5, "untouched module keeps its revision");

  const serialized = serializeModularState(
    splitCloudState(bookmarkEdited, {
      revision: 6,
      moduleRevisions: revisions,
    }),
    changed,
  );
  assert.deepEqual(
    Object.keys(serialized).sort(),
    [MANIFEST_FILE, META_FILE, MODULE_FILES.bookmarks].sort(),
    "unchanged module files are not re-uploaded",
  );

  assert.deepEqual(diffModuleChanges(null, next), [...SYNC_MODULE_IDS]);
  assert.deepEqual(bumpModuleRevisions(null, [], 7), {
    extensions: 7,
    bookmarks: 7,
    tabs: 7,
  });
}

/* --------------------------------------------------------------------------
 * Module-scoped merge: a bookmark edit does not touch the tabs module.
 * ------------------------------------------------------------------------ */
{
  const remote = cloudState({
    revision: 5,
    snapshot: snapshot({
      extensions: [extension],
      bookmarks: [bookmark],
      windows: [window],
    }),
  });
  const remoteModular = splitCloudState(remote, { revision: 5 });
  const local = snapshot({
    extensions: [extension],
    bookmarks: [{ ...bookmark, title: "Local title" }],
    windows: [window],
  });
  const merged = mergeModularCloudState({
    base: remote.snapshot,
    local,
    remote,
    remoteModular,
    options: { tabSyncMode: "overwrite" },
    revision: 6,
  });
  assert.deepEqual(merged.changedModules, ["bookmarks"]);
  assert.equal(merged.revision, 6);
  assert.equal(merged.snapshot.bookmarks[0]?.title, "Local title");
  assert.deepEqual(merged.snapshot.windows, remote.snapshot.windows);
  validateState({ ...merged.state, snapshot: merged.snapshot });
}

{
  // Conflicting extension edits are tagged with their owning module.
  const remote = cloudState({
    revision: 5,
    snapshot: snapshot({
      extensions: [{ ...extension, enabled: true, version: "1.0.0" }],
      bookmarks: [bookmark],
      windows: [window],
    }),
  });
  const local = snapshot({
    extensions: [{ ...extension, enabled: false, version: "2.0.0" }],
    bookmarks: [bookmark],
    windows: [window],
  });
  const merged = mergeModularCloudState({
    base: snapshot({
      extensions: [{ ...extension, enabled: true, version: "0.9.0" }],
      bookmarks: [bookmark],
      windows: [window],
    }),
    local,
    remote,
    remoteModular: splitCloudState(remote, { revision: 5 }),
    revision: 6,
  });
  assert.ok(merged.changedModules.includes("extensions"));
  assert.equal(merged.snapshot.extensions[0]?.version, "2.0.0");
  for (const conflict of merged.conflicts)
    assert.ok(
      SYNC_MODULE_IDS.includes(conflict.module as never),
      `conflict is attributed to a module: ${conflict.type}`,
    );
}

{
  // Tabs-only change leaves the extensions and bookmarks modules untouched.
  const remote = cloudState({
    revision: 5,
    snapshot: snapshot({
      extensions: [extension],
      bookmarks: [bookmark],
      windows: [window],
    }),
  });
  const local = snapshot({
    extensions: [extension],
    bookmarks: [bookmark],
    windows: [
      {
        ...window,
        tabs: [
          tab,
          {
            syncId: "tab-b",
            url: "https://example.com/second",
            title: "Second",
            pinned: false,
            active: false,
            index: 1,
            group: null,
          },
        ],
      },
    ],
  });
  const merged = mergeModularCloudState({
    base: remote.snapshot,
    local,
    remote,
    remoteModular: splitCloudState(remote, { revision: 5 }),
    options: { tabSyncMode: "incremental" },
    revision: 6,
  });
  assert.deepEqual(merged.changedModules, ["tabs"]);
  assert.equal(merged.snapshot.windows[0]?.tabs.length, 2);
}

console.log("sync-modules tests: OK");
