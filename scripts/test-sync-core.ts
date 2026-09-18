import assert from "node:assert/strict";
import {
  mergeSnapshots,
  deriveTombstones,
  applyTombstones,
  cleanConflicts,
  reorderTabGroupBlocks,
} from "../src/runtime/sync-core.ts";

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 10,
    extensions: [],
    windows: [],
    bookmarks: [],
    ...overrides,
  };
}

const base = snapshot({
  extensions: [
    {
      syncId: "extension-a",
      id: "a",
      name: "A",
      version: "1.0.0",
      enabled: true,
    },
  ],
  bookmarks: [
    {
      syncId: "bookmark-a",
      title: "A",
      url: "https://example.com",
      parentSyncId: "root-bookmarks",
      index: 0,
    },
  ],
});

{
  const local = snapshot({
    extensions: [
      {
        syncId: "extension-a",
        id: "a",
        name: "A",
        version: "1.0.0",
        enabled: false,
      },
    ],
    bookmarks: base.bookmarks,
  });
  const remote = base;
  const { snapshot: merged, conflicts } = mergeSnapshots(base, local, remote);
  assert.equal(
    merged.extensions[0].enabled,
    false,
    "local-only extension change should survive",
  );
  assert.equal(
    conflicts.length,
    0,
    "local-only change should not create a conflict",
  );
}

{
  const local = snapshot({ extensions: [], bookmarks: base.bookmarks });
  const tombstones = deriveTombstones(
    base,
    local,
    [],
    2,
    "2026-09-07T00:00:00.000Z",
  );
  assert.deepEqual(
    tombstones.map((t) => `${t.collection}:${t.syncId}`),
    ["extensions:extension-a"],
  );
  const applied = applyTombstones(base, tombstones);
  assert.equal(
    applied.extensions.length,
    0,
    "tombstone must remove deleted extension",
  );
}

{
  const baseBookmark = base.bookmarks[0];
  const local = snapshot({
    bookmarks: [{ ...baseBookmark, url: "https://local.example" }],
  });
  const remote = snapshot({
    bookmarks: [{ ...baseBookmark, url: "https://remote.example" }],
  });
  const { snapshot: merged, conflicts } = mergeSnapshots(base, local, remote);
  assert.equal(
    merged.bookmarks[0].url,
    "https://local.example",
    "manual URL conflict keeps local value by policy",
  );
  assert.equal(
    conflicts.some(
      (c) =>
        c.type === "field-conflict" &&
        c.collection === "bookmarks" &&
        c.field === "url",
    ),
    true,
  );
  assert.equal(cleanConflicts(conflicts).length, conflicts.length);
}

{
  const baseBookmark = base.bookmarks[0];
  const local = snapshot({
    bookmarks: [{ ...baseBookmark, url: "https://same.example" }],
  });
  const remote = snapshot({
    bookmarks: [{ ...baseBookmark, url: "https://same.example" }],
  });
  const { conflicts } = mergeSnapshots(base, local, remote);
  assert.equal(conflicts.length, 0, "identical changes should merge cleanly");
}

console.log("sync-core tests: OK");


{
  const tabA = {
    syncId: "tab-a",
    url: "https://a.example",
    title: "A",
    pinned: false,
    active: false,
    index: 0,
  };
  const tabB = {
    syncId: "tab-b",
    url: "https://b.example",
    title: "B",
    pinned: false,
    active: false,
    index: 1,
  };
  const base = snapshot({
    windows: [
      {
        syncId: "window-a",
        state: "normal",
        focused: true,
        tabs: [tabA, tabB],
      },
    ],
  });
  const local = snapshot({
    windows: [
      {
        syncId: "window-a",
        state: "normal",
        focused: true,
        tabs: [tabA],
      },
    ],
  });
  const merged = mergeSnapshots(
    base,
    local,
    base,
    { tabSyncMode: "incremental" },
  );
  assert.equal(
    merged.snapshot.windows[0].tabs.length,
    2,
    "incremental mode must merge remote-only tabs",
  );
  assert.equal(
    merged.snapshot.windows[0].tabs.some(
      (tab) => tab.syncId === "tab-b",
    ),
    true,
    "remote-only tab must remain in the merged window",
  );
}

