import assert from 'node:assert/strict';
import { applyTombstones, checksum, deriveTombstones, mergeSnapshots, mergeTombstones, stableEqual } from '../src/runtime/sync-core.ts';
import type { Snapshot } from '../src/runtime/types.ts';

function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    schemaVersion: 10,
    extensions: [],
    windows: [],
    bookmarks: [],
    ...overrides,
  };
}

function withoutVolatileMetadata(value: Snapshot): Snapshot {
  const copy = structuredClone(value);
  delete copy.updatedAt;
  return copy;
}

const base = snapshot({
  extensions: [{ syncId: 'extension-a', id: 'a', name: 'A', version: '1.0.0', enabled: true }],
  bookmarks: [{ syncId: 'bookmark-a', title: 'A', url: 'https://example.com', parentSyncId: 'root-bookmarks', index: 0 }],
});

const local = snapshot({
  extensions: [{ syncId: 'extension-a', id: 'a', name: 'A', version: '1.0.0', enabled: false }],
  bookmarks: base.bookmarks,
});
const remote = base;
const merged = mergeSnapshots(base, local, remote);
assert.equal(merged.snapshot.extensions[0]?.enabled, false);
assert.equal(merged.conflicts.length, 0);
const repeatedMerge = mergeSnapshots(base, local, remote);
assert.equal(checksum(withoutVolatileMetadata(merged.snapshot)), checksum(withoutVolatileMetadata(repeatedMerge.snapshot)));

const deleted = snapshot({ bookmarks: base.bookmarks });
const tombstones = deriveTombstones(base, deleted, [], 2, '2026-09-10T00:00:00.000Z');
assert.deepEqual(tombstones.map((t) => `${t.collection}:${t.syncId}`), ['extensions:extension-a']);
assert.equal(applyTombstones(base, tombstones).extensions.length, 0);

const mergedTombstones = mergeTombstones(
  [{ collection: 'bookmarks', syncId: 'x', deletedAt: '2026-09-09T00:00:00.000Z', revision: 1 }],
  [{ collection: 'bookmarks', syncId: 'x', deletedAt: '2026-09-10T00:00:00.000Z', revision: 2 }],
);
assert.equal(mergedTombstones[0]?.revision, 2);

const conflictLocal = snapshot({ bookmarks: [{ ...base.bookmarks[0], url: 'https://local.example' }] });
const conflictRemote = snapshot({ bookmarks: [{ ...base.bookmarks[0], url: 'https://remote.example' }] });
const conflict = mergeSnapshots(base, conflictLocal, conflictRemote);
assert.equal(conflict.conflicts.some((c) => c.type === 'field-conflict' && c.collection === 'bookmarks' && c.field === 'url'), true);

assert.equal(stableEqual(conflictLocal, conflictLocal), true);
assert.equal(stableEqual(conflictLocal, conflictRemote), false);
console.log('sync invariants: OK');
