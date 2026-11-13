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
  "src/features/update.ts",
  "src/ui/extensions.ts",
  "src/ui/guide.ts",
  "src/ui/history.ts",
  "src/ui/i18n.ts",
  "src/ui/options.ts",
  "src/ui/popup.ts",
  "src/ui/popup-i18n.ts",
  "src/ui/popup-status.ts",
  "src/ui/popup-cloud-groups.ts",
  "src/ui/popup-actions.ts",
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
    "popup-status.js",
    "popup-cloud-groups.js",
    "popup-actions.js",
  ],
  "options.html": [
    "runtime.js",
    "theme.js",
    "i18n.js",
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
  "update.js",
  "extensions.js",
  "guide.js",
  "history.js",
  "i18n.js",
  "options.js",
  "popup.js",
  "popup-i18n.js",
  "popup-status.js",
  "popup-cloud-groups.js",
  "popup-actions.js",
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
const popupCss = fs.readFileSync(
  path.join(root, "src/ui/styles/ui-overrides.css"),
  "utf8",
);
if (!popupCss.includes("--ccs-popup-width: 500px;"))
  throw new Error("Popup CSS is missing the definite --ccs-popup-width token");
if (popupCss.includes("min(var(--ccs-popup-width), 100vw)"))
  throw new Error(
    "Popup width must not resolve through 100vw; action popups size the viewport from content and the constraint collapses",
  );
for (const popupBlock of popupCss.split("body.popup-page").slice(1)) {
  if (popupBlock.split("}")[0].includes("max-width: 100vw"))
    throw new Error("Popup layout must use a definite width instead of 100vw");
}
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
  "src/ui/popup-cloud-groups.ts",
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
  for (const required of ["read(", "write(", "remove(", "list("])
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
// #21 criterion 4: the legacy monolithic payloads are read-only migration
// archives. No source may add one to a removal set, in any spelling — the local
// alias, the canonical constant, or a bare string literal. Matching only one
// spelling let a rename or an inlined literal reintroduce silent cloud-data
// deletion without tripping the gate.
{
  const legacyArchiveNames = [
    "CURRENT_FILE",
    "LEGACY_MONOLITHIC_FILE",
    "LEGACY_ALT_FILE",
    '"current.json"',
    "'current.json'",
    '"chromium-cloud-sync.json"',
    "'chromium-cloud-sync.json'",
  ];
  for (const dir of ["src/runtime", "src/features"]) {
    for (const entry of fs.readdirSync(path.join(root, dir))) {
      if (!entry.endsWith(".ts")) continue;
      const text = fs.readFileSync(path.join(root, dir, entry), "utf8");
      for (const name of legacyArchiveNames) {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`removals\\.push\\(${escaped}\\)`).test(text))
          throw new Error(
            `${dir}/${entry} adds ${name} to the removal set; the legacy monolithic payload must be preserved as a migration archive and never deleted`,
          );
      }
    }
  }
}

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
  "export async function connectGoogleDriveWithToken",
  "export async function connectGoogleDriveManual",
  "export async function completeGoogleDriveManualAuth",
  "export function supportsBrowserManagedDriveAuth",
  "IDENTITY_TOKEN_TIMEOUT_MS",
  "extractIdentityToken",
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
// The shipped default route is the explicit redirect flow configured for a Web application client.
const googleDriveOptions = fs.readFileSync(
  path.join(root, "src/ui/options.ts"),
  "utf8",
);
for (const required of [
  "function requestGoogleDriveWebOAuth",
  "CCSyncGoogleOAuthConfig",
  'authorizeUrl.searchParams.set("redirect_uri", redirect)',
  'authorizeUrl.searchParams.set("response_type", "code")',
  'authorizeUrl.searchParams.set("code_challenge", pkce.challenge)',
  'authorizeUrl.searchParams.set("code_challenge_method", "S256")',
  'redirectUrl.protocol !== "https:"',
  "parsed.origin !== redirectUrl.origin",
  "parsed.pathname !== redirectUrl.pathname",
  'parsed.searchParams.get("state") !== pkce.state',
  "const packagedRedirectFlowAvailable =",
]) {
  if (!googleDriveOptions.includes(required))
    throw new Error("Google Drive redirect OAuth is missing " + required);
}
for (const forbidden of [
  "requestGoogleDriveInteractiveToken",
  "identity.getAuthToken",
  "canUseLegacyIdentity",
]) {
  if (googleDriveOptions.includes(forbidden))
    throw new Error("The Web application OAuth route must not use the Chrome Extension getAuthToken API: " + forbidden);
}
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
  "connectGoogleDriveManual",
  "gdriveAuthState",
  "gdriveBrowserManaged",
  'case "gdriveAuth":',
])
  if (!bgSource.includes(required))
    throw new Error("Background worker is missing Drive auth wiring " + required);
