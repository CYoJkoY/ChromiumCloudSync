import assert from "node:assert/strict";

/*
 * The Drive package transport is a page-context script with injected
 * dependencies, so it can be driven against an in-memory Drive: no DOM, no
 * browser, and no network.
 */
const win: Record<string, unknown> = {};
(globalThis as unknown as Record<string, unknown>).window = win;

await import("../src/features/gdrive-packages.ts");

const api = win.CCSyncGdrivePackages as Record<string, any>;
assert.ok(api, "transport must publish window.CCSyncGdrivePackages");
assert.equal(api.GDRIVE_PACKAGES_ROOT, "Chromium Cloud Sync Packages");

/* --------------------------------------------------------------------------
 * In-memory Google Drive.
 * ------------------------------------------------------------------------ */

interface DriveNode {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  size: number;
  modifiedTime: string;
  bytes?: Uint8Array;
  trashed: boolean;
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

function createDrive() {
  const nodes = new Map<string, DriveNode>();
  let seq = 0;
  const requests: Array<{ url: string; method: string }> = [];
  /** Force the next response for a URL substring. */
  let failure: { match: string; status: number; body: unknown } | null = null;
  let uploadSessions = new Map<string, { id: string; existing: boolean }>();

  const add = (node: Omit<DriveNode, "id" | "modifiedTime" | "trashed">) => {
    const id = `id-${++seq}`;
    const stored: DriveNode = {
      ...node,
      id,
      modifiedTime: new Date().toISOString(),
      trashed: false,
    };
    nodes.set(id, stored);
    return stored;
  };

  const matches = (query: string) => {
    const name = /name='([^']*)'/.exec(query)?.[1];
    const mime = /mimeType='([^']*)'/.exec(query)?.[1];
    const parent = /'([^']*)' in parents/.exec(query)?.[1];
    const rooted = /'root' in parents/.test(query);
    return [...nodes.values()].filter((node) => {
      if (node.trashed) return false;
      if (name !== undefined && node.name !== name) return false;
      if (mime !== undefined && node.mimeType !== mime) return false;
      if (rooted && node.parents.length) return false;
      if (parent !== undefined && !node.parents.includes(parent)) return false;
      return true;
    });
  };

  const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (key: string) => headers[key.toLowerCase()] ?? null },
    text: async () => (body === null ? "" : JSON.stringify(body)),
    json: async () => body,
    arrayBuffer: async () => {
      const bytes =
        body instanceof Uint8Array
          ? body
          : new TextEncoder().encode(JSON.stringify(body ?? ""));
      return bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      );
    },
  });

  const handle = async (url: string, init: RequestInit = {}) => {
    const method = String(init.method || "GET");
    requests.push({ url, method });
    if (failure && url.includes(failure.match)) {
      const current = failure;
      failure = null;
      return json(current.body, current.status);
    }
    if (!/googleapis\.com/.test(url)) throw Error(`unexpected host ${url}`);

    // Query files.
    if (url.includes("/drive/v3/files?q=")) {
      const query = decodeURIComponent(
        new URL(url).searchParams.get("q") || "",
      );
      const fields = new URL(url).searchParams.get("fields") || "";
      const files = matches(query).map((node) => ({
        id: node.id,
        name: node.name,
        mimeType: node.mimeType,
        ...(fields.includes("size") ? { size: node.size } : {}),
        ...(fields.includes("modifiedTime")
          ? { modifiedTime: node.modifiedTime }
          : {}),
      }));
      return json({ files });
    }

    // Create a folder via multipart metadata.
    if (url.endsWith("/drive/v3/files?fields=id") && method === "POST") {
      const body = new TextDecoder().decode(init.body as Uint8Array);
      const metadata = JSON.parse(body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1));
      const node = add({
        name: String(metadata.name),
        mimeType: String(metadata.mimeType || FOLDER_MIME),
        parents: Array.isArray(metadata.parents) ? metadata.parents : [],
        size: 0,
      });
      return json({ id: node.id });
    }

    // Start a resumable upload session.
    if (url.includes("uploadType=resumable")) {
      const existing = /\/files\/([^?]+)\?/.exec(url)?.[1];
      const body = JSON.parse(String(init.body || "{}"));
      const location = `https://www.googleapis.com/upload/session/${existing || "new"}?upload_id=${++seq}`;
      uploadSessions.set(location, {
        id: existing || "",
        existing: !!existing,
      });
      // Record the intended name/parents for a create.
      (uploadSessions.get(location) as Record<string, unknown>).metadata = body;
      return json(null, 200, { location });
    }

    // Complete a resumable upload.
    if (url.includes("/upload/session/")) {
      const sessionEntry = uploadSessions.get(url);
      assert.ok(sessionEntry, "upload session must exist");
      const metadata = (sessionEntry as Record<string, any>).metadata || {};
      const bytes = new Uint8Array(init.body as ArrayBuffer);
      if (sessionEntry.existing && sessionEntry.id) {
        const node = nodes.get(sessionEntry.id);
        assert.ok(node, "existing upload target must exist");
        node.bytes = bytes;
        node.size = bytes.length;
        node.modifiedTime = new Date().toISOString();
        return json({ id: node.id, size: String(node.size) });
      }
      const node = add({
        name: String(metadata.name || "file"),
        mimeType: String(metadata.mimeType || "application/octet-stream"),
        parents: Array.isArray(metadata.parents) ? metadata.parents : [],
        size: bytes.length,
        bytes,
      });
      return json({ id: node.id, size: String(node.size) });
    }

    // Download file content.
    const media = /\/drive\/v3\/files\/([^?]+)\?alt=media/.exec(url);
    if (media) {
      const node = nodes.get(media[1]);
      if (!node || node.trashed) return json({ error: { message: "notFound" } }, 404);
      return json(node.bytes ?? new Uint8Array(), 200);
    }

    throw Error(`unhandled Drive request ${method} ${url}`);
  };

  return {
    nodes,
    requests,
    handle,
    add,
    byName: (name: string) => [...nodes.values()].filter((n) => n.name === name),
    failNext: (match: string, status: number, body: unknown) => {
      failure = { match, status, body };
    },
    trash: (id: string) => {
      const node = nodes.get(id);
      if (node) node.trashed = true;
    },
  };
}

