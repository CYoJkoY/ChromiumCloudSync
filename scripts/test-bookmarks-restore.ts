// @ts-nocheck
import assert from "node:assert/strict";

/* --------------------------------------------------------------------------
 * Regression test for the "restoreBookmarks" handler.
 *
 * Chrome rejects any create/update/move against the invisible bookmark root
 * ("0") and the permanent root folders ("1" Bookmarks bar, "2" Other
 * bookmarks, "3" Mobile bookmarks) with
 *   "Can't modify the root bookmark folders."
 *
 * Restoring a cloud snapshot whose permanent-root syncIds differ from the
 * local profile used to try to recreate those folders under the root, which is
 * exactly the reported failure. This test drives the real message handler with
 * a Chrome-like bookmarks mock that throws on any root mutation, and asserts
 * that the restore converges onto the existing permanent folders instead.
 * ------------------------------------------------------------------------ */

const storage = new Map<string, unknown>();
const fetchCalls: string[] = [];
let onMessage = null;

const noopEvent = { addListener: () => undefined };

/* ----------------------------- bookmarks mock ----------------------------- */

const PROTECTED_BOOKMARK_IDS = new Set(["0", "1", "2", "3"]);

let nodes = new Map();
let order = new Map();
let orderSeq = 0;
let createCalls = [];
let updateCalls = [];
let moveCalls = [];

function resetBookmarks(roots) {
  nodes = new Map();
  order = new Map();
  orderSeq = 0;
  createCalls = [];
  updateCalls = [];
  moveCalls = [];
  nodes.set("0", { id: "0", parentId: undefined, title: "" });
  order.set("0", orderSeq++);
  for (const root of roots) {
    nodes.set(root.id, {
      id: root.id,
      parentId: "0",
      title: root.title || "",
    });
    order.set(root.id, orderSeq++);
  }
}

