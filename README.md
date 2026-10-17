<div align="center">

<picture>
  <img src="assets/readme/hero-v2.svg" alt="Chromium Cloud Sync — synchronize Chromium browser state across devices with selectable cloud providers" width="100%">
</picture>

<p>
  <img src="https://img.shields.io/badge/Manifest-V3-315EFB?style=flat-square" alt="Manifest V3">
  <img src="https://img.shields.io/github/v/release/CYoJkoY/ChromiumCloudSync?style=flat-square&label=release" alt="Latest release">
  <img src="https://img.shields.io/github/license/CYoJkoY/ChromiumCloudSync?style=flat-square" alt="MIT license">
  <img src="https://img.shields.io/github/actions/workflow/status/CYoJkoY/ChromiumCloudSync/release.yml?style=flat-square&label=release" alt="Release workflow status">
</p>

<p><strong>Sync the browser state that Chromium browsers leave disconnected.</strong></p>

<p>
  <a href="#readme-overview">Overview</a> ·
  <a href="#readme-features">Features</a> ·
  <a href="#readme-providers">Cloud providers</a> ·
  <a href="#readme-storage-layout">Storage layout</a> ·
  <a href="#readme-gdrive-auth">Google Drive auth</a> ·
  <a href="#readme-sync-model">Sync model</a> ·
  <a href="#readme-data-scope">Data scope</a> ·
  <a href="#readme-extension-recovery">Extension recovery</a> ·
  <a href="#readme-package-backup">Package backup</a> ·
  <a href="#readme-security">Security</a> ·
  <a href="#readme-installation">Installation</a> ·
  <a href="#readme-usage">Usage</a> ·
  <a href="#readme-history">History</a> ·
  <a href="#readme-architecture">Architecture</a> ·
  <a href="#readme-development">Development</a> ·
  <a href="#readme-status">Status</a> ·
  <a href="#readme-support">Support</a> ·
  <a href="#readme-license">License</a>
</p>

</div>

---

<a name="readme-overview"></a>

## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Overview

**Chromium Cloud Sync** is a Manifest V3 browser extension for synchronizing Chromium browser state across devices through a selectable cloud provider, without depending on a browser vendor's built-in sync service.

The current implementation synchronizes tab groups and their HTTP(S) member tabs, bookmarks, and installed third-party extension metadata. Standalone tabs and whole-window layouts are not uploaded. It also provides extension recovery and a separate CRX/ZIP package-backup path.

<a name="readme-features"></a>

## <img src="assets/readme/icons/features.svg" width="24" height="24" alt=""> Features

| Capability                    | Description                                                                                                           |
| :---------------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| **Tab groups**                | Synchronize group identity, title, color, collapsed state, and member tabs needed to restore each group; standalone tabs and whole-window layouts are excluded. |
| **Bookmarks**                 | Sync bookmark titles, URLs, parent relationships, order, and stable IDs.                                              |
| **Extension inventory**       | Track third-party extension ID, name, version, enabled state, installation type, update information, and store links. |
| **Extension Recovery Center** | Detect missing extensions and surface available Chrome Web Store, Edge Add-ons, or compatible recovery links.         |
| **Three-way merge**           | Merge base, local, and remote snapshots instead of blindly replacing one side.                                        |
| **Deletion tombstones**       | Preserve deletions so stale devices do not silently recreate removed items.                                           |
| **Conflict visibility**       | Keep unresolved field conflicts explicit for review.                                                                  |
| **Provider-independent sync** | Run manual and automatic synchronization through the selected cloud provider.                                         |
| **Automatic sync**            | Optional background synchronization with configurable intervals; disabled by default.                                 |
| **History & rollback**        | Use provider-native history plus a local index of up to 30 recent entries where supported.                            |
| **Package backup**            | Store selected CRX/ZIP packages separately in a GitHub private repository, WebDAV, or Google Drive, including packaging them straight from the browser profile or an unpacked source folder. |
| **Bilingual UI**              | English and Simplified Chinese interfaces.                                                                            |
| **Theme controls**            | Explicit theme controls for settings and auxiliary pages.                                                             |

<a name="readme-providers"></a>

## <img src="assets/readme/icons/features.svg" width="24" height="24" alt=""> Cloud providers