/* --------------------------------------------------------------------------
 * Harness.
 * ------------------------------------------------------------------------ */

const TEXT: Record<string, string> = {
  gdrive: "Google Drive",
  gdriveNotConnected: "Google Drive is not connected yet.",
  uploading: "Uploading…",
  download: "Download",
  driveQuota: "QUOTA-MESSAGE",
  driveRateLimit: "RATE-MESSAGE",
  driveAuth: "AUTH-MESSAGE",
  drivePermission: "PERMISSION-MESSAGE",
  driveNotFound: "NOTFOUND-MESSAGE",
  driveTooLarge: "TOOLARGE-MESSAGE",
  driveServer: "SERVER-MESSAGE",
};

interface HarnessOptions {
  sessionToken?: string;
  email?: string;
  classify?: (status: number) => { kind: string; message: string };
}

function createHarness(options: HarnessOptions = {}) {
  const drive = createDrive();
  const storage = new Map<string, unknown>();
  const messages: Array<{ type: string; extra?: unknown }> = [];
  let sessionCalls = 0;
  let describeCalls = 0;

  const transport = api.createGdrivePackages({
    request: async (type: string, extra?: unknown) => {
      messages.push({ type, extra });
      if (type === "gdrivePackageSession") {
        sessionCalls += 1;
        if (!options.sessionToken) throw Error("尚未连接 Google Drive");
        return {
          token: options.sessionToken,
          email: options.email || "user@example.com",
          mode: "identity",
        };
      }
      if (type === "describeDriveError") {
        describeCalls += 1;
        const status = Number((extra as { status?: number })?.status || 0);
        return (
          options.classify?.(status) || {
            kind: "unknown",
            message: `Google Drive HTTP ${status}`,
          }
        );
      }
      throw Error(`unexpected message ${type}`);
    },
    storageGet: async (keys: string[]) => {
      const out: Record<string, unknown> = {};
      for (const key of keys) if (storage.has(key)) out[key] = storage.get(key);
      return out;
    },
    storageSet: async (values: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(values)) storage.set(key, value);
    },
    fetch: (url: string, init: RequestInit) => drive.handle(url, init),
    t: (key: string) => TEXT[key] || key,
    cacheKeys: { rootId: "pkgRootId", folderIds: "pkgFolderIds" },
  });

  return {
    drive,
    storage,
    messages,
    transport,
    sessionCalls: () => sessionCalls,
    describeCalls: () => describeCalls,
    requests: drive.requests,
  };
}

