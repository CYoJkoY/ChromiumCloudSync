import assert from "node:assert/strict";

/*
 * The package-backup index domain is a page-context script, so it publishes
 * itself on `window`. Installing a minimal window before import lets the same
 * code the options page runs be tested directly.
 */
const win: Record<string, unknown> = {};
(globalThis as unknown as Record<string, unknown>).window = win;

await import("../src/features/package-index.ts");

const api = win.CCSyncPackageIndex as Record<string, any>;
assert.ok(api, "package index module must publish window.CCSyncPackageIndex");

const {
  PACKAGE_INDEX_SCHEMA,
  PACKAGE_METADATA_TYPE,
  buildPackageRecord,
  derivePackageSource,
  emptyIndex,
  findIndexEntry,
  indexKey,
  mergeIndexWithListing,
  normalizeIndex,
  packageFolder,
  packageFormat,
  packageMetadata,
  packagePath,
  resolveUniqueFileName,
  takenNamesInFolder,
  upsertIndexEntry,
} = api;

const ext = {
  id: "abcdefghijklmnopabcdefghijklmnop",
  name: "Example",
  version: "1.2.3",
  installType: "normal",
  updateUrl: "https://clients2.google.com/service/update2/crx",
};

/* --------------------------------------------------------------------------
 * Paths keep packages separate from browser-state synchronization files.
 * ------------------------------------------------------------------------ */
assert.equal(
  packageFolder(ext.id, ext.version),
  `extensions/${ext.id}/v1.2.3`,
);
assert.equal(
  packagePath(ext.id, ext.version, "example.crx"),
  `extensions/${ext.id}/v1.2.3/example.crx`,
);
assert.equal(packageFormat("a.zip"), "zip");
assert.equal(packageFormat("a.crx"), "crx");
assert.equal(packageFormat("a.CRX"), "crx");
// Hostile names are sanitized into one safe segment: separators are stripped, so
// a traversal attempt cannot escape the package folder.
{
  const hostile = packagePath(ext.id, ext.version, "../../etc/passwd");
  assert.equal(
    hostile.startsWith(`extensions/${ext.id}/v1.2.3/`),
    true,
    "stays inside the package folder",
  );
  assert.equal(hostile.split("/").length, 4, "no injected path separators");
  assert.equal(hostile.includes("..%2f") || hostile.includes("../"), false);
  assert.equal(
    packagePath(ext.id, "1.0/../../x", "a.crx"),
    `extensions/${ext.id}/v1.0-..-..-x/a.crx`,
  );
}
assert.equal(packageFolder(ext.id, ""), `extensions/${ext.id}/vunknown`);

/* --------------------------------------------------------------------------
 * A backup record carries every required metadata field.
 * ------------------------------------------------------------------------ */
{
  const record = buildPackageRecord({
    extension: ext,
    fileName: "example.crx",
    size: 2048,
    sha256: "ABC123",
    backend: "gdrive",
    storedAt: "2026-10-01T00:00:00.000Z",
  });
  assert.equal(record.extensionId, ext.id);
  assert.equal(record.name, "Example");
  assert.equal(record.version, "1.2.3");
  assert.equal(record.fileName, "example.crx");
  assert.equal(record.format, "crx");
  assert.equal(record.size, 2048);
  assert.equal(record.sha256, "abc123", "checksum normalized to lower case");
  assert.equal(record.storedAt, "2026-10-01T00:00:00.000Z");
  assert.equal(record.backend, "gdrive");
  assert.equal(record.source, "chrome-web-store");
  assert.equal(record.installType, "normal");
  assert.ok(record.updateUrl, "source information retained");
  assert.equal(
    record.path,
    `extensions/${ext.id}/v1.2.3/example.crx`,
    "path derived when not supplied",
  );

  const meta = packageMetadata(record);
  assert.equal(meta.type, PACKAGE_METADATA_TYPE);
  assert.equal(meta.package, record);
  assert.equal(meta.schemaVersion, 1);
}

