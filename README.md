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
  <a href="#readme-sponsorship">Sponsorship</a> ·
  <a href="#readme-development">Development</a>
</p>

</div>

---

<a name="readme-overview"></a>
## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Overview

**Chromium Cloud Sync** is a Manifest V3 browser extension that synchronizes Chromium browser state through a **private GitHub Gist**, without relying on a browser vendor's built-in sync service.

The current implementation covers open windows and HTTP(S) tabs, tab groups, bookmarks, and installed third-party extension metadata. It also provides extension recovery and a separate CRX/ZIP package-backup path.

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

The current cloud schema is **v10**, with migration support for schemas **7, 8, 9, and 10**.

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
Browser-level settings
```

Third-party extension settings are intentionally excluded because a generic Chromium extension cannot safely read or write another extension's private storage.

<a name="readme-extension-recovery"></a>
## <img src="assets/readme/icons/features.svg" width="24" height="24" alt=""> Extension recovery

The extension inventory stores enough metadata to identify missing third-party extensions. The **Extension Recovery Center** can show extensions present in the cloud inventory but absent locally and provide direct store links when available. Installation remains an explicit browser action.

<a name="readme-package-backup"></a>
## <img src="assets/readme/icons/features.svg" width="24" height="24" alt=""> Third-party extension package backup

Package backup is deliberately separated from browser-state synchronization.

```text
Browser state  →  private GitHub Gist
CRX / ZIP      →  GitHub private repository OR WebDAV
```

The package subsystem keeps an index, selection state, package metadata, and SHA-256 checksums. The current GitHub Contents API path rejects files larger than **95 MiB**. The first backup requires manual selection of a CRX or ZIP because another extension's installed package bytes are not directly exposed to the extension.

<a name="readme-security"></a>
## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Privacy & security

New synchronization Gists are created as **private Gists**. The current synchronization payload is stored as normal JSON in `current.json`; it is **not end-to-end encrypted**. Access to the private Gist therefore grants access to the synchronized browser state.

The repository still contains compatibility handling for older encrypted synchronization data, but that is a migration path rather than the format used for new synchronization state.

Use least-privilege credentials. Package-backup credentials are separate from the main Gist token and remain local to the browser.

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

Open **Settings** and:

1. Enter and validate a GitHub Token with Gist access.
2. Create a private sync Gist or bind an existing one.
3. Run **Sync now** once.
4. Enable automatic synchronization when required.

<a name="readme-usage"></a>
## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Usage

The popup provides the operational status of the connection and synchronization state, including Gist binding, last sync time, revision, conflict count, and automatic-sync state.

Automatic synchronization is **off by default** and uses **5 minutes** as its default interval. Available intervals are 5, 10, 15, 30, and 60 minutes.

<a name="readme-history"></a>
## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> History & rollback

GitHub Gist supplies remote revision history while the extension keeps a local index of up to **30 recent entries**. Rolling back creates a new current revision rather than destroying historical state.

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

The runtime layer coordinates browser APIs, local storage, GitHub, diagnostics, schema migration, and synchronization. `sync-core.ts` contains merge and tombstone logic; `schema.ts` validates and migrates cloud state; the UI layer provides the operational surfaces.

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

Stable tags use `vX.Y.Z`. Development tags use `vX.Y.Z.devN` and are published as prereleases.

<a name="readme-status"></a>
## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Project status & roadmap

The current core is browser-state synchronization plus extension inventory/recovery and separate package backup.

Future work is expected to expand browser-state coverage carefully. **Extension settings** and **browser settings** are roadmap items, not synchronized data in the current release.

<a name="readme-support"></a>
## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Support & feedback

Use [GitHub Issues](https://github.com/CYoJkoY/ChromiumCloudSync/issues) for bugs, compatibility problems, synchronization conflicts, schema issues, and feature requests.

Never include GitHub Tokens, private credentials, or sensitive Gist contents in an issue.

<a name="readme-sponsorship"></a>
## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Sponsorship

<a href="https://github.com/sponsors/CYoJkoY"><img src="assets/readme/support-cta.svg" alt="Support Chromium Cloud Sync" width="100%"></a>

Support helps fund compatibility testing, synchronization reliability work, documentation, and continued maintenance.

<a name="readme-license"></a>
## <img src="assets/readme/icons/development.svg" width="24" height="24" alt=""> License

Chromium Cloud Sync is released under the **MIT License**. See [`LICENSE`](LICENSE) for the full license text.

<div align="center">

[![GitHub](https://img.shields.io/badge/GitHub-CYoJkoY%2FChromiumCloudSync-181717?style=flat-square&logo=github)](https://github.com/CYoJkoY/ChromiumCloudSync)

</div>