const cfg = { backend: "gdrive", gdriveFolder: "" };

/* --------------------------------------------------------------------------
 * The session is reused from the sync provider; there is no second auth flow.
 * ------------------------------------------------------------------------ */
{
  const h = createHarness({ sessionToken: "token-1" });
  const first = await h.transport.session();
  const second = await h.transport.session();
  assert.equal(first.token, "token-1");
  assert.equal(second.token, "token-1");
  assert.equal(h.sessionCalls(), 1, "the resolved session is cached");
  assert.equal(first.email, "user@example.com");
  assert.equal(first.mode, "identity");

  h.transport.resetSession();
  await h.transport.session();
  assert.equal(h.sessionCalls(), 2, "resetting forces a fresh resolution");
}

{
  const h = createHarness({});
  await assert.rejects(
    () => h.transport.session(),
    /not connected yet/i,
    "an unauthorized Drive session is reported clearly",
  );
}

/* --------------------------------------------------------------------------
 * The destination is app-managed and separate from the sync folder.
 * ------------------------------------------------------------------------ */
{
  const h = createHarness({ sessionToken: "token-1" });
  const dest = await h.transport.destination(cfg);
  assert.ok(dest.rootId);
  const roots = h.drive
    .byName("Chromium Cloud Sync Packages")
    .filter((node) => node.mimeType === FOLDER_MIME);
  assert.equal(roots.length, 1, "one app-managed package root is created");
  assert.deepEqual(roots[0].parents, [], "created at the Drive root");
  assert.equal(
    h.drive.byName("Chromium Cloud Sync").length,
    0,
    "the synchronization folder is never touched by package backup",
  );
  assert.equal(h.storage.get("pkgRootId"), dest.rootId, "root id cached locally");

  const again = await h.transport.destination(cfg);
  assert.equal(again.rootId, dest.rootId, "cached root is reused");
  assert.equal(
    h.drive.byName("Chromium Cloud Sync Packages").length,
    1,
    "no duplicate root folder",
  );
}

{
  const h = createHarness({ sessionToken: "token-1" });
  const dest = await h.transport.destination({
    backend: "gdrive",
    gdriveFolder: "Backups/2026",
  });
  assert.ok(h.drive.byName("Backups").length === 1);
  assert.ok(h.drive.byName("2026").length === 1);
  const nested = h.drive.byName("2026")[0];
  const parent = h.drive.byName("Backups")[0];
  assert.deepEqual(nested.parents, [parent.id], "subfolders nest under the root");
  assert.equal(dest.rootId, nested.id);

  const cached = await h.transport.destination({
    backend: "gdrive",
    gdriveFolder: "Backups/2026",
  });
  assert.equal(cached.rootId, nested.id);
  assert.equal(h.drive.byName("2026").length, 1, "no duplicate subfolder");
}

/* --------------------------------------------------------------------------
 * Resumable upload: length declared up front, bytes streamed to the session.
 * ------------------------------------------------------------------------ */
{
  const h = createHarness({ sessionToken: "token-1" });
  const bytes = new TextEncoder().encode("crx-bytes-".repeat(10));
  const id = await h.transport.upload(
    cfg,
    "extensions/aaa/v1.0.0/pkg.crx",
    bytes,
    "application/x-chrome-extension",
  );
  assert.ok(id, "upload returns a file id");

  const start = h.requests.find((r) => r.url.includes("uploadType=resumable"));
  assert.ok(start, "the resumable protocol is used");
  assert.equal(start.method, "POST", "a new file starts with POST");

  const node = h.drive.nodes.get(id);
  assert.equal(node?.name, "pkg.crx");
  assert.equal(node?.mimeType, "application/x-chrome-extension");
  assert.equal(node?.size, bytes.length);
  assert.deepEqual(node?.bytes, bytes, "the exact bytes are stored");

  // Intermediate folders were created for the package path.
  assert.equal(h.drive.byName("extensions").length, 1);
  assert.equal(h.drive.byName("aaa").length, 1);
  assert.equal(h.drive.byName("v1.0.0").length, 1);

  // The content length is declared before the bytes move, which is what makes
  // quota exhaustion reportable up front.
  const calls = h.drive.requests.filter((r) => r.url.includes("uploadType=resumable"));
  assert.equal(calls.length, 1);
}

