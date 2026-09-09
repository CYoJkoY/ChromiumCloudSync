<div align="center">
  <img src="assets/readme/hero-v2.svg" alt="Chromium Cloud Sync — controlled synchronization for Chromium browser state" width="1200" style="max-width:100%;height:auto;">
  <h1>Chromium Cloud Sync</h1>
  <p><strong>Synchronize useful Chromium state while keeping the storage boundary under your control.</strong></p>
  <p>Tabs · Tab Groups · Windows · Bookmarks · Extensions · History</p>
  <p>
    <a href="https://github.com/CYoJkoY/ChromiumCloudSync/releases"><img src="https://img.shields.io/github/v/release/CYoJkoY/ChromiumCloudSync?style=flat-square&label=stable" alt="Latest stable release"></a>
    <a href="https://github.com/CYoJkoY/ChromiumCloudSync/releases"><img src="https://img.shields.io/github/v/release/CYoJkoY/ChromiumCloudSync?include_prereleases&label=dev%20builds&style=flat-square" alt="Development releases"></a>
    <a href="https://github.com/CYoJkoY/ChromiumCloudSync/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/CYoJkoY/ChromiumCloudSync/release.yml?style=flat-square&label=release" alt="Release workflow status"></a>
    <img src="https://img.shields.io/badge/Manifest-V3-7A8E8E?style=flat-square" alt="Manifest V3">
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-9E8F7E?style=flat-square" alt="MIT License"></a>
  </p>
  <p><a href="#what-it-is">Overview</a> · <a href="#sync-scope">Sync scope</a> · <a href="#merge-model">Merge model</a> · <a href="#installation">Install</a> · <a href="#development--support">Development</a></p>
</div>

> **Storage boundary:** browser state uses a private GitHub Gist. Optional third-party extension package backup uses a separate private GitHub repository or WebDAV backend.

## <img src="assets/readme/icons/overview.svg" width="20" height="20" alt=""> What it is

**Chromium Cloud Sync** is a Manifest V3 browser extension for synchronizing useful Chromium state across machines without a project-operated cloud service.

It builds normalized snapshots locally, compares local and remote state, merges changes, and records deletions and conflicts instead of blindly replacing one side.

Third-party extension settings are intentionally outside the sync boundary because generic code cannot safely read or write another extension's isolated storage.

## <img src="assets/readme/icons/features.svg" width="20" height="20" alt=""> Sync scope

| Data | Behavior |
| :--- | :--- |
| Tabs & windows | Synchronizes normal Chromium windows and HTTP(S) tabs; browser-internal URLs are skipped. |
| Tab groups | Preserves title, color, collapsed state, and stable sync identity. |
| Bookmarks | Uses stable synchronization IDs rather than local Chromium IDs. |
| Extensions | Synchronizes third-party extension metadata and detects missing extensions. |

Extension inventory is separate from extension package backup and installation recovery.

## <img src="assets/readme/icons/architecture.svg" width="20" height="20" alt=""> Merge model

```text
                  Base snapshot
                       │
            ┌──────────┴──────────┐
            ▼                     ▼
       Local browser        Remote Gist
            │                     │
            └──────────┬──────────┘
                       ▼
                  Merge policy
                       │
             ┌─────────┴─────────┐
             ▼                   ▼
        Merged state          Conflicts
```

Local-only and remote-only changes can merge automatically. Deletions become tombstones so stale copies do not silently resurrect data.

Revisions increase monotonically. Remote writes are read back and checked against revision and snapshot checksum before being accepted.

### Extension recovery

Missing-extension detection shows recorded metadata and verified installation paths when available. Package storage can retain CRX / ZIP files for extensions unavailable from a browser store.

Backends: private GitHub repository, WebDAV, or disabled.

## <img src="assets/readme/icons/installation.svg" width="20" height="20" alt=""> Installation

### Load unpacked

1. Run `npm install`.
2. Run `npm run build:extension` to compile the TypeScript source into ignored runtime JavaScript files.
3. Open `chrome://extensions/` or the equivalent Chromium extension-management page.
4. Enable **Developer mode**.
5. Choose **Load unpacked** and select the repository directory containing `manifest.json`.

### First setup

Open **Chromium Cloud Sync → Settings**, validate a GitHub token, then create or bind a private sync Gist. Automatic synchronization is disabled by default and uses a 5-minute interval when enabled.

The current manifest declares extension version `1.8.0` with development identifier `1.8.0.dev1`.

## <img src="assets/readme/icons/development.svg" width="20" height="20" alt=""> Development & support

The extension uses TypeScript as its source language, with native HTML and CSS for UI surfaces. Browser-executable JavaScript is generated into ignored build output and is never kept as source in the repository.

Important commands:

```bash
npm install
npm run validate
npm test
npm run build:extension
npm run build:zip
```

`manifest.json` is the source of truth for stable versioning; development suffixes remain in `version_name` and do not enter `package.json.version`.

The migration intentionally preserves the existing execution model and script ordering. TypeScript adds the source/build layer without introducing a UI framework or changing the sync protocol.

Do not commit GitHub tokens, WebDAV passwords, private Gist data, or signing keys.

<a href="https://cyojkoy.github.io/Payment/"><img src="assets/readme/support-cta.svg" alt="Support Chromium Cloud Sync" width="900" style="max-width:100%;height:auto;"></a>

Development support: **https://cyojkoy.github.io/Payment/**

## License

This project is licensed under the **MIT License**.

See [`LICENSE`](LICENSE) for the complete license text.