{
  const base = snapshot({
    windows: [
      {
        syncId: "window-a",
        state: "normal",
        focused: true,
        tabs: [
          {
            syncId: "tab-a",
            url: "https://a.example",
            title: "A",
            pinned: false,
            active: false,
            index: 0,
          },
        ],
      },
    ],
  });
  const local = snapshot({ windows: [] });
  const tombstones = deriveTombstones(
    base,
    local,
    [],
    2,
    "2026-09-18T00:00:00.000Z",
    true,
  );
  assert.equal(
    tombstones.some(
      (t) =>
        t.collection === "tabs" &&
        t.syncId === "tab-a",
    ),
    false,
  );
  assert.equal(
    tombstones.some(
      (t) =>
        t.collection === "windows" &&
        t.syncId === "window-a",
    ),
    false,
  );
}

{
  const base = snapshot({
    windows: [
      {
        syncId: "window-a",
        state: "normal",
        focused: true,
        tabs: [
          {
            syncId: "tab-a",
            url: "https://a.example",
            title: "A",
            pinned: false,
            active: false,
            index: 0,
          },
        ],
      },
    ],
  });
  const local = base;
  const prior = [
    {
      collection: "tabs",
      syncId: "tab-a",
      deletedAt: "2026-09-18T00:00:00.000Z",
      revision: 10,
    },
  ];
  const tombstones = deriveTombstones(
    base,
    local,
    prior,
    11,
    "2026-09-18T00:01:00.000Z",
    true,
  );
  assert.equal(
    tombstones.some(
      (t) =>
        t.collection === "tabs" &&
        t.syncId === "tab-a",
    ),
    true,
  );
}


{
  const a = {
    syncId: "tab-a",
    url: "https://a.example",
    title: "A",
    pinned: false,
    active: false,
    index: 0,
  };
  const b = {
    syncId: "tab-b",
    url: "https://b.example",
    title: "B",
    pinned: false,
    active: false,
    index: 1,
  };
  const base = snapshot({
    windows: [{
      syncId: "window-a",
      state: "normal",
      focused: true,
      tabs: [a, b],
    }],
  });
  const local = snapshot({
    windows: [{
      syncId: "window-a",
      state: "normal",
      focused: true,
      tabs: [b, a],
    }],
  });
  const remote = snapshot({
    windows: [{
      syncId: "window-a",
      state: "normal",
      focused: true,
      tabs: [a, b],
    }],
  });
  const merged = mergeSnapshots(
    base,
    local,
    remote,
    { tabSyncMode: "incremental" },
  );
  assert.deepEqual(
    merged.snapshot.windows[0].tabs.map((tab) => tab.syncId),
    ["tab-a", "tab-b"],
    "incremental mode must preserve remote tab order",
  );
}


{
  const window = {
    syncId: "window-a",
    state: "normal",
    focused: true,
    tabs: [
      {
        syncId: "tab-u",
        url: "https://u.example",
        title: "U",
        pinned: false,
        active: false,
        index: 0,
        group: null,
      },
      {
        syncId: "tab-a1",
        url: "https://a1.example",
        title: "A1",
        pinned: false,
        active: false,
        index: 1,
        group: { syncId: "group-a" },
      },
      {
        syncId: "tab-a2",
        url: "https://a2.example",
        title: "A2",
        pinned: false,
        active: false,
        index: 2,
        group: { syncId: "group-a" },
      },
      {
        syncId: "tab-v",
        url: "https://v.example",
        title: "V",
        pinned: false,
        active: false,
        index: 3,
        group: null,
      },
      {
        syncId: "tab-b1",
        url: "https://b1.example",
        title: "B1",
        pinned: false,
        active: false,
        index: 4,
        group: { syncId: "group-b" },
      },
      {
        syncId: "tab-b2",
        url: "https://b2.example",
        title: "B2",
        pinned: false,
        active: false,
        index: 5,
        group: { syncId: "group-b" },
      },
    ],
  };
  assert.equal(
    reorderTabGroupBlocks(window, ["group-b", "group-a"]),
    true,
    "moving a group must change its window block order",
  );
  assert.deepEqual(
    window.tabs.map((tab) => tab.syncId),
    ["tab-u", "tab-b1", "tab-b2", "tab-v", "tab-a1", "tab-a2"],
    "group reordering must persist the new block order in the window",
  );
  assert.deepEqual(
    window.tabs.map((tab) => tab.index),
    [0, 1, 2, 3, 4, 5],
    "group reordering must normalize window tab indexes",
  );
  assert.equal(
    reorderTabGroupBlocks(window, ["group-b", "group-a"]),
    false,
    "reapplying the same order must be a no-op",
  );
}