/* --------------------------------------------------------------------------
 * Source information distinguishes store, self-hosted, and local installs.
 * ------------------------------------------------------------------------ */
{
  assert.equal(
    derivePackageSource({
      updateUrl: "https://clients2.google.com/service/update2/crx",
      installType: "normal",
    }).source,
    "chrome-web-store",
  );
  assert.equal(
    derivePackageSource({
      updateUrl: "https://chromewebstore.google.com/item/xyz",
    }).source,
    "chrome-web-store",
  );
  assert.equal(
    derivePackageSource({
      updateUrl: "https://microsoftedge.microsoft.com/extension/update2/crx",
    }).source,
    "edge-add-ons",
  );
  assert.equal(
    derivePackageSource({ updateUrl: "https://example.com/update.xml" }).source,
    "self-hosted",
  );
  assert.equal(derivePackageSource({ installType: "development" }).source, "unpacked");
  assert.equal(derivePackageSource({ installType: "side_loading" }).source, "side-loaded");
  assert.equal(derivePackageSource({ installType: "admin" }).source, "policy");
  assert.equal(derivePackageSource({}).source, "unknown");
}

/* --------------------------------------------------------------------------
 * Duplicate names and versions never silently overwrite an unrelated backup.
 * ------------------------------------------------------------------------ */
{
  const taken = new Set(["example.crx"]);
  const renamed = resolveUniqueFileName("example.crx", taken, "deadbeefcafe1234");
  assert.equal(renamed, "example-deadbeef.crx", "checksum prefix keeps both");
  assert.notEqual(renamed, "example.crx");

  // Free names are used as-is.
  assert.equal(resolveUniqueFileName("other.crx", taken, "aa"), "other.crx");

  // Stable across retries: the same bytes resolve to the same name.
  assert.equal(
    resolveUniqueFileName("example.crx", taken, "deadbeefcafe1234"),
    renamed,
  );

  // A collision on the checksum name too falls back to a numbered variant.
  assert.equal(
    resolveUniqueFileName(
      "example.crx",
      new Set(["example.crx", "example-deadbeef.crx"]),
      "deadbeefcafe1234",
    ),
    "example-deadbeef-2.crx",
  );
  assert.equal(
    resolveUniqueFileName(
      "example.crx",
      new Set(["example.crx", "example-deadbeef.crx", "example-deadbeef-2.crx"]),
      "deadbeefcafe1234",
    ),
    "example-deadbeef-3.crx",
  );

  // Without a checksum the name is still not reused.
  assert.equal(
    resolveUniqueFileName("example.crx", taken, ""),
    "example-duplicate.crx",
  );
  // Extensionless names keep working.
  assert.equal(resolveUniqueFileName("pack", new Set(["pack"]), "abcd1234"), "pack-abcd1234");
  // A plain array is accepted as well as a Set.
  assert.equal(resolveUniqueFileName("a.crx", ["a.crx"], "ffff0000"), "a-ffff0000.crx");
}