{
  // A second write to the same path patches the existing file.
  const h = createHarness({ sessionToken: "token-1" });
  const path = "extensions/aaa/v1.0.0/pkg.crx";
  await h.transport.upload(cfg, path, new TextEncoder().encode("one"), "application/zip");
  const before = h.drive.byName("pkg.crx").length;
  await h.transport.upload(cfg, path, new TextEncoder().encode("two"), "application/zip");
  assert.equal(h.drive.byName("pkg.crx").length, before, "no duplicate file created");
  const patch = h.drive.requests.filter(
    (r) => r.method === "PATCH" && r.url.includes("uploadType=resumable"),
  );
  assert.equal(patch.length, 1, "the cached file id is patched");
}

{
  // A cached id pointing at a deleted file is dropped and recreated.
  const h = createHarness({ sessionToken: "token-1" });
  const path = "extensions/aaa/v1.0.0/pkg.crx";
  const id = await h.transport.upload(cfg, path, new TextEncoder().encode("one"), "application/zip");
  h.drive.failNext(`files/${id}?uploadType=resumable`, 404, {
    error: { message: "notFound" },
  });
  const next = await h.transport.upload(cfg, path, new TextEncoder().encode("two"), "application/zip");
  assert.ok(next, "upload recovers from a stale cached id");
  assert.equal(h.drive.byName("pkg.crx").filter((n) => !n.trashed).length >= 1, true);
}

/* --------------------------------------------------------------------------
 * Download, JSON control files, and missing files.
 * ------------------------------------------------------------------------ */
{
  const h = createHarness({ sessionToken: "token-1" });
  const payload = new TextEncoder().encode("package-bytes");
  await h.transport.upload(cfg, "extensions/aaa/v1/pkg.crx", payload, "application/zip");
  const downloaded = await h.transport.download(cfg, "extensions/aaa/v1/pkg.crx");
  assert.deepEqual(downloaded, payload, "download returns the stored bytes");

  await assert.rejects(
    () => h.transport.download(cfg, "extensions/aaa/v1/missing.crx"),
    /NOTFOUND-MESSAGE|not found/i,
    "a missing package is reported, not returned as empty",
  );
}

{
  const h = createHarness({ sessionToken: "token-1" });
  const fallback = { schemaVersion: 2, backups: [] };
  assert.deepEqual(
    await h.transport.readJson(cfg, "index.json", fallback),
    fallback,
    "a missing control file falls back instead of throwing",
  );

  await h.transport.writeJson(cfg, "index.json", {
    schemaVersion: 2,
    backups: [{ extensionId: "aaa" }],
  });
  const read = await h.transport.readJson(cfg, "index.json", fallback);
  assert.equal(read.schemaVersion, 2);
  assert.equal(read.backups.length, 1);
  const node = h.drive.byName("index.json")[0];
  assert.equal(node.mimeType, "application/json");
}

/* --------------------------------------------------------------------------
 * Listing walks the package tree and excludes control files.
 * ------------------------------------------------------------------------ */
{
  const h = createHarness({ sessionToken: "token-1" });
  await h.transport.upload(cfg, "extensions/aaa/v1/one.crx", new TextEncoder().encode("1"), "application/zip");
  await h.transport.upload(cfg, "extensions/bbb/v2/two.zip", new TextEncoder().encode("22"), "application/zip");
  await h.transport.writeJson(cfg, "index.json", { backups: [] });
  await h.transport.writeJson(cfg, "selection.json", { selectedIds: [] });
  await h.transport.writeJson(cfg, "extensions/aaa/v1/metadata.json", { package: {} });

  const listed = await h.transport.listPackages(cfg);
  const paths = listed.map((entry: { path: string }) => entry.path).sort();
  assert.deepEqual(paths, [
    "extensions/aaa/v1/one.crx",
    "extensions/bbb/v2/two.zip",
  ]);
  const sizes = Object.fromEntries(
    listed.map((entry: { path: string; size: number }) => [entry.path, entry.size]),
  );
  assert.equal(sizes["extensions/bbb/v2/two.zip"], 2, "listing reports real sizes");
  assert.ok(
    listed.every((entry: { modifiedTime: string }) => entry.modifiedTime),
    "listing reports timestamps",
  );
}