// Interactive authorization must arrive from the options-page redirect flow; the worker must not initiate an implicit default login.
const connectGdriveStart = bgSource.indexOf('case "connectGdrive":');
const completeGdriveStart = bgSource.indexOf('case "completeGdriveOAuth":', connectGdriveStart);
if (connectGdriveStart < 0 || completeGdriveStart < 0)
  throw new Error("Unable to locate Google Drive authorization message handlers");
const connectGdriveHandler = bgSource.slice(connectGdriveStart, completeGdriveStart);
if (!connectGdriveHandler.includes("Google Drive authorization must be initiated from Settings"))
  throw new Error("connectGdrive must reject empty credentials rather than initiating a hidden default auth flow");
if (connectGdriveHandler.includes("connectGoogleDriveBrowser"))
  throw new Error("connectGdrive must not dispatch to the legacy getAuthToken-based interactive flow");

const manifestText = fs.readFileSync(path.join(root, "manifest.json"), "utf8");
if (!/"identity"/.test(manifestText))
  throw new Error("manifest.json must declare the identity permission");
if (/"oauth2"/.test(manifestText))
  throw new Error("manifest.json must not declare oauth2 for the Web application redirect client");

const buildSource = fs.readFileSync(
  path.join(root, "scripts/build.ts"),
  "utf8",
);
for (const required of [
  "delete outputManifest.oauth2",
  "window.CCSyncGoogleOAuthConfig",
  "process.env.GDRIVE_OAUTH_CLIENT_ID",
]) {
  if (!buildSource.includes(required))
    throw new Error("Build must package the Web application OAuth Client ID outside manifest.oauth2: " + required);
}
for (const forbidden of [
  "outputManifest.oauth2 =",
  "manifest.oauth2?.client_id",
]) {
  if (buildSource.includes(forbidden))
    throw new Error("Build must not inject a Web application Client ID into manifest.oauth2: " + forbidden);
}

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
  'id="gdriveManualRedirectHelp"',
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
for (const forbidden of ["extension-storage.js", "extension-backup.css"])
  if (htmlFiles.some((file) => fs.readFileSync(path.join(root, "src/ui/pages", file), "utf8").includes(forbidden)))
    throw new Error("Built pages must not reference removed extension package backup assets: " + forbidden);
// The full-file backup flow and its native helper were removed entirely. Keep
// the removed surface from creeping back into the shipped pages or manifest.
for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(root, "src/ui/pages", file), "utf8");
  if (/fullBackup|full-backup|native helper/i.test(html))
    throw new Error(`${file} must not reference the removed full backup feature`);
}
if ((manifest.permissions || []).includes("nativeMessaging"))
  throw new Error("nativeMessaging was only used by the removed full backup helper");
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
  "updateGoogleDriveConnectAvailability",
  "getPackagedGoogleOAuthClientId",
  "requestGoogleDriveWebOAuth",
  "packagedRedirectFlowAvailable",
  "requestGoogleDriveWebOAuth",
  "completeGoogleDriveWebOAuth",
  'request("completeGdriveOAuth", {',
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

const popupCloudGroupsSource = fs.readFileSync(
  path.join(root, "src/ui/popup-cloud-groups.ts"),
  "utf8",
);
for (const required of [
  "renderCloudGroups",
  "cloudTabStateChanged",
  "forceRemote",
])
  if (!popupCloudGroupsSource.includes(required))
    throw new Error(
      "Popup cloud-groups module is missing canonical cloud-tab support: " +
        required,
    );

