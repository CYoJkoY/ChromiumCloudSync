import assert from "node:assert/strict";
import {
  CLOUD_TAB_STATE_CACHE_TTL_MS,
  CLOUD_TAB_STATE_VERSION,
  buildCanonicalCloudTabState,
  cacheAgeMs,
  isCacheUsable,
  isCanonicalCloudTabState,
} from "../src/runtime/cloud-tab-state.ts";
import { SCHEMA_VERSION } from "../src/runtime/sync-core.ts";
import { validateCloudState } from "../src/runtime/schema.ts";
import type { CloudState } from "../src/runtime/types.ts";

function state(overrides: Partial<CloudState> = {}): CloudState {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 3,
    updatedAt: "2026-09-20T00:00:00.000Z",
    snapshot: {
      schemaVersion: SCHEMA_VERSION,
      extensions: [],
      windows: [],
      bookmarks: [],
      groups: [],
    },
    tombstones: [],
    conflicts: [],
    ...overrides,
  };
}

/* --------------------------------------------------------------------------
 * The popup (group projection) and the management page (window projection)
 * must converge on one dataset.
 * ------------------------------------------------------------------------ */
{
  const canonical = buildCanonicalCloudTabState(
    state({
      snapshot: {
        schemaVersion: SCHEMA_VERSION,
        extensions: [],
        bookmarks: [],
        windows: [
          {
            syncId: "window-a",
            state: "normal",
            focused: true,
            tabs: [
              {
                syncId: "tab-1",
                url: "https://example.com/1",
                title: "One",
                pinned: false,
                active: true,
                index: 0,
                group: {
                  syncId: "group-inline",
                  title: "Inline",
                  color: "blue",
                  collapsed: false,
                },
              },
              {
                syncId: "tab-2",
                url: "https://example.com/2",
                title: "Two",
                pinned: false,
                active: false,
                index: 1,
                group: null,
              },
            ],
          },
        ],
        // A cloud-only group the window projection would never have shown.
        groups: [
          {
            syncId: "group-detached",
            title: "Detached",
            color: "red",
            collapsed: true,
            index: 0,
            tabs: [
              {
                syncId: "tab-3",
                url: "https://example.com/3",
                title: "Three",
                pinned: false,
                active: false,
                index: 0,
              },
            ],
          },
        ],
      },
    }),
    { provider: "gist", source: "remote" },
  );

  assert.equal(canonical.version, CLOUD_TAB_STATE_VERSION);
  assert.equal(canonical.counts.windows, 1);
  assert.equal(canonical.counts.groups, 2, "inline + detached groups");
  assert.equal(canonical.counts.tabs, 3);
  assert.equal(canonical.counts.groupedTabs, 2);
  assert.equal(canonical.counts.ungroupedTabs, 1);
  assert.equal(canonical.counts.detachedGroups, 1);

  const detached = canonical.detachedGroups[0];
  assert.equal(detached?.syncId, "group-detached");
  assert.equal(detached?.windowSyncId, null);
  assert.equal(detached?.tabs.length, 1);

  const windowGroup = canonical.windows[0]?.groups[0];
  assert.equal(windowGroup?.syncId, "group-inline");
  assert.equal(windowGroup?.windowSyncId, "window-a");
  assert.equal(windowGroup?.title, "Inline", "inline group metadata preserved");
  assert.equal(windowGroup?.color, "blue");

  // Both surfaces enumerate `canonical.groups`, so the sets are identical.
  assert.deepEqual(
    canonical.groups.map((group) => group.syncId).sort(),
    ["group-detached", "group-inline"],
  );
  assert.equal(
    canonical.groups.reduce((total, group) => total + group.tabs.length, 0),
    canonical.counts.groupedTabs,
  );
}

