import assert from 'node:assert/strict';
import { mergeSnapshots, deriveTombstones, applyTombstones, cleanConflicts } from '../sync-core.js';

function snapshot(overrides = {}) {
  return {
    schemaVersion: 10,
    extensions: [],
    windows: [],
    bookmarks: [],
    ...overrides,
  };
}

const base = snapshot({
  extensions: [{ syncId: 'extension-a', id: 'a', name: 'A', version: '1.0.0', enabled: true }],
  bookmarks: [{ syncId: 'bookmark-a', title: 'A', url: 'https://example.com', parentSyncId: 'root-bookmarks', index: 0 }],
});

{
  const local = snapshot({
    extensions: [{ syncId: 'extension-a', id: 'a', name: 'A', version: '1.0.0', enabled: false }],
    bookmarks: base.bookmarks,
  });
  const remote = base;
  const { snapshot: merged, conflicts } = mergeSnapshots(base, local, remote);
  assert.equal(merged.extensions[0].enabled, false, 'local-only extension change should survive');
  assert.equal(conflicts.length, 0, 'local-only change should not create a conflict');
}

{
  const local = snapshot({ extensions: [], bookmarks: base.bookmarks });
  const tombstones = deriveTombstones(base, local, [], 2, '2026-09-07T00:00:00.000Z');
  assert.deepEqual(tombstones.map(t => `${t.collection}:${t.syncId}`), ['extensions:extension-a']);
  const applied = applyTombstones(base, tombstones);
  assert.equal(applied.extensions.length, 0, 'tombstone must remove deleted extension');
}

{
  const baseBookmark = base.bookmarks[0];
  const local = snapshot({ bookmarks: [{ ...baseBookmark, title: 'Local' }] });
  const remote = snapshot({ bookmarks: [{ ...baseBookmark, title: 'Remote' }] });
  const { snapshot: merged, conflicts } = mergeSnapshots(base, local, remote);
  assert.equal(merged.bookmarks[0].title, 'Local', 'manual conflict keeps local value by policy');
  assert.equal(conflicts.some(c => c.type === 'field-conflict' && c.collection === 'bookmarks'), true);
  assert.equal(cleanConflicts(conflicts).length, conflicts.length);
}

{
  const baseBookmark = base.bookmarks[0];
  const local = snapshot({ bookmarks: [{ ...baseBookmark, title: 'Local' }] });
  const remote = snapshot({ bookmarks: [{ ...baseBookmark, title: 'Local' }] });
  const { conflicts } = mergeSnapshots(base, local, remote);
  assert.equal(conflicts.length, 0, 'identical changes should merge cleanly');
}

console.log('sync-core tests: OK');