function sortedChildren(parentId) {
  return [...nodes.values()]
    .filter((node) => node.parentId === parentId)
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

function buildTree(id) {
  const node = nodes.get(id);
  const record = {
    id: node.id,
    title: node.title || "",
    ...(node.url ? { url: node.url } : {}),
  };
  if (node.parentId !== undefined) record.parentId = node.parentId;
  record.children = sortedChildren(id).map((child) => buildTree(child.id));
  return record;
}

function rootMutation() {
  throw new Error("Can't modify the root bookmark folders.");
}

(globalThis as unknown as Record<string, unknown>).chrome = {
  storage: {
    local: {
      get: async (keys: string[] | null) => {
        const out: Record<string, unknown> = {};
        for (const key of keys ?? [...storage.keys()])
          if (storage.has(key)) out[key] = storage.get(key);
        return out;
      },
      set: async (values: Record<string, unknown>) => {
        for (const [key, value] of Object.entries(values)) storage.set(key, value);
      },
      remove: async (keys: string[]) => {
        for (const key of keys) storage.delete(key);
      },
    },
  },
  alarms: { onAlarm: noopEvent },
  runtime: {
    onInstalled: noopEvent,
    onStartup: noopEvent,
    onMessage: {
      addListener: (listener) => {
        onMessage = listener;
      },
    },
    lastError: undefined,
  },
  tabs: {
    onCreated: noopEvent,
    onRemoved: noopEvent,
    onUpdated: noopEvent,
    onMoved: noopEvent,
  },
  bookmarks: {
    getTree: async () => [buildTree("0")],
    create: async (props) => {
      createCalls.push({ ...props });
      if (!props || props.parentId === "0" || !nodes.has(props.parentId))
        rootMutation();
      const id = String(100 + orderSeq);
      nodes.set(id, {
        id,
        parentId: props.parentId,
        title: props.title || "",
        ...(props.url ? { url: props.url } : {}),
      });
      order.set(id, orderSeq++);
      return { id, parentId: props.parentId, title: props.title || "" };
    },
    update: async (id, changes) => {
      updateCalls.push({ id, ...changes });
      if (PROTECTED_BOOKMARK_IDS.has(id)) rootMutation();
      const node = nodes.get(id);
      if (!node) throw new Error(`No bookmark with id ${id}`);
      if (changes.title !== undefined) node.title = changes.title;
      if (changes.url !== undefined) node.url = changes.url;
      return { ...node };
    },
    move: async (id, destination) => {
      moveCalls.push({ id, ...destination });
      if (PROTECTED_BOOKMARK_IDS.has(id)) rootMutation();
      const node = nodes.get(id);
      if (!node) throw new Error(`No bookmark with id ${id}`);
      node.parentId = destination.parentId;
      order.set(id, orderSeq++);
      return { ...node };
    },
  },
};

(globalThis as unknown as Record<string, unknown>).fetch = async (url: string) => {
  fetchCalls.push(String(url));
  throw new Error("network must not be used by restoreBookmarks");
};

await import("../src/runtime/background.ts");
assert.ok(onMessage, "background registered an onMessage listener");

function send(type, extra = {}) {
  return new Promise((resolve) => {
    onMessage({ type, ...extra }, {}, resolve);
  });
}

function localBookmarkNodes() {
  return [...nodes.values()];
}

/* -------------------------------------------------------------------------- */
/* Scenario 1: differing permanent-root syncIds must converge, not recreate.   */
/* -------------------------------------------------------------------------- */
{
  storage.clear();
  resetBookmarks([
    { id: "1", title: "Bookmarks bar" },
    { id: "2", title: "Other bookmarks" },
  ]);
  storage.set("bookmarkSyncIds", {
    "0": "root-bookmarks",
    "1": "bookmark-local-bar",
    "2": "bookmark-local-other",
  });

  const bookmarks = [
    { syncId: "root-bookmarks", parentSyncId: null, index: 0, title: "" },
    {
      syncId: "bookmark-cloud-bar",
      parentSyncId: "root-bookmarks",
      index: 0,
      title: "书签栏",
    },
    {
      syncId: "bookmark-cloud-other",
      parentSyncId: "root-bookmarks",
      index: 1,
      title: "其他书签",
    },
    {
      syncId: "bookmark-cloud-fav",
      parentSyncId: "bookmark-cloud-bar",
      index: 0,
      title: "Example",
      url: "https://example.com/",
    },
  ];

  const response = await send("restoreBookmarks", { bookmarks });

  assert.ok(!response || !response.error, `handler errored: ${response?.error}`);
  assert.equal(response.added, 1, "only the missing bookmark is created");
  assert.equal(response.updated, 0, "permanent roots are never renamed");
  assert.equal(response.moved, 0, "permanent roots are never moved");

  assert.equal(
    createCalls.some((call) => call.parentId === "0"),
    false,
    "never creates directly under the invisible root",
  );
  assert.equal(updateCalls.length, 0, "never updates a permanent root");
  assert.equal(moveCalls.length, 0, "never moves a permanent root");

  const map = storage.get("bookmarkSyncIds");
  assert.equal(map["1"], "bookmark-cloud-bar", "bar syncId bound to local root 1");
  assert.equal(map["2"], "bookmark-cloud-other", "other syncId bound to local root 2");

  const fav = localBookmarkNodes().find(
    (node) => node.url === "https://example.com/",
  );
  assert.ok(fav, "the child bookmark was restored");
  assert.equal(fav.parentId, "1", "child restored under the Bookmarks bar root");

  // Re-running the restore must be a no-op (idempotent convergence).
  createCalls = [];
  updateCalls = [];
  moveCalls = [];
  const second = await send("restoreBookmarks", { bookmarks });
  assert.ok(!second || !second.error, `second run errored: ${second?.error}`);
  assert.equal(second.added, 0, "second run adds nothing");
  assert.equal(second.updated, 0, "second run updates nothing");
  assert.equal(second.moved, 0, "second run moves nothing");
}

/* -------------------------------------------------------------------------- */
/* Scenario 2: a root-level node with no matching permanent folder falls back  */
/* to a safe parent instead of the invisible root.                            */
/* -------------------------------------------------------------------------- */
{
  storage.clear();
  resetBookmarks([
    { id: "1", title: "Bookmarks bar" },
    { id: "2", title: "Other bookmarks" },
  ]);
  storage.set("bookmarkSyncIds", {
    "0": "root-bookmarks",
    "1": "bookmark-local-bar",
    "2": "bookmark-local-other",
  });

  const bookmarks = [
    { syncId: "root-bookmarks", parentSyncId: null, index: 0, title: "" },
    {
      syncId: "bookmark-cloud-bar",
      parentSyncId: "root-bookmarks",
      index: 0,
      title: "Bookmarks bar",
    },
    {
      syncId: "bookmark-cloud-other",
      parentSyncId: "root-bookmarks",
      index: 1,
      title: "Other bookmarks",
    },
    {
      syncId: "bookmark-cloud-mobile",
      parentSyncId: "root-bookmarks",
      index: 2,
      title: "Mobile bookmarks",
    },
    {
      syncId: "bookmark-cloud-mobile-fav",
      parentSyncId: "bookmark-cloud-mobile",
      index: 0,
      title: "Mobile example",
      url: "https://m.example.com/",
    },
  ];

  const response = await send("restoreBookmarks", { bookmarks });
  assert.ok(!response || !response.error, `handler errored: ${response?.error}`);

  assert.equal(
    createCalls.some((call) => call.parentId === "0"),
    false,
    "no root-level creation under the invisible root",
  );

  const mobileFolder = localBookmarkNodes().find(
    (node) => node.title === "Mobile bookmarks",
  );
  assert.ok(mobileFolder, "the unmatched root-level folder was created");
  assert.equal(
    mobileFolder.parentId,
    "2",
    "unmatched root-level folder is parked under Other bookmarks",
  );

  const mobileFav = localBookmarkNodes().find(
    (node) => node.url === "https://m.example.com/",
  );
  assert.ok(mobileFav, "the nested bookmark was restored");
  assert.equal(mobileFav.parentId, mobileFolder.id);

  // The parked folder now carries a syncId, so a second restore resolves it
  // through `bySync`. It must stay parked rather than being moved back into
  // the invisible root, which Chrome rejects.
  createCalls = [];
  updateCalls = [];
  moveCalls = [];
  const second = await send("restoreBookmarks", { bookmarks });
  assert.ok(!second || !second.error, `second run errored: ${second?.error}`);
  assert.equal(second.added, 0, "second run adds nothing");
  assert.equal(second.updated, 0, "second run updates nothing");
  assert.equal(second.moved, 0, "second run moves nothing");
  assert.equal(
    moveCalls.some((call) => call.parentId === "0"),
    false,
    "never moves a parked root-level folder into the invisible root",
  );
  assert.equal(mobileFolder.parentId, "2", "parked folder stays put");
}

console.log("test-bookmarks-restore: ok");
