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

**Chromium Cloud Sync** is a Manifest V3 browser extension for synchronizing Chromium browser state through a **private GitHub Gist**, without depending on a browser vendor's built-in sync service.

The project is designed for Chromium-family browsers where the built-in account sync experience is unavailable, incomplete, or not desirable. The current implementation focuses on portable browser state: open windows and HTTP(S) tabs, tab groups, bookmarks, and installed third-party extension metadata. fileciteturn32file0

The current release line is `1.8.x`. The repository manifest is `1.8.1`, with development builds represented separately through `version_name`. fileciteturn18file0

<a name="readme-features"></a>
## <img src="assets/readme/icons/features.svg" width="24" height="24" alt=""> Features

| Capability | Current implementation |
| :--- | :--- |
| **Tabs & windows** | Synchronizes normal Chromium windows and HTTP(S) tabs, including title, URL, pinned state, active state, order, and tab-group information. |
| **Tab groups** | Synchronizes group title, color, collapsed state, and stable synchronization identity. |
| **Bookmarks** | Flattens the bookmark tree into stable records while retaining parent relationships and order. |
| **Extension inventory** | Records third-party extension metadata including ID, name, version, enabled state, installation type, update information, and store links. |
| **Extension Recovery Center** | Finds extensions present in the cloud inventory but missing locally and provides verified store links when available. |
| **Three-way merge** | Merges base, local, and remote snapshots instead of blindly replacing one side with the other. |
| **Deletion tombstones** | Records deletions so stale devices do not silently recreate removed items. |
| **Conflict visibility** | Keeps unresolved field conflicts explicit instead of silently discarding one side. |
| **Automatic sync** | Background synchronization can be enabled with configurable intervals; it is disabled by default. |
| **Sync history** | Uses GitHub Gist revision history and keeps a local index of up to 30 recent history entries. |
| **Third-party extension package backup** | Separately backs up CRX/ZIP files to a GitHub private repository or WebDAV without mixing those packages into the sync Gist. |
| **Bilingual UI** | The extension ships with English and Simplified Chinese interfaces. |
| **Light / dark themes** | Settings and auxiliary pages provide explicit light and dark theme controls. |

The current background implementation creates stable synchronization IDs for tabs, windows, tab groups, and bookmarks, and collects extension metadata through the Chromium management API. fileciteturn33file0

<a name="readme-sync-model"></a>
## <img src="assets/readme/icons/architecture.svg" width="24" height="24" alt=""> Sync model

Chromium Cloud Sync deliberately avoids a simple "latest device wins" model.

```text
                 ┌─────────────────────┐
                 │   Local base state  │
                 └──────────┬──────────┘
                            │
                ┌───────────┴───────────┐
                │                       │
        ┌───────▼───────┐       ┌───────▼───────┐
        │ Current local │       │ Current remote│
        │     state     │       │     state     │
        └───────┬───────┘       └───────┬───────┘
                │                       │
                └───────────┬───────────┘
                            ▼
                    ┌───────────────┐
                    │ Three-way merge│
                    └───────┬───────┘
                            │
             ┌──────────────┴──────────────┐
             │                             │
      auto-resolved fields          manual conflicts
             │                             │
             └──────────────┬──────────────┘
                            ▼
                    new current revision
```

The merge engine applies field-specific policies. Examples include latest-value resolution for ordinary metadata, maximum semantic version for extension versions, and explicit manual conflicts for fields such as URLs when both sides independently changed the same value. Deletions are tracked separately as tombstones. fileciteturn27file0

The current cloud schema is **v10**, with migration support for schemas **7–10**. Older device-oriented schemas are normalized into the current single-snapshot structure. fileciteturn27file0 fileciteturn28file0

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

### Not synchronized

```text
Third-party extension private storage / settings
Browser passwords
Authentication credentials
Private data belonging to unrelated extensions
```

The project explicitly does **not** synchronize third-party extension settings. Chromium does not expose another extension's private storage through a generic extension API, so the implementation treats extension metadata and extension package recovery as separate concerns. fileciteturn48file0

Browser-level settings are not part of the current synchronization snapshot. They remain a planned expansion point rather than an implemented feature.

<a name="readme-extension-recovery"></a>
## <img src="assets/readme/icons/features.svg" width="24" height="24" alt=""> Extension recovery

The extension inventory is more than a list of names. Each record keeps the extension ID, version, enabled state, update information, installation type, and store-related metadata. When a local browser is missing an extension that exists in the cloud inventory, the **Extension Recovery Center** can surface a direct Chrome Web Store or Microsoft Edge Add-ons installation link when the source is known. fileciteturn33file0 fileciteturn48file0

Installation is intentionally still a browser action performed by the user. The recovery flow is designed to restore the path to the extension, not silently install third-party software.

<a name="readme-package-backup"></a>
## <img src="assets/readme/icons/features.svg" width="24" height="24" alt=""> Third-party extension package backup

CRX/ZIP package backup is isolated from normal browser synchronization.

```text
Browser state sync
└── private GitHub Gist

Third-party package backup
├── GitHub private repository
└── WebDAV server
```

The package-backup subsystem can store selected third-party extension packages together with an index and SHA-256 checksum metadata. It supports GitHub private repositories and WebDAV, and applies a 95 MiB limit to the current GitHub Contents API upload path. Package credentials remain local and are not written into the browser-state snapshot. fileciteturn31file0 fileciteturn48file0

The first backup of an installed extension requires a manually selected CRX or ZIP file because the browser does not expose another extension's installed package bytes directly. fileciteturn31file0

<a name="readme-security"></a>
## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Privacy & security

### GitHub Gist