The synchronization engine is separated from the storage backend. Choose the provider that fits the environment:

| Provider         | What it stores                                   | Authentication / access                                     | History source                         |
| :--------------- | :----------------------------------------------- | :---------------------------------------------------------- | :------------------------------------- |
| **GitHub Gist**  | Modular sync files (see below) inside one Gist   | GitHub Token + private Gist                                 | Gist revision / commit history         |
| **Google Drive** | Modular sync files inside an application folder  | Google OAuth Web application client with the exact extension redirect URI; manual PKCE setup remains available | No app-managed history archives |
| **WebDAV**       | Modular sync files only                          | WebDAV URL, optional folder, username and password/app auth | No app-managed history archives |

For GitHub Gist, the extension creates or binds a private Gist. Google Drive uses the `drive.file` scope and keeps its authorization state in the local browser profile. WebDAV requests require the user to grant access to the configured server origin.

<a name="readme-gdrive-auth"></a>

### Connecting Google Drive

Google Drive's default connection path uses `chrome.identity.launchWebAuthFlow()` with the redirect URI returned by `chrome.identity.getRedirectURL()`. Configure `GDRIVE_OAUTH_CLIENT_ID` as a Google OAuth **Web application** client ID. A **Chrome Extension** client registered only with an Item ID is not the right client configuration for this explicit redirect-based flow.

1. In Google Cloud Console, open **APIs & Services → Credentials** and create an OAuth client ID of type **Web application**.
2. In that client's **Authorized redirect URIs**, add the exact URI shown in ChromiumCloudSync's expanded Google Drive OAuth settings. It must match `chrome.identity.getRedirectURL()` exactly; the usual form is `https://<extension-id>.chromiumapp.org/`, including the trailing slash.
3. Copy the extension ID from the actual installed build in `chrome://extensions`. Do not assume an unpacked/development build has the same ID as the Chrome Web Store listing or release CRX. Each distinct extension ID needs its own authorized redirect URI.
4. If Google's OAuth consent screen is in **Testing** mode, add the Google account you are signing in with to its **Test users** list. Ensure the Google Drive API is enabled in the same Google Cloud project.
5. In GitHub, open **Settings → Secrets and variables → Actions → Variables** and set `GDRIVE_OAUTH_CLIENT_ID` to this Web application client's public Client ID. The default extension flow does not use a client secret.
6. The release build injects the public Client ID into the generated `options.js` runtime configuration, **not** `manifest.oauth2`. That manifest field is for Chrome Extension clients consumed by `getAuthToken`, whereas this flow uses a Web application client with `launchWebAuthFlow`. The options page sends `response_type=token`, `scope=https://www.googleapis.com/auth/drive.file`, and the exact redirect URI. The flow validates the returned redirect, OAuth `state`, token, and expiry; access tokens remain in local extension storage only.
7. For another Chromium installation or an unpacked build with a different ID, add that build's exact redirect URI as an additional **Authorized redirect URI** to the same Web application client, or configure a separate Web application client ID. The Advanced/manual OAuth path also uses Web application credentials with PKCE.