for (const required of [
  "refreshCloudTabs(true)",
  "cloudTabStateChanged",
  "data.groups",
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
// Translation key completeness.
//
// Translation keys are checked against the shared UI table or the extensions table.
// Referencing a key that its own file's table does not define is not an error at
// runtime — every one of the three lookups ends in `?? key`, so the UI silently
// renders the raw identifier ("searchCrxsoso") instead of a sentence. That is
// invisible to the type checker because the keys are plain strings. Resolve each
// literal reference against the table the referencing file actually uses.
// ---------------------------------------------------------------------------
{
  const readLines = (file: string): string[] =>
    fs.readFileSync(path.join(root, file), "utf8").split("\n");

  const plainKey = /^\s*"?([A-Za-z0-9_]+)"?\s*:/;
  const closureKey = /^\s*([A-Za-z0-9_]+)\s*:\s*\(\)\s*=>/;

  const keysUntil = (
    lines: string[],
    startIndex: number,
    endTest: (line: string) => boolean,
    pattern: RegExp,
    label: string,
  ): Set<string> => {
    if (startIndex < 0)
      throw new Error(`Translation gate cannot locate the start of ${label}`);
    const found = new Set<string>();
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      if (endTest(lines[index])) return found;
      const match = pattern.exec(lines[index]);
      if (match) found.add(match[1]);
    }
    throw new Error(`Translation gate cannot locate the end of ${label}`);
  };

  const i18nLines = readLines("src/ui/i18n.ts");
  const sharedDict = keysUntil(
    i18nLines,
    i18nLines.findIndex((line) => /^\s*en:\s*\{/.test(line)),
    (line) => line.includes('"zh-CN"'),
    plainKey,
    "the shared DICT.en block in src/ui/i18n.ts",
  );

  const extensionLines = readLines("src/ui/extensions.ts");
  const extensionDictStart = extensionLines.findIndex((line) =>
    /^\s*const dict = \{/.test(line),
  );
  const extensionDict = keysUntil(
    extensionLines,
    extensionLines.findIndex(
      (line, index) => index > extensionDictStart && /^\s*en:\s*\{/.test(line),
    ),
    (line) => line.includes('"zh-CN"'),
    plainKey,
    "the local dict.en block in src/ui/extensions.ts",
  );

  const consumers: Array<[string, Set<string>]> = [
    ["src/ui/popup.ts", sharedDict], ["src/ui/popup-status.ts", sharedDict],
    ["src/ui/popup-cloud-groups.ts", sharedDict], ["src/ui/popup-actions.ts", sharedDict],
    ["src/ui/options.ts", sharedDict], ["src/ui/history.ts", sharedDict],
    ["src/ui/extensions.ts", extensionDict],
  ];

  const reference = /\bt\(\s*"([A-Za-z0-9_]+)"/g;
  for (const [file, table] of consumers) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    for (const match of source.matchAll(reference))
      if (!table.has(match[1]))
        throw new Error(
          `${file} renders t("${match[1]}") but its translation table does not define that key, so the UI would show the raw identifier instead of a localized string`,
        );
  }

  // A new page that translates strings must be added to the table above rather
  // than escape the check entirely.
  const covered = new Set(consumers.map(([file]) => file));
  const mentionsTranslation = /\bt\(\s*"[A-Za-z0-9_]+"/;
  const walk = (dir: string): string[] =>
    fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(`${dir}/${entry.name}`)
        : entry.name.endsWith(".ts")
          ? [`${dir}/${entry.name}`]
          : [],
    );
  for (const file of walk("src")) {
    if (covered.has(file)) continue;
    if (mentionsTranslation.test(fs.readFileSync(path.join(root, file), "utf8")))
      throw new Error(
        `${file} references translation keys but is not covered by the translation completeness gate`,
      );
  }
}

console.log(
  `Validation passed for organized TypeScript sources and generated runtime ${baseVersion}`,
);
