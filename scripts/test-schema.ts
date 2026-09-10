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

const fullyTyped = migrateCloudState({
  schemaVersion: 10,
  revision: 7,
  updatedAt: '2026-09-09T00:00:00.000Z',
  snapshot: {
    schemaVersion: 10,
    extensions: [{ syncId: 'extension-a', id: 'a'.repeat(32), name: 'A', version: '1.0.0', enabled: true }],
    windows: [{
      syncId: 'window-a', state: 'normal', focused: true,
      tabs: [{ syncId: 'tab-a', url: 'https://example.com', title: 'Example', pinned: false, active: true, index: 0 }],
    }],
    bookmarks: [{ syncId: 'bookmark-a', parentSyncId: null, index: 0, title: 'Example', url: 'https://example.com' }],
  },
  tombstones: [{ collection: 'bookmarks', syncId: 'bookmark-old', deletedAt: '2026-09-09T00:00:00.000Z', revision: 6 }],
  conflicts: [{ type: 'field', status: 'resolved', collection: 'bookmarks', syncId: 'bookmark-a', field: 'title', winner: 'local', strategy: 'latest' }],
});
assert.equal(fullyTyped.snapshot.extensions[0].syncId, 'extension-a');
assert.equal(fullyTyped.snapshot.windows[0].tabs[0].url, 'https://example.com');

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

assert.throws(
  () => parseAndValidateCloudState({ ...base, snapshot: { ...base.snapshot, extensions: [{ syncId: 'bad' }] } }),
  (error: unknown) => error instanceof SchemaValidationError,
);

assert.throws(
  () => parseAndValidateCloudState({ ...base, snapshot: { ...base.snapshot, windows: [{ syncId: 'window-a', state: 'normal', focused: true, tabs: [{ syncId: 'tab-a', url: 'javascript:alert(1)', title: 'Bad', pinned: false, active: true }] }] } }),
  (error: unknown) => error instanceof SchemaValidationError,
);

assert.throws(
  () => parseAndValidateCloudState({ ...base, snapshot: { ...base.snapshot, bookmarks: [
    { syncId: 'bookmark-a', parentSyncId: null, index: 0, title: 'A' },
    { syncId: 'bookmark-a', parentSyncId: null, index: 1, title: 'Duplicate' },
  ] } }),
  (error: unknown) => error instanceof SchemaValidationError,
);

console.log('schema tests: OK');
