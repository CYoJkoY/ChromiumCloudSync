// @ts-nocheck
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, "dist");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
);
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
const baseVersion = String(manifest.version || "").trim();

if (!/^\d+\.\d+\.\d+$/.test(baseVersion))
  throw new Error(`invalid manifest version ${baseVersion}; expected X.Y.Z`);

if (Object.prototype.hasOwnProperty.call(manifest, "version_name")) {
  throw new Error(
    "manifest.version_name is disabled. Remove it and use a single stable release channel.",
  );
}

if (pkg.version !== baseVersion)
  throw new Error(
    `package.json version ${pkg.version} is not synchronized with manifest.version ${baseVersion}`,
  );

if (manifest.background?.service_worker !== "background.js")
  throw new Error(
    "Manifest background service worker must remain background.js in the built extension",
  );

const compactSource = (text: string): string =>
  text.replace(/\s+/g, "").replace(/"/g, "'").replace(/`/g, "'");

const sourceFiles = [
  "src/runtime/types.ts",
  "src/runtime/sync-core.ts",
  "src/runtime/schema.ts",
  "src/runtime/storage.ts",
  "src/runtime/browser-capabilities.ts",
  "src/runtime/cloud-files.ts",
  "src/runtime/cloud-gist.ts",
  "src/runtime/sync-modules.ts",
  "src/runtime/cloud-tab-state.ts",
  "src/runtime/diagnostics.ts",
  "src/runtime/legacy-crypto.ts",
  "src/runtime/background.ts",
  "src/runtime/cloud-gdrive.ts",
  "src/runtime/cloud-webdav.ts",
  "src/features/extension-storage.ts",
  "src/features/extension-storage-watch.ts",
  "src/features/update.ts",
  "src/ui/extensions.ts",
  "src/ui/guide.ts",
  "src/ui/history.ts",
  "src/ui/i18n.ts",
  "src/ui/options.ts",
  "src/ui/popup.ts",
  "src/ui/popup-i18n.ts",
  "src/ui/popup-fixes.ts",
  "src/ui/runtime.ts",
  "src/ui/theme.ts",
];
const htmlFiles = [
  "popup.html",
  "options.html",
  "history.html",
  "guide.html",
  "extensions.html",
];
const htmlSources = Object.fromEntries(
  htmlFiles.map((file) => [file, `src/ui/pages/${file}`]),
);
const requiredRefs = {
  "popup.html": [
    "runtime.js",
    "theme.js",
    "i18n.js",
    "popup-i18n.js",
    "popup.js",
    "update.js",
    "popup-fixes.js",
  ],
  "options.html": [
    "runtime.js",
    "theme.js",
    "i18n.js",
    "extension-storage.js",
    "options.js",
  ],
  "history.html": ["runtime.js", "theme.js", "i18n.js", "history.js"],
  "guide.html": ["theme.js", "guide.js"],
  "extensions.html": ["runtime.js", "theme.js", "i18n.js", "extensions.js"],
};
const runtimeFiles = [
  "background.js",
  "browser-capabilities.js",
  "cloud-files.js",
  "cloud-gist.js",
  "sync-modules.js",
  "cloud-tab-state.js",
  "diagnostics.js",
  "legacy-crypto.js",
  "schema.js",
  "storage.js",
  "sync-core.js",
  "types.js",
  "extension-storage.js",
  "extension-storage-watch.js",
  "update.js",
  "extensions.js",
  "guide.js",
  "history.js",
  "i18n.js",
  "options.js",
  "popup.js",
  "popup-i18n.js",
  "popup-fixes.js",
  "runtime.js",
  "theme.js",
  "cloud-gdrive.js",
  "cloud-webdav.js",
];

for (const file of sourceFiles)
  if (!fs.existsSync(path.join(root, file)))
    throw new Error(`Missing TypeScript source ${file}`);
for (const [file, source] of Object.entries(htmlSources))
  if (!fs.existsSync(path.join(root, source)))
    throw new Error(`Missing HTML source ${source}`);
for (const file of [
  "src/ui/styles/ui.css",
  "src/ui/styles/ui-system.css",
  "src/ui/styles/ui-overrides.css",
])
  if (!fs.existsSync(path.join(root, file)))
    throw new Error(`Missing CSS source ${file}`);
if (!fs.existsSync(path.join(root, "tsconfig.strict.json")))
  throw new Error("Missing strict TypeScript configuration.");

for (const entry of fs.readdirSync(root)) {
  if (/\.(ts|tsx|html|css)$/i.test(entry))
    throw new Error(
      `Extension source file must not live in repository root: ${entry}`,
    );
}

const trackedJs = execFileSync("git", ["ls-files", "-z", "--", "*.js"], {
  cwd: root,
  encoding: "utf8",
});
if (trackedJs)
  throw new Error(
    `Tracked JavaScript source files are forbidden:\n${trackedJs.split("\0").filter(Boolean).join("\n")}`,
  );

for (const html of htmlFiles) {
  const text = fs.readFileSync(path.join(root, htmlSources[html]), "utf8");
  for (const script of requiredRefs[html])
    if (!text.includes(`src="${script}"`))
      throw new Error(
        `${html} is missing generated runtime reference ${script}`,
      );
  if (/<script[^>]+src="(?:\.\/)?dist\//i.test(text))
    throw new Error(`${html} must use extension-root runtime paths`);
}

for (const file of runtimeFiles) {
  const target = path.join(dist, file);
  if (!fs.existsSync(target))
    throw new Error(
      `Missing generated dist runtime ${file}; run npm run build:extension first`,
    );
  execFileSync(process.execPath, ["--check", target], { stdio: "inherit" });
}

const distManifest = JSON.parse(
  fs.readFileSync(path.join(dist, "manifest.json"), "utf8"),
);
if (distManifest.background?.service_worker !== "background.js")
  throw new Error(
    "Built manifest background service worker must remain background.js",
  );
for (const html of htmlFiles) {
  const text = fs.readFileSync(path.join(dist, html), "utf8");
  for (const script of requiredRefs[html]) {
    if (!text.includes(`src="${script}"`))
      throw new Error(`Built ${html} is missing script reference ${script}`);
    if (!fs.existsSync(path.join(dist, script)))
      throw new Error(`Built ${html} references missing runtime ${script}`);
  }
}

const scanFiles = [
  "src/runtime/background.ts",
  "src/runtime/sync-core.ts",
  "src/ui/popup.ts",
  "src/ui/popup-fixes.ts",
  "src/ui/guide.ts",
  "README.md",
  "src/ui/extensions.ts",
  "src/ui/pages/extensions.html",
  "src/ui/pages/options.html",
];
for (const file of scanFiles) {
  const text = fs.readFileSync(path.join(root, file), "utf8");
  if (
    /extensionSettings|applyExtensionSettings|collectExtensionSettings|settingsSyncTimer|applyingRemoteExtensionSettings/.test(
      text,
    )
  )
    throw new Error(
      `Legacy extension-settings synchronization residue found in ${file}`,
    );
}

const bg = fs.readFileSync(
  path.join(root, "src/runtime/background.ts"),
  "utf8",
);
const bgCompact = compactSource(bg);

/* ---------------------------------------------------------------------------
 * Issue #21: modular per-module storage layout
 * ------------------------------------------------------------------------- */
const syncModules = fs.readFileSync(
  path.join(root, "src/runtime/sync-modules.ts"),
  "utf8",
);
for (const required of [
  'extensions: "extensions.json"',
  'bookmarks: "bookmarks.json"',
  'tabs: "tabs.json"',
  'export const MANIFEST_FILE = "manifest.json"',
  'export const META_FILE = "meta.json"',
  'export const HISTORY_INDEX_FILE = "history/index.json"',
  "export function splitCloudState",
  "export function combineModularState",
  "export function migrateLegacyToModular",
  "export function diffModuleChanges",
  "export function bumpModuleRevisions",
  "export function mergeModularCloudState",
  "export function isLegacyMonolithicPayload",
])
  if (!syncModules.includes(required))
    throw new Error("Modular storage contract is missing " + required);

const cloudFiles = fs.readFileSync(
  path.join(root, "src/runtime/cloud-files.ts"),
  "utf8",
);
for (const required of [
  "export async function readRemoteModularState",
  "export async function writeRemoteModularState",
  "export async function readHistoryEntryState",
  "export async function persistLegacyMigration",
  "export interface FileStore",
  "export interface FileStoreHistory",
])
  if (!cloudFiles.includes(required))
    throw new Error("Provider file protocol is missing " + required);
// The legacy monolithic payload must be preserved as a migration archive.
if (!/removals\.delete\(LEGACY_MONOLITHIC_FILE\)/.test(cloudFiles))
  throw new Error(
    "Modular write path may delete the legacy current.json archive; migration must preserve cloud data",
  );

for (const provider of [
  ["src/runtime/cloud-gist.ts", "createGistFileStore"],
  ["src/runtime/cloud-gdrive.ts", "createGdriveFileStore"],
  ["src/runtime/cloud-webdav.ts", "createWebdavFileStore"],
]) {
  const [file, factory] = provider;
  const text = fs.readFileSync(path.join(root, file), "utf8");
  if (!text.includes(`export function ${factory}`))
    throw new Error(`${file} must export ${factory}`);
  for (const required of ["read(", "write(", "remove(", "list(", "history:"])
    if (!text.includes(required))
      throw new Error(`${file} FileStore is missing ${required}`);
}

const gistTransport = fs.readFileSync(
  path.join(root, "src/runtime/cloud-gist.ts"),
  "utf8",
);
const gistCompact = compactSource(gistTransport);
// Gist deletions must use a null file value, never `{ content: null }`.
if (!gistCompact.includes("payload[name]=null"))
  throw new Error(
    "Gist transport must delete files with a null file value in the PATCH payload",
  );
if (/\{content:null\}/.test(gistCompact))
  throw new Error(
    "Invalid Gist PATCH payload: a null content value does not delete a file",
  );
if (!gistCompact.includes("truncated") || !gistCompact.includes("raw_url"))
  throw new Error(
    "Gist transport must resolve truncated file content through raw_url",
  );

// Legacy encrypted payload cleanup stays guarded by presence in prior files.
if (
  !bgCompact.includes(
    "names.includes(LEGACY_ENCRYPTED_FILE))removals.push(LEGACY_ENCRYPTED_FILE)",
  )
)
  throw new Error("Missing legacy encrypted file cleanup guard");
if (/removals\.push\(CURRENT_FILE\)/.test(bg))
  throw new Error(
    "current.json must be preserved as the modular migration archive, never deleted",
  );

for (const required of [
  "readRemoteModularState(store, validatedState)",
  "writeRemoteModularState(store, modular",
  "diffModuleChanges(",
  "bumpModuleRevisions(",
  "mergeModularCloudState({",
  "serializeModularState(",
  "listRemoteHistory(store)",
  "readHistoryEntryState(store",
])
  if (!bg.includes(required))
    throw new Error(
      "Background worker does not use the modular storage protocol: " + required,
    );

/* ---------------------------------------------------------------------------
 * Issue #22: browser-managed Google Drive OAuth
 * ------------------------------------------------------------------------- */
const gdrive = fs.readFileSync(
  path.join(root, "src/runtime/cloud-gdrive.ts"),
  "utf8",
);
for (const required of [
  "export const GDRIVE_SCOPE = \"https://www.googleapis.com/auth/drive.file\"",
  "export async function connectGoogleDriveBrowser",
  "export async function connectGoogleDriveManual",
  "export function supportsBrowserManagedDriveAuth",
  "export class DriveAuthError",
  "getAuthToken",
  "removeCachedAuthToken",
  "clearAllCachedAuthTokens",
  "getAccounts",
])
  if (!gdrive.includes(required))
    throw new Error("Google Drive auth is missing " + required);
// The minimum scope must be the only one requested.
if (/auth\/drive(?!\.file)/.test(gdrive))
  throw new Error(
    "Google Drive must request only the minimum drive.file scope",
  );
// Browser-managed auth must be the default; manual client config is a fallback.
if (!/interactive,\s*\n?\s*scopes: IDENTITY_SCOPES/.test(gdrive))
  throw new Error(
    "Drive tokens must be minted through chrome.identity.getAuthToken with an explicit scope list",
  );
if (!gdrive.includes("readAuthState()") || !gdrive.includes("writeAuthState("))
  throw new Error("Drive authorization state must be stored locally");

const capabilities = fs.readFileSync(
  path.join(root, "src/runtime/browser-capabilities.ts"),
  "utf8",
);
for (const required of [
  "identityGetAuthToken: boolean",
  "identityTokenCache: boolean",
  "identityGetAuthToken: hasFunction(identity, \"getAuthToken\")",
])
  if (!capabilities.includes(required))
    throw new Error("Browser capabilities are missing " + required);

// The synchronization payload must never carry provider credentials.
if (!cloudFiles.includes("export function assertNoCredentialsInPayload"))
  throw new Error("Missing credential guard for the synchronization payload");
if (!/assertNoCredentialsInPayload\(serialized\)/.test(cloudFiles))
  throw new Error(
    "writeRemoteModularState must reject payloads containing OAuth credentials",
  );

const bgSource = bg;
for (const required of [
  "connectGoogleDriveBrowser",
  "connectGoogleDriveManual",
  "gdriveAuthState",
  "gdriveBrowserManaged",
  'case "gdriveAuth":',
])
  if (!bgSource.includes(required))
    throw new Error("Background worker is missing Drive auth wiring " + required);
// An empty connect payload must select the browser-managed flow.
if (!/clientId\s*\n?\s*\?\s*\n?\s*await connectGoogleDriveManual/.test(bgSource))
  throw new Error(
    "connectGdrive must default to browser-managed OAuth and use the manual client only when one is supplied",
  );

const manifestText = fs.readFileSync(path.join(root, "manifest.json"), "utf8");
if (!/"identity"/.test(manifestText))
  throw new Error("manifest.json must declare the identity permission");

const optionsHtml = fs.readFileSync(
  path.join(root, "src/ui/pages/options.html"),
  "utf8",
);
for (const required of [
  'id="providerCard"',
  'id="githubCard"',
  'id="gdriveCard"',
  'id="webdavCard"',
  'id="autoSyncCard"',
  'id="restoreModeCard"',
  'id="tabSyncModeCard"',
  'id="tabSyncMode"',
  'id="saveTabSyncMode"',
  'id="panel-cloud-tabs"',
  'id="cloudTabsManager"',
  'id="addCurrentTabsToCloud"',
  'id="gdriveConnectBrowser"',
  'id="gdriveAuthState"',
  'id="gdriveManualDetails"',
  'id="gdriveManualNotice"',
])
  if (!optionsHtml.includes(required))
    throw new Error("Options page is missing required UI anchor " + required);
{
  const manualSection = optionsHtml.indexOf('id="gdriveManualDetails"');
  const clientIdField = optionsHtml.indexOf('id="gdriveClientId"');
  const browserButton = optionsHtml.indexOf('id="gdriveConnectBrowser"');
  if (manualSection < 0 || clientIdField < 0 || browserButton < 0)
    throw new Error("Google Drive card is missing an authorization control");
  if (!(browserButton < manualSection && manualSection < clientIdField))
    throw new Error(
      "Browser-managed connection must be the primary control and the manual OAuth client must stay inside the advanced fallback section",
    );
}
if (optionsHtml.includes("extension-storage-layout.js"))
  throw new Error("Obsolete extension storage layout shim is still loaded");
for (const required of [
  'id="extensionStorageNavLabel"',
  'id="extensionStoragePanelTitle"',
  'id="extensionStoragePanelDescription"',
])
  if (!optionsHtml.includes(required))
    throw new Error("Missing extension storage anchor " + required);

const optionsSource = fs.readFileSync(
  path.join(root, "src/ui/options.ts"),
  "utf8",
);
for (const required of [
  "loadProvider()",
  "getTabSyncSettings",
  "setTabSyncMode",
  "refreshCloudTabs",
  "addCurrentTabsToCloud",
  "githubCard.hidden",
  "gdriveCard.hidden",
  "webdavCard.hidden",
  "renderGdriveAuthState",
  'request("connectGdrive", {})',
])
  if (!optionsSource.includes(required))
    throw new Error(
      "Options controller is missing required implementation " + required,
    );

/* ---------------------------------------------------------------------------
 * Issue #20: the popup restore view and the Cloud Tabs management page must
 * read one canonical dataset, and Refresh must force a remote read.
 * ------------------------------------------------------------------------- */
for (const required of [
  "buildCanonicalCloudTabState",
  "resolveCanonicalCloudTabState",
  "publishCanonicalCloudTabState",
  "broadcastCloudTabState",
  "invalidateCloudTabCache",
  "isCacheUsable",
  "canonicalCloudTabPayload",
  'case "refreshCloudTabState":',
  "forceRemote: true",
])
  if (!bg.includes(required))
    throw new Error(
      "Background worker is missing canonical cloud-tab state support: " +
        required,
    );

// Every cloud-tab reader must go through the canonical projection.
for (const message of ["cloudGroups", "cloudTabState", "restoreGroup"]) {
  const caseStart = bg.indexOf(`case "${message}"`);
  if (caseStart < 0)
    throw new Error(`Background worker lost the ${message} message handler`);
}
if (/case "cloudGroups":[\s\S]{0,400}await pullState\(\)/.test(bg))
  throw new Error(
    "cloudGroups must read the canonical cloud-tab projection, not pullState()",
  );
if (/case "cloudTabState":[\s\S]{0,400}await pullState\(\)/.test(bg))
  throw new Error(
    "cloudTabState must read the canonical cloud-tab projection, not pullState()",
  );

const popupSource = fs.readFileSync(
  path.join(root, "src/ui/popup.ts"),
  "utf8",
);
for (const required of [
  "renderCloudGroups",
  "cloudTabStateChanged",
  "refreshCloudGroups",
  "forceRemote",
])
  if (!popupSource.includes(required))
    throw new Error("Popup is missing canonical cloud-tab support: " + required);

for (const required of [
  "refreshCloudTabs(true)",
  "cloudTabStateChanged",
  "detachedGroups",
  "forceRemote",
])
  if (!optionsSource.includes(required))
    throw new Error(
      "Options controller is missing canonical cloud-tab support: " + required,
    );

const popupHtml = fs.readFileSync(
  path.join(root, "src/ui/pages/popup.html"),
  "utf8",
);
for (const required of ['id="refreshCloudGroups"', 'id="cloudGroupsMeta"'])
  if (!popupHtml.includes(required))
    throw new Error("Popup page is missing anchor " + required);
for (const required of ['data-i18n="refreshFromCloud"', 'data-i18n="cloudTabsHelpShared"'])
  if (!optionsHtml.includes(required))
    throw new Error("Options page is missing anchor " + required);

const buildLocalStateStart = bg.indexOf("async function buildLocalState(");
const buildLocalStateEnd = bg.indexOf(
  "async function pushSnapshot(",
  buildLocalStateStart,
);
if (buildLocalStateStart < 0 || buildLocalStateEnd < 0)
  throw new Error("Unable to locate buildLocalState for tab sync validation");
const buildLocalState = bg.slice(buildLocalStateStart, buildLocalStateEnd);
for (const required of [
  "tabSyncMode = await getTabSyncMode()",
  "{ tabSyncMode }",
  'tabSyncMode === "incremental"',
])
  if (!buildLocalState.includes(required))
    throw new Error(
      "Incremental tab sync is not wired into buildLocalState: " + required,
    );
const storage = fs.readFileSync(
  path.join(root, "src/features/extension-storage.ts"),
  "utf8",
);
const storageCompact = compactSource(storage);
for (const required of [
  "extensionBackupGithubToken",
  "extensionBackupSelectedIds",
  "githubInfo",
  "selection.json",
  "ccsyncExtensionPackageInput",
  "sameStorageConfig",
  "ccsync-ext-hidden",
  "refreshLanguage",
])
  if (!storageCompact.includes(required))
    throw new Error(`Extension storage is missing ${required}`);
if (!storageCompact.includes("setHidden(el,!gh)"))
  throw new Error(
    "GitHub extension-backup fields do not use explicit dynamic visibility",
  );
if (!storageCompact.includes("setHidden(el,!dv)"))
  throw new Error(
    "WebDAV extension-backup fields do not use explicit dynamic visibility",
  );
if (!storageCompact.includes("if(!d.private)throwError(t('privateRepo'))"))
  throw new Error(
    "GitHub extension-backup storage does not enforce private repositories",
  );
if (
  !storageCompact.includes(
    "if(d.permissions&&!d.permissions.push)throwError(t('notWritable'))",
  )
)
  throw new Error(
    "GitHub extension-backup storage does not enforce write access",
  );
if (
  !storageCompact.includes(
    "String(a.token||'').trim()===String(b.token||'').trim()",
  )
)
  throw new Error(
    "GitHub extension-backup selection matching does not include the Token",
  );
if (!storageCompact.includes("String(a.davPass||'')===String(b.davPass||'')"))
  throw new Error(
    "WebDAV extension-backup selection matching does not include the password",
  );

console.log(
  `Validation passed for organized TypeScript sources and generated runtime ${baseVersion}`,
);
