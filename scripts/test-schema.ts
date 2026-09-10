import assert from 'node:assert/strict';
import { migrateCloudState, parseAndValidateCloudState, SchemaValidationError, SUPPORTED_SCHEMA_VERSIONS } from '../schema.ts';

const base = {
  schemaVersion: 10,
  revision: 4,
  updatedAt: '2026-09-10T00:00:00.000Z',
  snapshot: { schemaVersion: 10, extensions: [], windows: [], bookmarks: [] },
  tombstones: [],
  conflicts: [],
};

const parsed = parseAndValidateCloudState(base);
assert.equal(parsed.schemaVersion, 10);
assert.equal(parsed.revision, 4);

const legacy = migrateCloudState({
  schemaVersion: 10,
  revision: 2,
  updatedAt: '2026-09-09T00:00:00.000Z',
  extensions: [],
  windows: [],
  bookmarks: [{ syncId: 'root', title: 'Root', children: [{ syncId: 'child', title: 'Child', url: 'https://example.com' }] }],
});
assert.equal(legacy.snapshot.bookmarks.length, 2);
assert.equal(legacy.snapshot.bookmarks[1].parentSyncId, 'root');

for (const version of SUPPORTED_SCHEMA_VERSIONS) {
  const migrated = migrateCloudState({
    schemaVersion: version,
    revision: 1,
    updatedAt: '2026-09-09T00:00:00.000Z',
    extensions: [],
    windows: [],
    bookmarks: [],
  });
  assert.equal(migrated.schemaVersion, 10);
}

assert.throws(
  () => migrateCloudState({ schemaVersion: 99, revision: 1, snapshot: { extensions: [], windows: [], bookmarks: [] } }),
  (error: unknown) => error instanceof SchemaValidationError,
);

assert.throws(
  () => parseAndValidateCloudState({ schemaVersion: 10, revision: -1, updatedAt: 'x', snapshot: { extensions: [], windows: [], bookmarks: [] }, tombstones: [], conflicts: [] }),
  (error: unknown) => error instanceof SchemaValidationError,
);

console.log('schema tests: OK');
