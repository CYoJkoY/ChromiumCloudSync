import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Exercise the real page script with local storage surviving page reloads.
// Expose private helpers only in this test, not in the shipped extension.
const source = readFileSync(
  new URL("../src/features/extension-storage.ts", import.meta.url), "utf8",
).replace("window.CCSyncExtensionStorage = {", "window.CCSyncExtensionStorage = { getCfg, sameStorageConfig, K, D,");
const storage: Record<string, unknown> = {};
function loadPage() {
  const context = vm.createContext({
    window: { addEventListener() {}, CCSyncGdrivePackages: { createGdrivePackages: () => ({}) } },
    document: { readyState: "loading", addEventListener() {} },
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
