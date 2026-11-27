// @ts-nocheck
import assert from "node:assert/strict";

/* --------------------------------------------------------------------------
 * Regression test for the "configureGist" background handler.
 *
 * `readGistRaw` returns `{ gist, files, etag, updatedAt }` — an `etag` string,
 * not a `Headers` object. The handler used to read `r.headers.get("ETag")`, so
 * `r.headers` was `undefined` and binding an existing Gist in Settings failed
 * with "Cannot read properties of undefined (reading 'get')". This test drives
 * the real message handler end-to-end against a mocked GitHub API and asserts
 * that it stores the ETag and replies without an error.
 *
 * Importing the background service worker is heavy: it registers many
 * `chrome.*` listeners at module scope. The mock below provides exactly the
 * surface it touches at import time plus storage for the handler.
 * ------------------------------------------------------------------------ */

const storage = new Map<string, unknown>();
const fetchCalls: string[] = [];
let onMessage = null;

function makeResponse(body: string, headers: Record<string, string>, status = 200) {
  const lower: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) lower[key.toLowerCase()] = value;
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body),
    headers: { get: (key: string) => lower[key.toLowerCase()] ?? null },
  };
}

const noopEvent = { addListener: () => undefined };

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
};

(globalThis as unknown as Record<string, unknown>).fetch = async (url: string) => {
  fetchCalls.push(String(url));
  return makeResponse(
    JSON.stringify({
      id: "abc123",
      updated_at: "2026-02-02T00:00:00Z",
      files: {
        "manifest.json": {
          filename: "manifest.json",
          content: '{"schemaVersion":1}',
          truncated: false,
        },
      },
    }),
    { ETag: '"etag-bound"' },
  );
};

await import("../src/runtime/background.ts");
assert.ok(onMessage, "background registered an onMessage listener");

function send(type: string, extra: Record<string, unknown> = {}) {
  return new Promise((resolve) => {
    onMessage({ type, ...extra }, {}, resolve);
  });
}

// Bind an existing Gist: previously threw
// "Cannot read properties of undefined (reading 'get')".
{
  storage.clear();
  const response = await send("configureGist", {
    gistId: "abc123",
    token: "ghp_test_token",
  });

  assert.ok(!response || !response.error, `handler replied with an error: ${response?.error}`);
  assert.equal(response.gistId, "abc123");
  assert.equal(storage.get("gistId"), "abc123");
  assert.equal(storage.get("githubToken"), "ghp_test_token");
  assert.equal(storage.get("gistEtag"), '"etag-bound"', "stored the ETag from readGistRaw");
  assert.equal(fetchCalls.length, 1, "read the Gist once");
}

// Clearing the Gist id must clear the stored binding and ETag without a fetch.
{
  storage.clear();
  storage.set("gistId", "stale");
  storage.set("gistEtag", '"stale"');
  fetchCalls.length = 0;
  const response = await send("configureGist", { gistId: "", token: "ghp_test_token" });

  assert.ok(!response || !response.error);
  assert.equal(response.gistId, "");
  assert.equal(storage.has("gistId"), false);
  assert.equal(storage.has("gistEtag"), false);
  assert.equal(fetchCalls.length, 0);
}

console.log("background configureGist tests: OK");
