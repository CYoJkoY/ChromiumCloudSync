import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Exercise the real page script with local storage surviving page reloads.
// Expose private helpers only in this test, not in the shipped extension.
const packageIndexWindow: Record<string, unknown> = {};
(globalThis as unknown as Record<string, unknown>).window = packageIndexWindow;
await import("../src/features/package-index.ts");
const packageIndex = packageIndexWindow.CCSyncPackageIndex;
const source = readFileSync(
  new URL("../src/features/extension-storage.ts", import.meta.url), "utf8",
).replace(
  "window.CCSyncExtensionStorage = {",
  "window.CCSyncExtensionStorage = { getCfg, sameStorageConfig, packageFromRepoPath, githubListPackageFiles, githubDelete, davListPackageFiles, davDelete, parseWebdavListing, K, D,",
);
const storage: Record<string, unknown> = {};
function loadPage(fetchImpl: typeof fetch = async () => { throw Error("unexpected fetch"); }) {
  const context = vm.createContext({
    window: {
      addEventListener() {},
      CCSyncPackageIndex: packageIndex,
      CCSyncGdrivePackages: { createGdrivePackages: () => ({}) },
    },
    document: { readyState: "loading", addEventListener() {} },
    URL,
    fetch: fetchImpl,
    AbortController,
    setTimeout,
    clearTimeout,
    chrome: { permissions: { async contains() { return true; }, async request() { return true; } } },
    CCSyncRuntime: {
      async storageGet(keys: string[]) {
        return Object.fromEntries(keys.filter(key => key in storage).map(key => [key, storage[key]]));
      },
    },
  });
  vm.runInContext(source, context);
  return context.window.CCSyncExtensionStorage;
}
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
let page = loadPage();
assert.deepEqual(plain(await page.getCfg()), plain(page.D));

const webdavListing = `
  <d:multistatus xmlns:d="DAV:">
    <d:response><d:href>/dav/packages/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
    <d:response><d:href>/dav/packages/extensions/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
    <d:response><d:href>/dav/packages/extensions/abcdefghijklmnopabcdefghijklmnop/v1.2.3/example.crx</d:href><d:propstat><d:prop><d:resourcetype/><d:getcontentlength>4096</d:getcontentlength><d:getlastmodified>Wed, 01 Oct 2026 00:00:00 GMT</d:getlastmodified></d:prop></d:propstat></d:response>
    <d:response><d:href>https://elsewhere.test/dav/packages/extensions/ignored.crx</d:href><d:propstat><d:prop><d:resourcetype/></d:prop></d:propstat></d:response>
  </d:multistatus>`;
const parsedDav = plain(
  page.parseWebdavListing(webdavListing, {
    davUrl: "https://example.test/dav",
    davFolder: "/packages",
  }),
);
assert.deepEqual(parsedDav, [
  { path: "", isCollection: true, size: 0, modifiedTime: "" },
  { path: "extensions", isCollection: true, size: 0, modifiedTime: "" },
  {
    path: "extensions/abcdefghijklmnopabcdefghijklmnop/v1.2.3/example.crx",
    isCollection: false,
    size: 4096,
    modifiedTime: "Wed, 01 Oct 2026 00:00:00 GMT",
  },
], "WebDAV multistatus listing is root-scoped and preserves package metadata");
assert.deepEqual(
  plain(
    page.packageFromRepoPath(
      "packages/extensions/abcdefghijklmnopabcdefghijklmnop/v1.2.3/example.zip",
      { folder: "packages" },
      8192,
    ),
  ),
  {
    path: "extensions/abcdefghijklmnopabcdefghijklmnop/v1.2.3/example.zip",
    name: "example.zip",
    size: 8192,
    modifiedTime: "",
  },
  "GitHub package listing strips its configured root and validates the package layout",
);
assert.equal(
  page.packageFromRepoPath("packages/extensions/../../secrets.txt", { folder: "packages" }),
  null,
  "GitHub listing ignores paths outside the package layout",
);

const jsonResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(body),
});
const githubCalls: string[] = [];
const githubPage = loadPage(async (input) => {
  const url = String(input);
  githubCalls.push(url);
  if (url.includes("/git/trees/"))
    return jsonResponse({
      truncated: false,
      tree: [
        {
          type: "blob",
          path: "packages/extensions/abcdefghijklmnopabcdefghijklmnop/v1.2.3/example.crx",
          size: 123,
        },
        { type: "blob", path: "packages/index.json", size: 10 },
        { type: "tree", path: "packages/extensions/not-a-package" },
      ],
    }) as Response;
  return jsonResponse({
    private: true,
    default_branch: "main",
    permissions: { push: true },
  }) as Response;
});
const githubFiles = plain(
  await githubPage.githubListPackageFiles({
    backend: "github",
    repo: "owner/repo",
    branch: "",
    folder: "packages",
    token: "test-token",
  }),
);
assert.deepEqual(githubFiles, [
  {
    path: "extensions/abcdefghijklmnopabcdefghijklmnop/v1.2.3/example.crx",
    name: "example.crx",
    size: 123,
    modifiedTime: "",
  },
]);
assert.ok(githubCalls.some((url) => url.includes("/git/trees/main?recursive=1")));

const fallbackCalls: string[] = [];
const fallbackPage = loadPage(async (input) => {
  const url = String(input);
  fallbackCalls.push(url);
  if (url.includes("/git/trees/"))
    return jsonResponse({ truncated: true, tree: [] }) as Response;
  if (url.includes("/contents/packages/extensions?"))
    return jsonResponse([{ type: "dir", name: "abcdefghijklmnopabcdefghijklmnop" }]) as Response;
  if (url.includes("/contents/packages/extensions/abcdefghijklmnopabcdefghijklmnop?"))
    return jsonResponse([{ type: "dir", name: "v1.2.3" }]) as Response;
  if (url.includes("/contents/packages/extensions/abcdefghijklmnopabcdefghijklmnop/v1.2.3?"))
    return jsonResponse([{ type: "file", name: "fallback.zip", size: 456 }]) as Response;
  return jsonResponse({ private: true, default_branch: "main", permissions: { push: true } }) as Response;
});
const fallbackFiles = plain(
  await fallbackPage.githubListPackageFiles({
    backend: "github",
    repo: "owner/repo",
    branch: "",
    folder: "packages",
    token: "test-token",
  }),
);
assert.deepEqual(fallbackFiles, [
  {
    path: "extensions/abcdefghijklmnopabcdefghijklmnop/v1.2.3/fallback.zip",
    name: "fallback.zip",
    size: 456,
    modifiedTime: "",
  },
]);
assert.equal(fallbackCalls.filter((url) => url.includes("/contents/")).length, 3);

const deleteRequests: Array<{ url: string; method: string; body: string }> = [];
const deletePage = loadPage(async (input, init) => {
  const method = String(init?.method || "GET");
  const url = String(input);
  deleteRequests.push({ url, method, body: String(init?.body || "") });
  return method === "GET"
    ? (jsonResponse({ sha: "old-sha" }) as Response)
    : (jsonResponse({ commit: { sha: "delete-commit" } }) as Response);
});
assert.equal(
  await deletePage.githubDelete(
    {
      backend: "github",
      repo: "owner/repo",
      branch: "cleanup-branch",
      token: "test-token",
    },
    "packages/extensions/old/v1/old.crx",
    "Remove unused package",
  ),
  true,
);
assert.ok(deleteRequests[0].url.endsWith("?ref=cleanup-branch"));
assert.equal(deleteRequests[1].method, "DELETE");
assert.deepEqual(JSON.parse(deleteRequests[1].body), {
  message: "Remove unused package",
  sha: "old-sha",
  branch: "cleanup-branch",
});
const davDeletePage = loadPage(async () => ({ ok: true, status: 204 }) as Response);
assert.equal(
  await davDeletePage.davDelete(
    { davUrl: "https://example.test/dav", davFolder: "/packages", davUser: "", davPass: "" },
    "extensions/old/v1/old.crx",
  ),
  true,
);
const davMissingPage = loadPage(async () => ({ ok: false, status: 404 }) as Response);
assert.equal(
  await davMissingPage.davDelete(
    { davUrl: "https://example.test/dav", davFolder: "/packages", davUser: "", davPass: "" },
    "extensions/old/v1/old.crx",
  ),
  false,
);