The extension-specific redirect approach follows the pattern used by the [Read Frog Google Drive sync implementation](https://github.com/mengxi-ream/read-frog/pull/726), while retaining ChromiumCloudSync's existing file layout and least-privilege `drive.file` scope.

All three providers store the same set of independent module files — the provider only decides where those files live and how it versions them.

<a name="readme-storage-layout"></a>

### Cloud storage layout

Synchronized data is **not** one monolithic file. Each synchronized resource is stored independently so it can be uploaded, downloaded, and versioned on its own:

| File                 | Contents                                                                  |
| :------------------- | :------------------------------------------------------------------------ |
| `manifest.json`      | Storage layout, schema version, module index, legacy archive pointer       |
| `meta.json`          | Revisions, tombstone counts, migration record, orphan tombstones           |
| `extensions.json`    | Extension inventory module                                                 |
| `bookmarks.json`     | Bookmark collection module                                                 |
| `tabs.json`          | Tab-group metadata and member tabs needed to restore each group; no standalone tabs or window snapshots |

Metadata and schema information stay in separate files rather than being mixed into synchronized data. New syncs do not create application-managed history indexes or copy previous module files into cloud archives. Recognized app-managed history indexes and their indexed archives—including legacy single-file WebDAV entries—are removed on the next successful sync; provider-native revision mechanisms are left untouched.

Because only the modules whose data actually changed are uploaded, a bookmark edit re-writes `bookmarks.json` and the two control files while `extensions.json` and `tabs.json` stay byte-identical and keep their own module revision. Merging and conflict detection are module-scoped as well: a conflict is attributed to the module that owns it.

Settings → **Local** shows this layout live: the active layout, schema and storage-format versions, and every module file with its revision, deletion count, and checksum.

#### Upgrading from `current.json`

Existing cloud data is migrated automatically and non-destructively:

1. A remote that still holds `current.json` (or the older `chromium-cloud-sync.json`) is detected on the next read.
2. The legacy payload is validated, then split into the module files above, carrying its revision forward so module revisions stay continuous.
3. The migration is recorded in `meta.json` and `manifest.json` with the new storage layout and format version.
4. The legacy `current.json` is **kept** as a read-only archive — it is never deleted or reset by the migration, so the previous data remains recoverable.
5. If a device that has not upgraded yet writes a newer `current.json` afterwards, that newer payload wins and the migration record is re-created against it.
6. An incomplete module set is reported as an explicit error instead of being presented as a valid partial state.

Popup restore, cloud tab management, and history keep reading one coherent overall synchronization state — the split is a storage detail, not a user-facing concept.

<a name="readme-sync-model"></a>

## <img src="assets/readme/icons/architecture.svg" width="24" height="24" alt=""> Sync model

Chromium Cloud Sync uses a **local-first three-way merge** rather than a simple latest-device-wins strategy.

```text
              Local base snapshot
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
       Current local        Current remote
             │                   │
             └─────────┬─────────┘
                       ▼
                Three-way merge
                 ┌─────┴─────┐
                 ▼           ▼
          auto-resolve    conflict
                 │           │
                 └─────┬─────┘
                       ▼
                New revision
```

The merge engine uses field-specific policies, including latest-value resolution for ordinary metadata, version comparison for extension versions, and manual conflicts when fields such as URLs are independently changed. Deletions are represented by tombstones.

The current cloud schema is **v11**, with migration support for schemas **7, 8, 9, 10 and 11**.

<a name="readme-data-scope"></a>

## <img src="assets/readme/icons/features.svg" width="24" height="24" alt=""> Data scope

### Synchronized

```text
Tab groups and their HTTP(S) member tabs
Bookmarks
Third-party extension metadata
```

### Explicitly outside the sync snapshot

```text
Third-party extension private storage / settings
Browser passwords
Authentication credentials
Unrelated extension-private data
Browser-level settings
```

Third-party extension settings are intentionally excluded because a generic Chromium extension cannot safely read or write another extension's private storage.

<a name="readme-extension-recovery"></a>

## <img src="assets/readme/icons/features.svg" width="24" height="24" alt=""> Extension recovery

The extension inventory stores enough metadata to identify missing third-party extensions. The **Extension Recovery Center** can show extensions present in the cloud inventory but absent locally and provide direct store links when available.

When an official store link is unavailable or unsuitable for the current browser, the recovery flow can expose a third-party download/search path with an explicit warning. Installation remains an explicit browser action.

<a name="readme-package-backup"></a>

## <img src="assets/readme/icons/features.svg" width="24" height="24" alt=""> Third-party extension package backup

Package backup is deliberately separated from browser-state synchronization, and its backend is chosen independently of the sync provider.

```text
Browser state  →  selected cloud sync provider (Gist / Google Drive / WebDAV)
CRX / ZIP      →  GitHub private repository OR WebDAV OR Google Drive
```

You can back up packages to Google Drive while synchronizing browser state through GitHub Gist, or any other combination — selecting a package backend never changes the sync provider.

### Choosing what to back up

The extension list is opt-in: nothing is selected by default, so a partial backup is the normal case rather than the exception. Search filters by name or ID, **Select all** / **Clear all** / **Invert** act on what is currently visible, and every change saves itself — locally and into the destination's `selection.json` — without a separate save step. Each row shows the extension's version, install type, ID, whether the cloud already holds a backup, and whether files for it were found on this machine.

### Backing up from local files

Chromium will not let one extension read another extension's installed files, but those files are already on disk. **Back up from a local folder** asks for one directory and then does the rest:

1. Pick the browser user-data directory (the one containing `Extensions`), a single `Extensions` directory, or an unpacked extension's source directory. `chrome://version` shows the exact profile path; typical locations are `%LOCALAPPDATA%\Google\Chrome\User Data` on Windows, `~/Library/Application Support/Google/Chrome` on macOS, `~/.config/google-chrome` on Linux, with `Chrome` replaced by `Microsoft/Edge` for Edge.
2. The folder is scanned and every extension whose files were found is offered in a preview dialog, with the identity it was matched by (extension ID directory, or a `manifest.json` name and version), the file count and size, and the cloud state. Extensions that are no longer installed are offered separately and are opt-in.
3. Confirming packages each selected extension into a ZIP of its unpacked files and uploads it under its own extension ID and version. Packages are deterministic, so re-running the same backup re-uses the stored object instead of uploading identical bytes twice.

The folder is remembered (through IndexedDB, re-authorized on demand), so a repeat backup is one click; **Change folder** picks a different one. **Upload several CRX / ZIP…** and dropping files onto the list remain available for packages you already have — each archive identifies its own extension (a CRX carries its ID, a ZIP carries its manifest), and anything that cannot be identified is reported instead of being filed under a guessed ID.

A ZIP built from local unpacked files restores through **Load unpacked** and receives a new extension ID, because Chromium derives an unpacked extension's ID from its path. Reinstalling from the store keeps the original ID and is preferred when the extension is still published; the local package remains the fallback for extensions that are not.

### Google Drive package backup

Packages are uploaded to an application-managed Drive folder, `Chromium Cloud Sync Packages`, which is deliberately **not** the synchronization folder, so package data can never be mixed into the browser-state payload. An optional subfolder organizes backups further.

- The Drive session authorized in sync settings is reused; there is no second authorization mechanism and no separate credential entry. Settings shows which Google account the package backup will use, and says so explicitly when Drive is not connected yet.
- Uploads use the resumable protocol with the content length declared up front, so large CRX/ZIP files stream instead of being base64-encoded and so quota exhaustion is reported before the bytes move.
- The package index (`index.json`), selection state (`selection.json`), and per-package metadata sidecars live inside the package destination, separate from the sync module files.
- Each backup record stores the filename, extension ID, extension version, source information (Chrome Web Store, Edge Add-ons, self-hosted update URL, unpacked, side-loaded, or policy), timestamp, size, and SHA-256 checksum, plus the backend that stored it.
- Backups are reconciled against provider listings, not only the index: GitHub's file tree, WebDAV `PROPFIND`, and the Drive folder walk surface packages uploaded from another profile or left behind by an interrupted index write (marked as unindexed). Index entries whose files have disappeared are reported as missing and cannot be downloaded.
- Duplicate names and versions never silently overwrite an unrelated backup. When the same name and version already hold different bytes, the checksum prefix is folded into the file name so both packages survive; re-uploading identical bytes updates the existing entry instead of growing the index.
- Restore uses the existing package recovery flow — download streams the file back from Drive into the usual save dialog.
- Drive-specific failures are classified and surfaced distinctly in the package-backup UI: storage quota, rate limiting, expired authorization, insufficient permissions, missing files, upload size limits, and temporary Drive outages each produce their own message rather than a bare HTTP status.

The package subsystem keeps an index, selection state, package metadata, and SHA-256 checksums for every backend. The index retains every package record so no cloud binary becomes unreachable because of a metadata cap. Re-uploading the same extension ID, version, and checksum reuses its existing file path instead of creating another copy. The GitHub Contents API path rejects files larger than **95 MiB**; Drive and WebDAV stream the bytes and are bounded by the provider instead.

Chromium exposes extension IDs and metadata through `chrome.management`, and the user supplies the package bytes — either by pointing the extension at a local folder, or by selecting CRX/ZIP files directly. Restore downloads the archive for the user to install through the browser. Deselecting or uninstalling an extension does not silently delete its backups. Because the selection now saves itself, use **Clean up unused backups** to review and permanently remove packages for unselected extension IDs (including older versions) whenever the list changes. Provider listings also let cleanup find unindexed files left by interrupted uploads. The index and metadata sidecars are updated after cleanup.

<a name="readme-security"></a>

## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Privacy & security

New GitHub synchronization Gists are created as **private Gists**. The current synchronization payload is stored as normal JSON and is **not end-to-end encrypted**. Access to a configured sync backend can therefore expose the synchronized browser state.

For Google Drive, OAuth credentials are stored in `chrome.storage.local` and the implementation requests the `drive.file` scope. For WebDAV, the configured credentials are stored locally and requests use HTTP Basic Authentication.

The repository still contains compatibility handling for older encrypted synchronization data, but that is a migration path rather than the format used for new synchronization state.

Use least-privilege credentials. Package-backup credentials are separate from the main sync provider configuration and remain local to the browser.

<a name="readme-installation"></a>

## <img src="assets/readme/icons/installation.svg" width="24" height="24" alt=""> Installation

Open [Releases](https://github.com/CYoJkoY/ChromiumCloudSync/releases) and download the latest ZIP or CRX.

For the ZIP:

1. Extract the archive.
2. Open `chrome://extensions` or your browser's equivalent extension page.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted directory.

The release workflow validates the version, runs tests and a Chromium smoke test, builds the ZIP, verifies its contents, creates a signed CRX3, generates SHA-256 checksums, and publishes all release artifacts.

### Initial configuration

Open **Settings** and configure the provider you want to use:

1. **GitHub Gist** — enter and validate a GitHub Token, then create or bind a private sync Gist.
2. **Google Drive** — configure a Google OAuth Web application client and register the exact `chrome.identity.getRedirectURL()` value shown in the extension's Google Drive OAuth settings; configure its Client ID through the release variable or the advanced OAuth settings.
3. **WebDAV** — enter the server URL and optional remote folder, credentials, then test the connection.
4. Run **Sync now** once.
5. Enable automatic synchronization when required.

<a name="readme-usage"></a>

## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Usage

The popup provides the operational status of the connection and synchronization state, including provider binding, last sync time, revision, conflict count, and automatic-sync state.

Automatic synchronization is **off by default** and uses **5 minutes** as its default interval. Available intervals are 5, 10, 15, 30, and 60 minutes.

<a name="readme-history"></a>

## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> History & rollback

- GitHub Gist retains its provider-native revision/commit history.
- Google Drive and WebDAV no longer create application-managed cloud snapshots or a `history/index.json` archive during normal sync.
- Google Drive may retain revisions according to Google's own Drive revision policy; the extension does not create extra history copies.

The extension no longer provides app-managed rollback snapshots for Drive/WebDAV. Recognized legacy app-managed archives are cleaned up after the next successful sync; Gist's provider-native history is unaffected.

<a name="readme-architecture"></a>

## <img src="assets/readme/icons/architecture.svg" width="24" height="24" alt=""> Architecture

```text
Chromium Cloud Sync
├── runtime/
│   ├── background.ts            orchestration + provider dispatch
│   ├── browser-capabilities.ts
│   ├── cloud-tab-state.ts       canonical cloud-tab projection
│   ├── diagnostics.ts
│   ├── legacy-crypto.ts
│   ├── schema.ts                validation + version migration
│   ├── storage.ts               serialized local mutations
│   ├── sync-core.ts             per-module merge, tombstones, checksums
│   ├── sync-modules.ts          modular storage domain (split/combine/migrate)
│   └── types.ts
├── cloud providers/
│   ├── cloud-files.ts           provider-agnostic FileStore protocol
│   ├── cloud-gist.ts            GitHub Gist transport
│   ├── cloud-gdrive.ts          Google Drive transport
│   └── cloud-webdav.ts          WebDAV transport
├── features/
│   ├── extension-storage.ts    package-backup UI + GitHub/WebDAV/Drive transports
│   ├── extension-local-source.ts  local folder scanning, ZIP packaging, archive identity
│   ├── extension-storage-watch.ts
│   └── update.ts
└── ui/
    ├── popup / options / guide / history / extensions
    ├── i18n.ts
    ├── theme.ts
    └── styles/
```

The runtime layer coordinates browser APIs, local storage, provider dispatch, diagnostics, schema migration, and synchronization. `sync-core.ts` contains per-module merge and tombstone logic; `sync-modules.ts` owns the modular storage layout (module split/combine, per-module revisions and change detection, legacy migration); `schema.ts` validates and migrates cloud state.

`cloud-files.ts` defines one provider-agnostic file protocol — read, write, remove, list, and history — and each provider module implements only file placement, transport, and its native history model. Adding a provider therefore does not require touching merge, migration, or history semantics, and no provider needs to know how another one stores files. The UI layer provides the operational surfaces.

<a name="readme-development"></a>

## <img src="assets/readme/icons/development.svg" width="24" height="24" alt=""> Development

### Requirements

- Node.js 24
- npm
- TypeScript
- Playwright with Chromium

Runtime source is maintained in TypeScript. The release workflow rejects tracked `.js` source files and generates JavaScript during the build.

### Common commands

```bash
npm install
npm run typecheck
npm test
npm run validate
npm run build:zip
npm run smoke
```

### Release workflow

```text
Git tag
   │
   ├─ version validation
   ├─ TypeScript validation
   ├─ unit / invariant / schema / storage tests
   ├─ Playwright browser smoke test
   ├─ ZIP build
   ├─ ZIP contents verification
   ├─ signed CRX3 build
   ├─ SHA-256 checksums
   └─ GitHub Release
```

Stable tags use `vX.Y.Z` and are published as normal GitHub Releases. ChromiumCloudSync uses a single stable release channel; `version_name`, `.devN` tags, and pre-releases are not used.

#### Configuring the CRX signing key

The Release workflow expects a repository secret named `CRX_PRIVATE_KEY_B64`. It now accepts either a raw PEM private key or a Base64-encoded PEM. A key generated with `openssl genpkey` (PKCS#8, `BEGIN PRIVATE KEY`) is supported; the workflow validates the RSA key and normalizes it before signing. Keep using the **same private key for every release** because replacing it changes the CRX's signing identity.

Recommended Base64 setup on Windows PowerShell:

```powershell
# Encode the complete PEM file as one Base64 line and copy it to the clipboard.
$privateKeyPath = (Resolve-Path .\private.pem).Path
[Convert]::ToBase64String([IO.File]::ReadAllBytes($privateKeyPath)) | Set-Clipboard
```

On Linux, macOS, or Git Bash, print a single-line Base64 value with:

```bash
base64 < private.pem | tr -d '\n'
```

Then open **Settings → Secrets and variables → Actions → Repository secrets → New repository secret**, name it `CRX_PRIVATE_KEY_B64`, and paste the copied one-line value. Do not include surrounding quotes, command output labels, or the PEM header/footer in addition to the Base64 value. Alternatively, paste the complete multi-line PEM content directly as the secret value; the updated workflow detects that form automatically.

The release workflow reports a specific decoding or key-validation error if the secret is malformed; it never prints the private key to the job log. Never commit `private.pem` to the repository or send it in an issue.

<a name="readme-status"></a>

## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Project status & roadmap

The current core is browser-state synchronization, extension inventory/recovery, and separate package backup through a pluggable cloud-provider layer.

Current providers are GitHub Gist, Google Drive, and WebDAV.

Future work is expected to expand browser-state coverage carefully. **Extension settings** and **browser settings** are roadmap items, not synchronized data in the current release.

<a name="readme-support"></a>

## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Support

Support helps fund compatibility testing, synchronization reliability work, documentation, and continued maintenance.

[Open the Chromium Cloud Sync support page](https://cyojkoy.github.io/Payment/)

<a href="https://cyojkoy.github.io/Payment/"><img src="assets/readme/support-cta.svg" alt="Support Chromium Cloud Sync through the maintainer's Payment page" width="100%"></a>

Use [GitHub Issues](https://github.com/CYoJkoY/ChromiumCloudSync/issues) for bugs, compatibility problems, synchronization conflicts, schema issues, and feature requests.

Never include GitHub Tokens, private credentials, or sensitive Gist contents in an issue.

<a name="readme-license"></a>

## <img src="assets/readme/icons/development.svg" width="24" height="24" alt=""> License

Chromium Cloud Sync is released under the **MIT License**. See [`LICENSE`](LICENSE) for the full license text.

<div align="center">

[![GitHub](https://img.shields.io/badge/GitHub-CYoJkoY%2FChromiumCloudSync-181717?style=flat-square&logo=github)](https://github.com/CYoJkoY/ChromiumCloudSync)

</div>
