<div align="center">

<img src="assets/readme/hero-v2.svg" alt="Chromium Cloud Sync — synchronize Chromium browser state through a private GitHub Gist" width="100%">

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
  <a href="#readme-sync-model">Sync model</a> ·
  <a href="#readme-installation">Installation</a> ·
  <a href="#readme-development">Development</a>
</p>

</div>

---

<a name="readme-overview"></a>
## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Overview

**Chromium Cloud Sync** is a Manifest V3 browser extension that synchronizes Chromium browser state through a **private GitHub Gist**, without relying on a browser vendor's built-in sync service.

The current implementation covers open windows and HTTP(S) tabs, tab groups, bookmarks, and installed third-party extension metadata. It also provides extension recovery and a separate CRX/ZIP package-backup path. fileciteturn32file0

The repository is currently on the `1.8.x` release line, with `1.8.1` in `manifest.json` and development builds represented by `version_name`. fileciteturn18file0

<a name="readme-features"></a>
## <img src="assets/readme/icons/features.svg" width="24" height="24" alt=""> Features

| Capability | Description |
| :--- | :--- |
| **Tabs & windows** | Sync normal windows and HTTP(S) tabs, including title, URL, pinning, active state, order, and group information. |
| **Tab groups** | Preserve stable group identity, title, color, and collapsed state. |
| **Bookmarks** | Sync bookmark titles, URLs, parent relationships, order, and stable IDs. |
| **Extension inventory** | Track third-party extension ID, name, version, enabled state, installation type, update information, and store links. |
| **Extension Recovery Center** | Detect missing extensions and surface available Chrome Web Store or Edge Add-ons installation links. |
| **Three-way merge** | Merge base, local, and remote snapshots instead of blindly replacing one side. |
| **Deletion tombstones** | Preserve deletions so stale devices do not silently recreate removed items. |
| **Conflict visibility** | Keep unresolved field conflicts explicit for review. |
| **Automatic sync** | Optional background synchronization with configurable intervals; disabled by default. |
| **History & rollback** | Use Gist revision history and maintain a local index of up to 30 recent entries. |
| **Package backup** | Store selected CRX/ZIP packages separately in a GitHub private repository or WebDAV. |
| **Bilingual UI** | English and Simplified Chinese interfaces. |
| **Light / dark themes** | Explicit theme controls for settings and auxiliary pages. |

Stable synchronization IDs are maintained for tabs, windows, tab groups, and bookmarks. Extension inventory is collected through the Chromium management API. fileciteturn33file0

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

The merge engine has field-specific policies, including latest-value resolution for ordinary metadata, version comparison for extension versions, and manual conflicts for fields such as URLs when both sides changed independently. Deletions are represented by tombstones. fileciteturn27file0

The current cloud schema is **v10**, with migration support for schemas **7, 8, 9, and 10**. fileciteturn28file0

<a name="readme-data-scope"></a>
## <img src="assets/readme/icons/features.svg" width="24" height="24" alt=""> Data scope

### Synchronized

```text
Open windows
HTTP(S) tabs
Tab groups
Bookmarks
Third-party extension metadata
```

### Explicitly outside the sync snapshot

```text
Third-party extension private storage / settings
Browser passwords
Authentication credentials
Unrelated extension-private data
```

Third-party extension settings are intentionally excluded because a generic Chromium extension cannot safely read or write another extension's private storage. Browser-level settings are also **not part of the current synchronization snapshot**. fileciteturn48file0

<a name="readme-extension-recovery"></a>
## <img src="assets/readme/icons/features.svg" width="24" height="24" alt=""> Extension recovery

The extension inventory stores enough metadata to identify missing third-party extensions. The **Extension Recovery Center** can show extensions present in the cloud inventory but absent locally and provide direct store links when Chrome Web Store or Microsoft Edge Add-ons information is available. Installation remains an explicit browser action. fileciteturn33file0 fileciteturn48file0

<a name="readme-package-backup"></a>
## <img src="assets/readme/icons/features.svg" width="24" height="24" alt=""> Third-party extension package backup

Package backup is deliberately separated from browser-state synchronization.

```text
Browser state  →  private GitHub Gist
CRX / ZIP      →  GitHub private repository OR WebDAV
```

The package subsystem keeps an index, selection state, package metadata, and SHA-256 checksums. The current GitHub Contents API path rejects files larger than **95 MiB**. The first backup requires manual selection of a CRX or ZIP because another extension's installed package bytes are not directly exposed to the extension. fileciteturn31file0

<a name="readme-security"></a>
## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Privacy & security

New synchronization Gists are created as **private Gists**. The current synchronization payload is stored as normal JSON in `current.json`; it is **not end-to-end encrypted**. Access to the private Gist therefore grants access to the synchronized browser state. fileciteturn33file0 fileciteturn47file0