const responseXml = (href: string, collection = false, size = 0) =>
  `<d:response><d:href>${href}</d:href><d:propstat><d:prop><d:resourcetype>${collection ? "<d:collection/>" : ""}</d:resourcetype><d:getcontentlength>${size}</d:getcontentlength></d:prop></d:propstat></d:response>`;
const webdavCalls: string[] = [];
const davPage = loadPage(async (input) => {
  const url = String(input);
  webdavCalls.push(url);
  let responses = "";
  if (url.endsWith("/extensions")) {
    responses =
      responseXml("/dav/packages/extensions/", true) +
      responseXml("/dav/packages/extensions/abcdefghijklmnopabcdefghijklmnop/", true);
  } else if (url.endsWith("/extensions/abcdefghijklmnopabcdefghijklmnop")) {
    responses =
      responseXml("/dav/packages/extensions/abcdefghijklmnopabcdefghijklmnop/", true) +
      responseXml("/dav/packages/extensions/abcdefghijklmnopabcdefghijklmnop/v1.2.3/", true);
  } else if (url.endsWith("/extensions/abcdefghijklmnopabcdefghijklmnop/v1.2.3")) {
    responses =
      responseXml("/dav/packages/extensions/abcdefghijklmnopabcdefghijklmnop/v1.2.3/", true) +
      responseXml("/dav/packages/extensions/abcdefghijklmnopabcdefghijklmnop/v1.2.3/restored.zip", false, 2048);
  }
  return {
    ok: true,
    status: 207,
    text: async () => `<d:multistatus xmlns:d="DAV:">${responses}</d:multistatus>`,
  } as Response;
});
const webdavFiles = plain(
  await davPage.davListPackageFiles({
    backend: "webdav",
    davUrl: "https://example.test/dav",
    davFolder: "/packages",
    davUser: "",
    davPass: "",
  }),
);
assert.deepEqual(webdavFiles, [
  {
    path: "extensions/abcdefghijklmnopabcdefghijklmnop/v1.2.3/restored.zip",
    name: "restored.zip",
    size: 2048,
    modifiedTime: "",
  },
]);
assert.equal(webdavCalls.length, 3, "WebDAV walks extension ID and version folders");

for (const backend of ["github", "webdav", "gdrive", "disabled"]) {
  const expected = {
    backend, repo: "owner/private-repo", branch: "packages", folder: "extensions",
    token: "test-token", davUrl: "https://example.test/dav", davFolder: "/packages",
    davUser: "test-user", davPass: "test-password", gdriveFolder: "backups",
    selected: ["test-extension"],
  };
  for (const [name, key] of Object.entries(page.K)) {
    storage[key as string] = expected[name as keyof typeof expected];
  }
  // A fresh page must recover the saved backend, credentials and selection,
  // not the disabled defaults with unrelated namespaced properties appended.
  page = loadPage();
  const restored = await page.getCfg();
  assert.deepEqual(plain(restored), expected);
  assert.equal(page.sameStorageConfig(restored, expected), true);
}

storage.extensionBackupSelectedIds = [];
storage.extensionBackupGithubToken = "";
assert.deepEqual(plain((await loadPage().getCfg()).selected), []);
assert.equal((await loadPage().getCfg()).token, "");
delete storage.extensionBackupGdriveFolder;
assert.equal((await loadPage().getCfg()).gdriveFolder, "");
console.log("Extension storage settings reload tests passed.");