/* --------------------------------------------------------------------------
 * A tab reachable from both a window and a group is projected exactly once.
 * ------------------------------------------------------------------------ */
{
  const canonical = buildCanonicalCloudTabState(
    state({
      snapshot: {
        schemaVersion: SCHEMA_VERSION,
        extensions: [],
        bookmarks: [],
        windows: [
          {
            syncId: "window-a",
            state: "normal",
            focused: false,
            tabs: [
              {
                syncId: "tab-shared",
                url: "https://example.com/shared",
                title: "Shared",
                pinned: false,
                active: false,
                index: 0,
                group: {
                  syncId: "group-a",
                  title: "A",
                  color: "grey",
                  collapsed: false,
                },
              },
            ],
          },
        ],
        groups: [
          {
            syncId: "group-a",
            title: "A",
            color: "grey",
            collapsed: false,
            tabs: [
              {
                syncId: "tab-shared",
                url: "https://example.com/shared",
                title: "Shared",
                pinned: false,
                active: false,
                index: 0,
              },
            ],
          },
        ],
      },
    }),
    { provider: "webdav" },
  );

  assert.equal(canonical.counts.tabs, 1, "shared tab counted once");
  assert.equal(canonical.tabs[0]?.origin, "both");
  assert.equal(canonical.groups[0]?.tabs.length, 1);
  assert.equal(canonical.windows[0]?.tabs.length, 1);
}

/* --------------------------------------------------------------------------
 * Tombstones are applied: deleted entities never reach either UI.
 * ------------------------------------------------------------------------ */
{
  const canonical = buildCanonicalCloudTabState(
    state({
      snapshot: {
        schemaVersion: SCHEMA_VERSION,
        extensions: [],
        bookmarks: [],
        windows: [
          {
            syncId: "window-a",
            state: "normal",
            focused: false,
            tabs: [
              {
                syncId: "tab-keep",
                url: "https://example.com/keep",
                title: "Keep",
                pinned: false,
                active: false,
                index: 0,
                group: null,
              },
              {
                syncId: "tab-gone",
                url: "https://example.com/gone",
                title: "Gone",
                pinned: false,
                active: false,
                index: 1,
                group: null,
              },
            ],
          },
        ],
        groups: [
          {
            syncId: "group-gone",
            title: "Gone group",
            color: "grey",
            collapsed: false,
            tabs: [],
          },
        ],
      },
      tombstones: [
        {
          collection: "tabs",
          syncId: "tab-gone",
          deletedAt: "2026-09-20T01:00:00.000Z",
          revision: 4,
        },
        {
          collection: "groups",
          syncId: "group-gone",
          deletedAt: "2026-09-20T01:00:00.000Z",
          revision: 4,
        },
      ],
    }),
    { provider: "gdrive" },
  );

  assert.equal(canonical.counts.tabs, 1);
  assert.equal(canonical.tabs[0]?.syncId, "tab-keep");
  assert.equal(canonical.counts.groups, 0, "tombstoned group removed");
  assert.equal(canonical.windows[0]?.tabs.length, 1);
}

/* --------------------------------------------------------------------------
 * Unrestorable URLs are dropped and indexes stay contiguous.
 * ------------------------------------------------------------------------ */
{
  const canonical = buildCanonicalCloudTabState(
    state({
      snapshot: {
        schemaVersion: SCHEMA_VERSION,
        extensions: [],
        bookmarks: [],
        windows: [
          {
            syncId: "window-a",
            state: "normal",
            focused: false,
            tabs: [
              {
                syncId: "tab-chrome",
                url: "chrome://settings",
                title: "Settings",
                pinned: false,
                active: false,
                index: 0,
                group: null,
              },
              {
                syncId: "tab-js",
                url: "javascript:alert(1)",
                title: "Bad",
                pinned: false,
                active: false,
                index: 1,
                group: null,
              },
              {
                syncId: "tab-b",
                url: "https://example.com/b",
                title: "B",
                pinned: false,
                active: false,
                index: 5,
                group: null,
              },
              {
                syncId: "tab-a",
                url: "https://example.com/a",
                title: "A",
                pinned: true,
                active: true,
                index: 2,
                group: null,
              },
            ],
          },
        ],
        groups: [],
      },
    }),
    { provider: "gist" },
  );

  assert.deepEqual(
    canonical.windows[0]?.tabs.map((tab) => tab.syncId),
    ["tab-a", "tab-b"],
    "ordered by index with restricted URLs removed",
  );
  assert.deepEqual(
    canonical.windows[0]?.tabs.map((tab) => tab.index),
    [0, 1],
    "indexes renumbered contiguously",
  );
}