The repository still contains compatibility handling for older encrypted synchronization data, but that is a migration path rather than the format used for new synchronization state. fileciteturn29file0

Use least-privilege credentials. Package-backup credentials are separate from the main Gist token and remain local to the browser. fileciteturn31file0

<a name="readme-installation"></a>
## <img src="assets/readme/icons/installation.svg" width="24" height="24" alt=""> Installation

### Release package

Open [Releases](https://github.com/CYoJkoY/ChromiumCloudSync/releases) and download the latest ZIP or CRX.

For the ZIP:

1. Extract the archive.
2. Open `chrome://extensions` or your browser's equivalent extension page.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the extracted directory.

The release workflow validates the version, runs tests and a Chromium smoke test, builds the ZIP, verifies its contents, creates a signed CRX3, generates SHA-256 checksums, and publishes all release artifacts. fileciteturn25file0

### Initial configuration

Open **Settings** and:

1. Enter and validate a GitHub Token with Gist access.
2. Create a private sync Gist or bind an existing one.
3. Run **Sync now** once.
4. Enable automatic synchronization when required.

The settings UI separates **Sync**, **Third-party extensions**, and **Local** panels and also exposes dedicated **Sync history** and **User guide** pages. fileciteturn36file0

<a name="readme-usage"></a>
## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Usage

The popup provides the operational status of the connection and synchronization state, including Gist binding, last sync time, revision, conflict count, and automatic-sync state. fileciteturn34file0

Automatic synchronization is **off by default** and uses **5 minutes** as its default interval. The available intervals are 5, 10, 15, 30, and 60 minutes. fileciteturn33file0

<a name="readme-history"></a>
## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> History & rollback

GitHub Gist supplies remote revision history while the extension keeps a local index of up to **30 recent entries**. Rolling back creates a new current revision rather than destroying the historical state. fileciteturn27file0 fileciteturn48file0

<a name="readme-architecture"></a>
## <img src="assets/readme/icons/architecture.svg" width="24" height="24" alt=""> Architecture

```text
Chromium extension
├── runtime/
│   ├── background.ts
│   ├── browser-capabilities.ts
│   ├── diagnostics.ts
│   ├── legacy-crypto.ts
│   ├── schema.ts
│   ├── storage.ts
│   ├── sync-core.ts
│   └── types.ts
├── features/
│   ├── extension-storage.ts
│   ├── extension-storage-watch.ts
│   └── update.ts
└── ui/
    ├── popup / options / guide / history / extensions
    ├── i18n.ts
    ├── theme.ts
    └── styles/
```

The runtime layer coordinates browser APIs, local storage, GitHub, diagnostics, schema migration, and synchronization. `sync-core.ts` contains merge and tombstone logic; `schema.ts` validates and migrates cloud state; the UI layer provides the operational surfaces. fileciteturn15file0 fileciteturn17file0 fileciteturn19file0

<a name="readme-development"></a>
## <img src="assets/readme/icons/development.svg" width="24" height="24" alt=""> Development

### Requirements

- Node.js 24
- npm
- TypeScript
- Playwright with Chromium

Runtime source is maintained in TypeScript. The release workflow explicitly rejects tracked `.js` source files and generates JavaScript during the build. fileciteturn25file0

### Common commands

```bash
npm install
npm run typecheck
npm test
npm run validate
npm run build:zip
npm run smoke
```

The repository's validation pipeline includes version synchronization, type checking, unit/invariant/schema/storage tests, generated-extension validation, auditing, and browser smoke testing. fileciteturn26file0 fileciteturn25file0

<a name="readme-status"></a>
## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Project status & roadmap

The current core is browser-state synchronization plus extension inventory/recovery and separate package backup.

Future work is expected to expand browser-state coverage carefully. **Extension settings** and **browser settings** are roadmap items, not synchronized data in the current release.

<a name="readme-support"></a>
## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Support & feedback

Use [GitHub Issues](https://github.com/CYoJkoY/ChromiumCloudSync/issues) for bugs, compatibility problems, synchronization conflicts, schema issues, and feature requests.

Never include GitHub Tokens, private credentials, or sensitive Gist contents in an issue.

<a name="readme-license"></a>
## <img src="assets/readme/icons/development.svg" width="24" height="24" alt=""> License

Chromium Cloud Sync is released under the **MIT License**. See [`LICENSE`](LICENSE) for the full license text.

<div align="center">

[![GitHub](https://img.shields.io/badge/GitHub-CYoJkoY%2FChromiumCloudSync-181717?style=flat-square&logo=github)](https://github.com/CYoJkoY/ChromiumCloudSync)

</div>