/* --------------------------------------------------------------------------
 * Index handling: normalization, upsert, lookup, folder occupancy.
 * ------------------------------------------------------------------------ */
{
  assert.deepEqual(emptyIndex(), { schemaVersion: PACKAGE_INDEX_SCHEMA, backups: [] });

  // A legacy or malformed index is repaired, not discarded.
  const repaired = normalizeIndex({
    schemaVersion: 1,
    backups: [
      { extensionId: "a", version: "1", fileName: "a.crx", sha256: "FF" },
      null,
      "garbage",
    ],
  });
  assert.equal(repaired.schemaVersion, PACKAGE_INDEX_SCHEMA);
  assert.equal(repaired.backups.length, 1);
  assert.equal(repaired.backups[0].sha256, "ff");
  assert.equal(repaired.backups[0].format, "crx");
  assert.deepEqual(normalizeIndex(null).backups, []);
  assert.deepEqual(normalizeIndex({}).backups, []);

  const first = buildPackageRecord({
    extension: ext,
    fileName: "example.crx",
    size: 10,
    sha256: "aa",
    backend: "gdrive",
  });
  let index = upsertIndexEntry(emptyIndex(), first);
  assert.equal(index.backups.length, 1);

  // Re-uploading identical bytes replaces the entry instead of growing the index.
  index = upsertIndexEntry(index, { ...first, size: 10 });
  assert.equal(index.backups.length, 1, "same checksum is an update");

  // Different bytes at the same name/version are kept side by side.
  const second = buildPackageRecord({
    extension: ext,
    fileName: "example-deadbeef.crx",
    size: 20,
    sha256: "bb",
    backend: "gdrive",
  });
  index = upsertIndexEntry(index, second);
  assert.equal(index.backups.length, 2, "different checksum is a new backup");
  assert.equal(index.schemaVersion, PACKAGE_INDEX_SCHEMA);
  assert.ok(index.updatedAt);

  assert.equal(findIndexEntry(index, first)?.sha256, "aa");
  assert.equal(findIndexEntry(index, { extensionId: ext.id, version: "1.2.3", sha256: "zz" }), null);
  assert.equal(indexKey(first), `${ext.id}:1.2.3:aa`);

  const taken = takenNamesInFolder(index, ext.id, "1.2.3");
  assert.equal(taken.has("example.crx"), true);
  assert.equal(taken.has("example-deadbeef.crx"), true);
  assert.equal(
    takenNamesInFolder(index, ext.id, "9.9.9").size,
    0,
    "another version folder is independent",
  );

  // The index is capped so it cannot grow without bound.
  let many = emptyIndex();
  for (let n = 0; n < 260; n += 1)
    many = upsertIndexEntry(
      many,
      buildPackageRecord({
        extension: { ...ext, version: `1.0.${n}` },
        fileName: `p${n}.crx`,
        size: n,
        sha256: `h${n}`,
        backend: "gdrive",
      }),
    );
  assert.equal(many.backups.length, api.MAX_INDEX_ENTRIES);
}

/* --------------------------------------------------------------------------
 * Listing reconciliation: provider files and index entries are both surfaced.
 * ------------------------------------------------------------------------ */
{
  const record = buildPackageRecord({
    extension: ext,
    fileName: "example.crx",
    size: 10,
    sha256: "aa",
    backend: "gdrive",
  });
  const index = upsertIndexEntry(emptyIndex(), record);

  const merged = mergeIndexWithListing(index, [
    {
      path: record.path,
      size: 10,
      modifiedTime: "2026-10-01T00:00:00.000Z",
    },
    {
      path: `extensions/${ext.id}/v1.2.3/orphan.crx`,
      size: 99,
      modifiedTime: "2026-10-02T00:00:00.000Z",
    },
    { path: "index.json", size: 5 },
    { path: "selection.json", size: 5 },
    { path: `extensions/${ext.id}/v1.2.3/metadata.json`, size: 5 },
  ]);

  assert.equal(merged.backups.length, 1);
  assert.equal(merged.backups[0].present, true);
  assert.equal(merged.backups[0].remoteSize, 10);
  assert.equal(merged.backups[0].remoteModified, "2026-10-01T00:00:00.000Z");

  assert.equal(merged.unindexed.length, 1, "provider-only package is reported");
  assert.equal(merged.unindexed[0].fileName, "orphan.crx");
  assert.equal(merged.unindexed[0].version, "1.2.3");
  assert.equal(merged.unindexed[0].extensionId, ext.id);
  assert.equal(merged.unindexed[0].size, 99);
  assert.equal(merged.unindexed[0].indexed, false);
  assert.deepEqual(merged.missing, []);

  assert.deepEqual(
    mergeIndexWithListing(index, []).missing,
    [record.path],
    "an index entry whose file is gone is reported missing, not restorable",
  );
  assert.equal(mergeIndexWithListing(index, []).backups[0].present, false);
  assert.deepEqual(mergeIndexWithListing(null, null).backups, []);
}

console.log("package-index tests: OK");
