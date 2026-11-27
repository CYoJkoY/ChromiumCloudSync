import assert from "node:assert/strict";

/* --------------------------------------------------------------------------
 * Test doubles: chrome.storage.local and fetch.
 *
 * The Gist transport is exercised against a mocked GitHub API so the two
 * behaviors that matter for reading a remote state are verified
 * deterministically: inline `content` is used directly, and files that GitHub
 * truncates (private Gists above ~1 MB) are fetched from `raw_url` *with the
 * token*, since that URL is authentication-gated.
 * ------------------------------------------------------------------------ */

interface MockResponse {
  ok: boolean;
  status: number;
  body: string;
  headers?: Record<string, string>;
}

interface MockFetchCall {
  url: string;
  init: RequestInit;
}

const storage = new Map<string, unknown>();
const fetchCalls: MockFetchCall[] = [];
let responder: (call: MockFetchCall) => MockResponse;

function makeResponse(result: MockResponse) {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(result.headers || {}))
    headers[key.toLowerCase()] = value;
  return {
    ok: result.ok,
    status: result.status,
    text: async () => result.body,
    json: async () => JSON.parse(result.body),
    headers: {
      get: (key: string) => headers[key.toLowerCase()] ?? null,
    },
  };
}

function reset() {
  storage.clear();
  fetchCalls.length = 0;
  responder = () => {
    throw Error("no responder installed");
  };
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
        for (const [key, value] of Object.entries(values))
          storage.set(key, value);
      },
      remove: async (keys: string[]) => {
        for (const key of keys) storage.delete(key);
      },
    },
  },
};

(globalThis as unknown as Record<string, unknown>).fetch = async (
  url: string,
  init: RequestInit = {},
) => {
  const call = { url: String(url), init };
  fetchCalls.push(call);
  return makeResponse(responder(call));
};

const { GITHUB_API, createGistFileStore, gistContainsSyncData } = await import(
  "../src/runtime/cloud-gist.ts"
);

const TOKEN = "ghp_test_token_123";
const GIST_ID = "abc123";
const GIST_URL = `${GITHUB_API}/gists/${GIST_ID}`;
const RAW_URL =
  "https://gist.githubusercontent.com/owner/abc123/raw/deadbeef/bookmarks.json";

function gistBody(
  files: Record<string, unknown>,
  updatedAt = "2026-01-01T00:00:00Z",
): string {
  return JSON.stringify({ id: GIST_ID, updated_at: updatedAt, files });
}

function authHeader(call: MockFetchCall): string | undefined {
  const headers = call.init.headers as Record<string, string> | undefined;
  return headers?.Authorization;
}

/* --------------------------------------------------------------------------
 * Inline content is read straight from the API response (no raw fetch), and
 * the API request carries the token.
 * ------------------------------------------------------------------------ */
{
  reset();
  storage.set("githubToken", TOKEN);
  responder = (call) => {
    assert.equal(call.url, GIST_URL);
    return {
      ok: true,
      status: 200,
      body: gistBody(
        {
          "bookmarks.json": {
            filename: "bookmarks.json",
            content: '{"bookmarks":[]}',
            truncated: false,
            raw_url: RAW_URL,
          },
        },
        "2026-02-02T00:00:00Z",
      ),
      headers: { ETag: '"etag-1"' },
    };
  };

  const store = createGistFileStore(GIST_ID);
  const result = await store.read(["bookmarks.json"]);
  assert.equal(result.files["bookmarks.json"], '{"bookmarks":[]}');
  assert.equal(result.etag, '"etag-1"');
  assert.equal(result.updatedAt, "2026-02-02T00:00:00Z");
  // Only the gist API call happened; inline content needed no raw fetch.
  assert.equal(fetchCalls.length, 1);
  assert.equal(authHeader(fetchCalls[0]), `Bearer ${TOKEN}`);
}

/* --------------------------------------------------------------------------
 * A truncated file (private Gist >~1 MB) is fetched from raw_url WITH the
 * token, so the bytes are recovered instead of being reported as missing.
 * ------------------------------------------------------------------------ */
{
  reset();
  storage.set("githubToken", TOKEN);
  const bigBody = "x".repeat(64);
  responder = (call) => {
    if (call.url === GIST_URL)
      return {
        ok: true,
        status: 200,
        body: gistBody({
          "bookmarks.json": {
            filename: "bookmarks.json",
            content: "",
            truncated: true,
            raw_url: RAW_URL,
          },
        }),
        headers: { ETag: '"etag-2"' },
      };
    if (call.url === RAW_URL)
      return { ok: true, status: 200, body: bigBody };
    throw Error(`unexpected fetch ${call.url}`);
  };

  const store = createGistFileStore(GIST_ID);
  const result = await store.read(["bookmarks.json"]);
  assert.equal(result.files["bookmarks.json"], bigBody);

  const rawCall = fetchCalls.find((call) => call.url === RAW_URL);
  assert.ok(rawCall, "raw_url was fetched");
  assert.equal(
    authHeader(rawCall!),
    `token ${TOKEN}`,
    "raw_url fetch carries the token so private Gists resolve",
  );
}

