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

The current implementation covers open windows and HTTP(S) tabs, tab groups, bookmarks, and installed third-party extension metadata. It also provides extension recovery and a separate CRX/ZIP package-backup path.

<a name="readme-features"></a>

## <img src="assets/readme/icons/features.svg" width="24" height="24" alt=""> Features

| Capability                    | Description                                                                                                           |
| :---------------------------- | :-------------------------------------------------------------------------------------------------------------------- |
| **Tabs & windows**            | Sync normal windows and HTTP(S) tabs, including title, URL, pinning, active state, order, and group information.      |
| **Tab groups**                | Preserve stable group identity, title, color, collapsed state, and group membership.                                 |
| **Bookmarks**                 | Sync bookmark titles, URLs, parent relationships, order, and stable IDs.                                              |
| **Extension inventory**       | Track third-party extension ID, name, version, enabled state, installation type, update information, and store links. |
| **Extension Recovery Center** | Detect missing extensions and surface available Chrome Web Store, Edge Add-ons, or compatible recovery links.          |
| **Three-way merge**           | Merge base, local, and remote snapshots instead of blindly replacing one side.                                        |
| **Deletion tombstones**       | Preserve deletions so stale devices do not silently recreate removed items.                                           |
| **Conflict visibility**       | Keep unresolved field conflicts explicit for review.                                                                  |
| **Provider-independent sync** | Run manual and automatic synchronization through the selected cloud provider.                                          |
| **Automatic sync**            | Optional background synchronization with configurable intervals; disabled by default.                                 |
| **History & rollback**        | Use provider-native history plus a local index of up to 30 recent entries where supported.                            |
| **Package backup**            | Store selected CRX/ZIP packages separately in a GitHub private repository or WebDAV.                                  |
| **Bilingual UI**              | English and Simplified Chinese interfaces.                                                                            |
| **Theme controls**            | Explicit theme controls for settings and auxiliary pages.                                                             |

<a name="readme-providers"></a>

## <img src="assets/readme/icons/features.svg" width="24" height="24" alt=""> Cloud providers

The synchronization engine is separated from the storage backend. Choose the provider that fits the environment:

| Provider         | What it stores                  | Authentication / access                                  | History source                  |
| :--------------- | :------------------------------ | :------------------------------------------------------- | :------------------------------ |
| **GitHub Gist**  | \`current.json\` and sync metadata | GitHub Token + private Gist                              | Gist revision / commit history  |
| **Google Drive** | One application-created JSON file | User-supplied OAuth Client ID via Chromium Identity API | Google Drive file revisions     |
| **WebDAV**       | \`current.json\` + optional history index | WebDAV URL, optional folder, username and password/app auth | \`history/index.json\`, up to 30 entries |

For GitHub Gist, the extension creates or binds a private Gist. Google Drive uses the \`drive.file\` scope and stores its OAuth credentials locally. WebDAV requests require the user to grant access to the configured server origin.

<a name="readme-sync-model"></a>

## <img src="assets/readme/icons/architecture.svg" width="24" height="24" alt=""> Sync model

Chromium Cloud Sync uses a **local-first three-way merge** rather than a simple latest-device-wins strategy.

\`\`\`text
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
\`\`\`

The merge engine uses field-specific policies, including latest-value resolution for ordinary metadata, version comparison for extension versions, and manual conflicts when fields such as URLs are independently changed. Deletions are represented by tombstones.

The current cloud schema is **v11**, with migration support for schemas **7, 8, 9, 10 and 11**.

<a name="readme-data-scope"></a>

## <img src="assets/readme/icons/features.svg" width="24" height="24" alt=""> Data scope

### Synchronized

\`\`\`text
Open windows
HTTP(S) tabs
Tab groups
Bookmarks
Third-party extension metadata
\`\`\`

### Explicitly outside the sync snapshot

\`\`\`text
Third-party extension private storage / settings
Browser passwords
Authentication credentials
Unrelated extension-private data
Browser-level settings
\`\`\`

Third-party extension settings are intentionally excluded because a generic Chromium extension cannot safely read or write another extension's private storage.

<a name="readme-extension-recovery"></a>

## <img src="assets/readme/icons/features.svg" width="24" height="24" alt=""> Extension recovery

The extension inventory stores enough metadata to identify missing third-party extensions. The **Extension Recovery Center** can show extensions present in the cloud inventory but absent locally and provide direct store links when available.

When an official store link is unavailable or unsuitable for the current browser, the recovery flow can expose a third-party download/search path with an explicit warning. Installation remains an explicit browser action.

<a name="readme-package-backup"></a>

## <img src="assets/readme/icons/features.svg" width="24" height="24" alt=""> Third-party extension package backup

Package backup is deliberately separated from browser-state synchronization.

\`\`\`text
Browser state  →  selected cloud sync provider
CRX / ZIP      →  GitHub private repository OR WebDAV
\`\`\`

The package subsystem keeps an index, selection state, package metadata, and SHA-256 checksums. The current GitHub Contents API path rejects files larger than **95 MiB**. The first backup requires manual selection of a CRX or ZIP because another extension's installed package bytes are not directly exposed to the extension.

<a name="readme-security"></a>

## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Privacy & security

New GitHub synchronization Gists are created as **private Gists**. The current synchronization payload is stored as normal JSON and is **not end-to-end encrypted**. Access to a configured sync backend can therefore expose the synchronized browser state.

For Google Drive, OAuth credentials are stored in \`chrome.storage.local\` and the implementation requests the \`drive.file\` scope. For WebDAV, the configured credentials are stored locally and requests use HTTP Basic Authentication.

The repository still contains compatibility handling for older encrypted synchronization data, but that is a migration path rather than the format used for new synchronization state.

Use least-privilege credentials. Package-backup credentials are separate from the main sync provider configuration and remain local to the browser.

<a name="readme-installation"></a>

## <img src="assets/readme/icons/installation.svg" width="24" height="24" alt=""> Installation

Open [Releases](https://github.com/CYoJkoY/ChromiumCloudSync/releases) and download the latest ZIP or CRX.

For the ZIP:

1. Extract the archive.
2. Open \`chrome://extensions\` or your browser's equivalent extension page.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted directory.

The release workflow validates the version, runs tests and a Chromium smoke test, builds the ZIP, verifies its contents, creates a signed CRX3, generates SHA-256 checksums, and publishes all release artifacts.

### Initial configuration

Open **Settings** and configure the provider you want to use:

1. **GitHub Gist** — enter and validate a GitHub Token, then create or bind a private sync Gist.
2. **Google Drive** — enter your OAuth Client ID and complete the browser authorization flow.
3. **WebDAV** — enter the server URL and optional remote folder, credentials, then test the connection.
4. Run **Sync now** once.
5. Enable automatic synchronization when required.

<a name="readme-usage"></a>

## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Usage

The popup provides the operational status of the connection and synchronization state, including provider binding, last sync time, revision, conflict count, and automatic-sync state.

Automatic synchronization is **off by default** and uses **5 minutes** as its default interval. Available intervals are 5, 10, 15, 30, and 60 minutes.

<a name="readme-history"></a>

## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> History & rollback

History is sourced from the active provider:

- GitHub Gist uses Gist revision/commit history.
- Google Drive uses file revisions.
- WebDAV maintains a \`history/index.json\` with up to 30 archived entries.

Rolling back creates a new current revision rather than destroying historical state.

<a name="readme-architecture"></a>

## <img src="assets/readme/icons/architecture.svg" width="24" height="24" alt=""> Architecture

\`\`\`text
Chromium Cloud Sync
├── runtime/
│   ├── background.ts
│   ├── browser-capabilities.ts
│   ├── diagnostics.ts
│   ├── legacy-crypto.ts
│   ├── schema.ts
│   ├── storage.ts
│   ├── sync-core.ts
│   └── types.ts
├── cloud providers/
│   ├── cloud-gdrive.ts
│   └── cloud-webdav.ts
├── features/
│   ├── extension-storage.ts
│   ├── extension-storage-watch.ts
│   └── update.ts
└── ui/
    ├── popup / options / guide / history / extensions
    ├── i18n.ts
    ├── theme.ts
    └── styles/
\`\`\`

The runtime layer coordinates browser APIs, local storage, provider dispatch, GitHub, diagnostics, schema migration, and synchronization. \`sync-core.ts\` contains merge and tombstone logic; \`schema.ts\` validates and migrates cloud state; the provider layer keeps storage-specific operations out of the merge engine; the UI layer provides the operational surfaces.

<a name="readme-development"></a>

## <img src="assets/readme/icons/development.svg" width="24" height="24" alt=""> Development

### Requirements

- Node.js 24
- npm
- TypeScript
- Playwright with Chromium

Runtime source is maintained in TypeScript. The release workflow rejects tracked \`.js\` source files and generates JavaScript during the build.

### Common commands

\`\`\`bash
npm install
npm run typecheck
npm test
npm run validate
npm run build:zip
npm run smoke
\`\`\`

### Release workflow

\`\`\`text
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
\`\`\`

Stable tags use \`vX.Y.Z\`. Development tags use \`vX.Y.Z.devN\` and are published as prereleases.

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

Chromium Cloud Sync is released under the **MIT License**. See [\`LICENSE\`](LICENSE) for the full license text.

<div align="center">

[![GitHub](https://img.shields.io/badge/GitHub-CYoJkoY%2FChromiumCloudSync-181717?style=flat-square&logo=github)](https://github.com/CYoJkoY/ChromiumCloudSync)

</div>