/* --------------------------------------------------------------------------
 * The reconciled snapshot stays schema-valid and is what restore consumes.
 * ------------------------------------------------------------------------ */
{
  const canonical = buildCanonicalCloudTabState(
    state({
      revision: 9,
      snapshot: {
        schemaVersion: SCHEMA_VERSION,
        extensions: [
          {
            syncId: "extension-a",
            id: "a".repeat(32),
            name: "A",
            version: "1.0.0",
            enabled: true,
          },
        ],
        bookmarks: [
          {
            syncId: "bookmark-a",
            parentSyncId: null,
            index: 0,
            title: "A",
            url: "https://example.com",
          },
        ],
        windows: [
          {
            syncId: "window-a",
            state: "maximized",
            focused: true,
            tabs: [
              {
                syncId: "tab-1",
                url: "https://example.com/1",
                title: "One",
                pinned: false,
                active: true,
                index: 0,
                group: {
                  syncId: "group-a",
                  title: "A",
                  color: "green",
                  collapsed: false,
                },
              },
            ],
          },
        ],
        groups: [
          {
            syncId: "group-a",
            title: "A",
            color: "green",
            collapsed: false,
            tabs: [],
          },
        ],
      },
    }),
    { provider: "gist", source: "remote" },
  );

  const validated = validateCloudState({
    schemaVersion: SCHEMA_VERSION,
    revision: canonical.revision,
    updatedAt: canonical.updatedAt,
    snapshot: canonical.snapshot,
    tombstones: [],
    conflicts: [],
  });
  assert.equal(validated.snapshot.windows.length, 1);
  assert.equal(validated.snapshot.windows[0]?.state, "maximized");
  assert.equal(
    validated.snapshot.windows[0]?.tabs[0]?.group?.syncId,
    "group-a",
    "group reference re-attached from canonical metadata",
  );
  assert.equal(validated.snapshot.extensions.length, 1, "extensions preserved");
  assert.equal(validated.snapshot.bookmarks.length, 1, "bookmarks preserved");
  assert.equal(canonical.revision, 9);
  assert.equal(canonical.provider, "gist");
  assert.equal(canonical.stale, false);
  assert.ok(isCanonicalCloudTabState(canonical));
}

/* --------------------------------------------------------------------------
 * Cache reuse rules: a stale or foreign-provider cache is never cloud state.
 * ------------------------------------------------------------------------ */
{
  const now = Date.parse("2026-09-20T12:00:00.000Z");
  const fresh = buildCanonicalCloudTabState(state(), {
    provider: "gist",
    fetchedAt: new Date(now - 1000).toISOString(),
  });
  const expired = buildCanonicalCloudTabState(state(), {
    provider: "gist",
    fetchedAt: new Date(
      now - CLOUD_TAB_STATE_CACHE_TTL_MS - 1000,
    ).toISOString(),
  });
  const otherProvider = buildCanonicalCloudTabState(state(), {
    provider: "webdav",
    fetchedAt: new Date(now - 1000).toISOString(),
  });

  assert.equal(isCacheUsable(fresh, "gist", now), true);
  assert.equal(isCacheUsable(expired, "gist", now), false);
  assert.equal(isCacheUsable(otherProvider, "gist", now), false);
  assert.equal(isCacheUsable(null, "gist", now), false);
  assert.equal(isCacheUsable({ version: 0 }, "gist", now), false);
  assert.equal(cacheAgeMs(fresh, now), 1000);
  assert.ok(Number.isFinite(cacheAgeMs(fresh, now)));
  assert.equal(fresh.source, "remote");
}

/* --------------------------------------------------------------------------
 * Empty / malformed input projects to an empty but well-formed dataset.
 * ------------------------------------------------------------------------ */
{
  const canonical = buildCanonicalCloudTabState(null, { provider: "gist" });
  assert.equal(canonical.counts.tabs, 0);
  assert.equal(canonical.counts.windows, 0);
  assert.deepEqual(canonical.windows, []);
  assert.deepEqual(canonical.groups, []);
  assert.equal(typeof canonical.checksum, "string");
  assert.ok(canonical.checksum.length > 0);
}

console.log("cloud-tab-state tests: OK");