{
  // The walk is depth bounded, so a deep stray folder cannot loop forever.
  const h = createHarness({ sessionToken: "token-1" });
  await h.transport.destination(cfg);
  const listed = await h.transport.listPackages(cfg);
  assert.deepEqual(listed, []);
  assert.ok(
    h.requests.filter((r) => r.url.includes("/files?q=")).length <=
      api.GDRIVE_LIST_DEPTH + 2,
    "listing stays within the bounded depth",
  );
}

/* --------------------------------------------------------------------------
 * Drive failures are classified into actionable, localized messages.
 * ------------------------------------------------------------------------ */
const cases: Array<[string, number, string, string]> = [
  ["quota", 403, "quota", "QUOTA-MESSAGE"],
  ["rate limit", 429, "rate-limit", "RATE-MESSAGE"],
  ["expired authorization", 401, "auth", "AUTH-MESSAGE"],
  ["insufficient permission", 403, "permission", "PERMISSION-MESSAGE"],
  ["missing file", 404, "not-found", "NOTFOUND-MESSAGE"],
  ["upload size limit", 413, "too-large", "TOOLARGE-MESSAGE"],
  ["drive outage", 503, "server", "SERVER-MESSAGE"],
];

for (const [label, status, kind, expected] of cases) {
  const h = createHarness({
    sessionToken: "token-1",
    classify: () => ({ kind, message: `detail-${status}` }),
  });
  h.drive.failNext("/files?q=", status, { error: { message: "boom" } });
  await assert.rejects(
    () => h.transport.destination(cfg),
    (error: unknown) => {
      const e = error as Error & { kind?: string; status?: number };
      assert.match(e.message, new RegExp(expected), `${label} is localized`);
      assert.equal(e.kind, kind, `${label} keeps its kind for the UI`);
      assert.equal(e.status, status);
      return true;
    },
    label,
  );
  assert.ok(h.describeCalls() >= 1, `${label} is classified by the worker`);
}

{
  // An expired session is dropped so the next call re-resolves the token.
  const h = createHarness({
    sessionToken: "token-1",
    classify: () => ({ kind: "auth", message: "expired" }),
  });
  await h.transport.session();
  assert.equal(h.sessionCalls(), 1);
  h.drive.failNext("/files?q=", 401, { error: { message: "expired" } });
  await assert.rejects(() => h.transport.destination(cfg));
  await h.transport.session();
  assert.equal(h.sessionCalls(), 2, "an auth failure invalidates the cached session");
}

{
  // An unclassified failure still surfaces the worker's description.
  const h = createHarness({ sessionToken: "token-1" });
  h.drive.failNext("/files?q=", 418, { error: { message: "teapot" } });
  await assert.rejects(
    () => h.transport.destination(cfg),
    /Google Drive HTTP 418/,
  );
}

/* --------------------------------------------------------------------------
 * Connection test and cache invalidation.
 * ------------------------------------------------------------------------ */
{
  const h = createHarness({ sessionToken: "token-1", email: "user@example.com" });
  const result = await h.transport.testConnection(cfg);
  assert.equal(result.ok, true);
  assert.equal(result.rootName, "Chromium Cloud Sync Packages");
  assert.equal(result.email, "user@example.com");
  assert.ok(result.rootId);
}

{
  const h = createHarness({ sessionToken: "token-1" });
  const dest = await h.transport.destination(cfg);
  await h.transport.invalidateCache();
  assert.equal(h.storage.get("pkgRootId"), "");
  assert.deepEqual(h.storage.get("pkgFolderIds"), {});
  h.transport.resetSession();
  const next = await h.transport.destination(cfg);
  assert.notEqual(next.rootId, dest.rootId, "invalidation forces a fresh lookup");
}

console.log("gdrive-packages tests: OK");