New synchronization Gists are created as **private Gists**. The synchronization payload in the current implementation is stored as normal JSON in `current.json` and is therefore **not end-to-end encrypted**. Anyone who gains access to the private Gist can read the synchronized browser state. fileciteturn33file0 fileciteturn47file0

The codebase retains compatibility handling for older encrypted synchronization data, but this is a migration path rather than the format used for new synchronization state. fileciteturn29file0 fileciteturn33file0

### Credentials

The main GitHub Token is used for Gist synchronization. Third-party package backups use separate credentials: a GitHub private-repository backend uses its own repository-scoped token, while WebDAV uses its configured URL and optional credentials. Package-backup credentials are kept local and are excluded from the synchronization snapshot. fileciteturn31file0 fileciteturn48file0

Use least-privilege credentials and treat the private Gist as sensitive browser-state storage.

<a name="readme-installation"></a>
## <img src="assets/readme/icons/installation.svg" width="24" height="24" alt=""> Installation

### Recommended: install a release

Open [Releases](https://github.com/CYoJkoY/ChromiumCloudSync/releases) and download the latest release ZIP or CRX.

For the ZIP:

1. Extract the archive.
2. Open your Chromium browser's extension management page, such as `chrome://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the extracted extension directory.

The release workflow publishes both a ZIP package and a signed CRX3 package, together with SHA-256 checksums. Development tags are published as prereleases. fileciteturn25file0

### Initial setup

After installation, open **Settings**:

1. Enter a GitHub Token with access to Gists.
2. Validate the token.
3. Create a new private sync Gist or bind an existing Chromium Cloud Sync Gist.
4. Run **Sync now** once to establish the first revision.
5. Optionally enable automatic synchronization and choose its interval.

The current settings UI exposes GitHub connection, automatic synchronization, third-party extension package storage, local state, sync history, and the user guide. fileciteturn36file0

<a name="readme-usage"></a>
## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Usage

The popup is intended as a fast operational surface rather than a second settings application. It exposes readiness information, the active Gist, last successful sync, automatic-sync state, revision, conflict count, and quick actions. fileciteturn34file0

For deeper work, open the full Settings page. It contains separate panels for **Sync**, **Third-party extensions**, and **Local**, plus dedicated pages for **Sync history** and the **User guide**. fileciteturn36file0

Automatic synchronization is **off by default** and uses **5 minutes** as the default interval. Supported settings include 5, 10, 15, 30, and 60 minutes. fileciteturn33file0 fileciteturn34file0

<a name="readme-history"></a>
## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> History & rollback

The synchronization model treats revisions as first-class state. GitHub Gist supplies the remote revision history, while the extension maintains a local history index capped at **30 entries**. A rollback does not simply mutate history; it creates a new current revision based on the selected prior state. fileciteturn27file0 fileciteturn48file0

This makes history useful both for recovery and for diagnosing unexpected synchronization results.

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

The architecture separates browser/runtime concerns from synchronization semantics and UI concerns. `sync-core.ts` contains the pure merge/tombstone/history logic; `schema.ts` handles validation and migration; `background.ts` coordinates browser APIs, GitHub, local state, and synchronization; the UI layer exposes the resulting state and user actions. fileciteturn15file0 fileciteturn17file0 fileciteturn19file0

<a name="readme-development"></a>
## <img src="assets/readme/icons/development.svg" width="24" height="24" alt=""> Development

### Requirements

- Node.js 24 is used by the release workflow.
- npm for the development toolchain.
- TypeScript.
- Playwright + Chromium for the browser smoke test.

The project keeps runtime source in TypeScript and explicitly verifies that no tracked JavaScript source files exist before release packaging. Generated JavaScript is produced during the build and is not treated as source. fileciteturn25file0

### Common commands

```bash
npm install
npm run typecheck
npm test
npm run validate
npm run build:zip
```

The `validate` pipeline synchronizes the package version, type-checks the code, runs tests, prepares the extension, validates the generated output, and audits the project. A separate smoke test uses Playwright with Chromium. fileciteturn26file0 fileciteturn25file0

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

Stable tags use `vX.Y.Z`. Development tags use `vX.Y.Z.devN` and are published as prereleases. fileciteturn25file0

<a name="readme-status"></a>
## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Project status & roadmap

The core browser-state synchronization path is implemented and currently centered on four areas: tabs/windows, tab groups, bookmarks, and extension metadata. The separate extension package backup path is also implemented.

The most natural future expansion is broader browser-state coverage without weakening the current scope boundaries. In particular, **extension settings** and **browser settings** are planned areas rather than current synchronized data.

The project should continue to favor explicit schemas, migration paths, visible conflicts, and browser-compatible recovery over silent best-effort copying.

<a name="readme-support"></a>
## <img src="assets/readme/icons/overview.svg" width="24" height="24" alt=""> Support & feedback

Use [GitHub Issues](https://github.com/CYoJkoY/ChromiumCloudSync/issues) for bugs, compatibility reports, sync conflicts, schema migration problems, and feature requests.

For synchronization bugs, include the browser, extension version, approximate revision, the operation that failed, and the detailed diagnostic message shown by the extension. Avoid posting GitHub Tokens, private Gist IDs, or other credentials.

<a name="readme-license"></a>
## <img src="assets/readme/icons/development.svg" width="24" height="24" alt=""> License

Chromium Cloud Sync is released under the **MIT License**. See [`LICENSE`](LICENSE) for the full license text. fileciteturn14file0

<div align="center">

[![GitHub](https://img.shields.io/badge/GitHub-CYoJkoY%2FChromiumCloudSync-181717?style=flat-square&logo=github)](https://github.com/CYoJkoY/ChromiumCloudSync)

</div>