/* --------------------------------------------------------------------------
 * If the raw host rejects the authenticated request (e.g. a public Gist the
 * token cannot see), the anonymous fallback still recovers the bytes.
 * ------------------------------------------------------------------------ */
{
  reset();
  storage.set("githubToken", TOKEN);
  const body = '{"fallback":true}';
  responder = (call) => {
    if (call.url === GIST_URL)
      return {
        ok: true,
        status: 200,
        body: gistBody({
          "bookmarks.json": {
            filename: "bookmarks.json",
            content: "",
            truncated: true,
            raw_url: RAW_URL,
          },
        }),
        headers: {},
      };
    if (call.url === RAW_URL && authHeader(call))
      return { ok: false, status: 404, body: "Not Found" };
    if (call.url === RAW_URL) return { ok: true, status: 200, body };
    throw Error(`unexpected fetch ${call.url}`);
  };

  const store = createGistFileStore(GIST_ID);
  const result = await store.read(["bookmarks.json"]);
  assert.equal(result.files["bookmarks.json"], body);
  const rawCalls = fetchCalls.filter((call) => call.url === RAW_URL);
  assert.equal(
    rawCalls.length,
    3,
    "token scheme, bearer scheme, then anonymous attempts",
  );
  assert.equal(authHeader(rawCalls[0]), `token ${TOKEN}`);
  assert.equal(authHeader(rawCalls[1]), `Bearer ${TOKEN}`);
  assert.equal(authHeader(rawCalls[2]), undefined);
}

/* --------------------------------------------------------------------------
 * When the raw fetch fails, the read surfaces a diagnostic error naming the
 * file instead of silently returning null (which the modular parser would
 * report as incomplete cloud data).
 * ------------------------------------------------------------------------ */
{
  reset();
  storage.set("githubToken", TOKEN);
  responder = (call) => {
    if (call.url === GIST_URL)
      return {
        ok: true,
        status: 200,
        body: gistBody({
          "tabs.json": {
            filename: "tabs.json",
            content: "",
            truncated: true,
            raw_url: RAW_URL,
          },
        }),
        headers: {},
      };
    return { ok: false, status: 404, body: "Not Found" };
  };

  await assert.rejects(
    () => createGistFileStore(GIST_ID).read(["tabs.json"]),
    /tabs\.json.*404/,
  );
}

/* --------------------------------------------------------------------------
 * A truncated entry with no raw_url cannot be recovered; fail loudly rather
 * than returning partial/missing data.
 * ------------------------------------------------------------------------ */
{
  reset();
  storage.set("githubToken", TOKEN);
  responder = () => ({
    ok: true,
    status: 200,
    body: gistBody({
      "tabs.json": {
        filename: "tabs.json",
        content: "",
        truncated: true,
      },
    }),
    headers: {},
  });

  await assert.rejects(
    () => createGistFileStore(GIST_ID).read(["tabs.json"]),
    /tabs\.json.*raw 地址/,
  );
}

/* --------------------------------------------------------------------------
 * Missing files stay null; they are not confused with a failed raw fetch.
 * ------------------------------------------------------------------------ */
{
  reset();
  storage.set("githubToken", TOKEN);
  responder = () => ({
    ok: true,
    status: 200,
    body: gistBody({}),
    headers: {},
  });

  const store = createGistFileStore(GIST_ID);
  const result = await store.read(["tabs.json"]);
  assert.equal(result.files["tabs.json"], null);
}

/* --------------------------------------------------------------------------
 * Sync-data detection is based on the presence of known protocol files.
 * ------------------------------------------------------------------------ */
{
  assert.equal(gistContainsSyncData({ "manifest.json": null }), true);
  assert.equal(gistContainsSyncData({ "meta.json": null }), true);
  assert.equal(gistContainsSyncData({ "bookmarks.json": null }), true);
  assert.equal(gistContainsSyncData({ "random.txt": null }), false);
  assert.equal(gistContainsSyncData(undefined), false);
  assert.equal(gistContainsSyncData({}), false);
}

console.log("gist-transport tests: OK");
