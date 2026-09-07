<div align="center">
  <img src="assets/readme/hero-v2.svg" alt="Chromium Cloud Sync — controlled synchronization for Chromium browser state" width="960" style="max-width: 100%; height: auto;">

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

  <p><a href="#what-it-synchronizes">Sync scope</a> · <a href="#sync-model">Sync model</a> · <a href="#extension-recovery-center">Extensions</a> · <a href="#installation">Installation</a> · <a href="#development">Development</a></p>
</div>

> **Core boundary:** browser state is synchronized through a private GitHub Gist. Optional third-party extension package backup uses a separate private GitHub repository or WebDAV backend.

## What it is

**Chromium Cloud Sync** is a Manifest V3 browser extension for synchronizing useful Chromium state across machines without requiring a project-operated cloud service.

The extension builds normalized snapshots locally, compares them with a local base snapshot, merges local and remote changes, and records deletions and conflicts instead of blindly replacing one side.

The design deliberately separates browser-state synchronization from extension-package backup. That keeps the core sync snapshot small and makes package recovery an explicit, independently configurable function.

> **Security:** the current `current.json` synchronization payload is ordinary JSON and is **not end-to-end encrypted**. Older encrypted Gist formats remain readable for compatibility.

## What it synchronizes

| Data | Behavior |
| :--- | :--- |
| Tabs & windows | Synchronizes normal Chromium windows and HTTP(S) tabs; browser-internal URLs are skipped. |
| Tab groups | Preserves title, color, collapsed state, and stable synchronization identity. |
| Bookmarks | Uses stable synchronization IDs so local Chromium bookmark IDs do not need to match across machines. |
| Extensions | Synchronizes third-party extension metadata and detects extensions missing on the current browser. |

### Explicit boundary: extension settings

Third-party extension settings are **not synchronized**.

Chromium extensions have isolated storage and widely different schemas. A generic sync extension cannot safely read or write another extension's private settings. Chromium Cloud Sync therefore treats extension inventory and package recovery as explicit functions instead of claiming to synchronize arbitrary extension state.

## Sync model

The sync engine uses a three-way comparison:

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

Local-only and remote-only changes can be merged automatically. Collection-specific policies handle field differences, while deletions become **tombstones** so stale copies do not silently resurrect deleted items.

The sync state uses monotonically increasing revisions. Every write is verified by reading the remote state back and comparing revision and snapshot checksum; repeated concurrent failures stop instead of writing indefinitely.

## Extension Recovery Center

Extension inventory and package recovery are separate layers.

```text
Extension inventory
    │
    ├── Installed metadata
    ├── Missing-extension detection
    └── Recovery Center

Package backup
    │
    ├── Private GitHub repository
    └── WebDAV
```

When an extension exists in the cloud inventory but is not installed locally, **Extension Recovery Center** shows its extension ID, recorded cloud version, installation type, and verified browser-store or homepage links available from the metadata.

The recovery center does not silently install extensions. Installation remains an explicit browser action.

For extensions unavailable from a browser store, the package-backup backend can retain CRX / ZIP files for manual recovery.

## Extension package backup

Configure this separately in **Settings → Third-party extension file storage**.

| Backend | Purpose |
| :--- | :--- |
| GitHub private repository | Stores package files, metadata, versioned paths, and SHA-256 hashes. |
| WebDAV | Stores the same package structure on a server you control. |
| Disabled | No third-party extension package backup. |

GitHub browser-side uploads are limited to **95 MB**. Package installation remains manual.

## History and rollback

GitHub Gist revision history provides recovery points for synchronized browser state. The extension also keeps a local index of up to **30** recent history entries.

The History page can inspect remote revisions and create a new current revision from a selected historical state. Rollback is implemented as a new revision, so an older snapshot is restored without pretending that its original revision is current.

## Installation

### Release package

Open [Releases](https://github.com/CYoJkoY/ChromiumCloudSync/releases) and download the required artifact.

| Artifact | Use |
| :--- | :--- |
| `.zip` | Unpacked extension package |
| `.crx` | Signed CRX3 package |
| `SHA256SUMS.txt` | SHA-256 checksums |

### Load unpacked

1. Open `chrome://extensions/` or the equivalent extension-management page for your Chromium browser.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the repository directory containing `manifest.json`.

## Initial setup

Open **Chromium Cloud Sync → Settings**.

```text
GitHub Token
     │
     ▼
Validate token
     │
     ├── Create a private sync Gist
     └── Bind an existing sync Gist
     │
     ▼
Sync now
```

Automatic synchronization is disabled by default. When enabled, the default interval is **5 minutes**.

Treat the GitHub token as a credential: keep it out of source control, use the smallest practical permission set, and revoke it if exposed.

## Versioning and release channels

`manifest.json` is the source of truth for the extension version.

```json
{
  "version": "1.7.9",
  "version_name": "1.7.9.dev2"
}
```

| Field | Purpose |
| :--- | :--- |
| `version` | Stable Chromium extension version and the version mirrored to `package.json`. |
| `version_name` | Optional development identifier in the form `X.Y.Z.devN`. |

Release tags follow the same distinction:

```text
v1.7.9       → stable release
v1.7.9.dev2  → development / pre-release
```

`package.json.version` follows only `manifest.version`; development suffixes never enter `package.json`. The built-in update checker intentionally ignores pre-releases.

## Development

Chromium Cloud Sync uses native JavaScript, HTML, and CSS with no frontend framework.

### Validate

```bash
npm run validate
```

Validation checks version consistency, JavaScript syntax, required files, legacy Gist handling, removal of obsolete extension-settings synchronization code, and the sync-core regression suite.

### Test the sync engine

```bash
npm test
```

Regression tests cover local-only changes, tombstone creation, field conflicts, and identical-change convergence.

### Build

```bash
npm run build:zip
```

The local build defaults to `manifest.version`. Release packaging supplies the exact stable or development version for the pushed tag.

## Repository structure

```text
ChromiumCloudSync/
├── .github/workflows/
│   ├── ci.yml
│   ├── release.yml
│   └── sync-package-version.yml
├── _locales/
├── assets/readme/
├── icons/
├── scripts/
│   ├── build.mjs
│   ├── sync-package-version.mjs
│   ├── test-sync-core.mjs
│   └── validate.mjs
├── background.js
├── extension-storage*.js
├── extensions.html / extensions.js
├── guide.html / guide.js
├── history.html / history.js
├── manifest.json
├── options.html / options.js
├── package.json
├── popup.html / popup.js
├── runtime.js
├── sync-core.js
├── theme.js
├── update.js
├── ui.css / ui-overrides.css
├── LICENSE
└── README.md
```

## Architecture

```text
Popup / Settings / History / Guide / Recovery Center
                         │
                         ▼
                    Runtime layer
                         │
              ┌──────────┴──────────┐
              ▼                     ▼
        Sync engine             Package storage
        sync-core.js            extension-storage-*
              │                     │
              ▼                     ▼
          GitHub Gist          GitHub repo / WebDAV
```

The background service worker owns Chromium API access and remote synchronization. `sync-core.js` remains a merge-oriented module, while package storage is isolated from the browser-state snapshot.

## Troubleshooting

### Synchronization fails immediately

Read the detailed popup status first. Check the GitHub Token and Gist binding in Settings before modifying browser data.

### An extension is missing

Open **Extension Recovery Center** and compare the local inventory with the cloud inventory. Use the verified installation path stored in the metadata.

### An extension is unavailable from a browser store

Configure package backup in Settings and restore its CRX / ZIP package manually.

### A conflict appears

Open **History** and inspect the recorded conflict information and recent revisions. Avoid deleting remote state blindly; revision history exists specifically for recovery.

## Security and privacy

- Newly created synchronization Gists are private.
- `current.json` is stored as ordinary JSON.
- The GitHub token and Gist binding remain local to the browser.
- WebDAV credentials remain local to the browser.
- Legacy encrypted Gist formats remain readable for compatibility.
- SHA-256 protects package-integrity metadata; it is not encryption.

Do not commit GitHub tokens, WebDAV passwords, private synchronization data, or signing keys to this repository or its issue tracker.

## Limitations

Browser-internal URLs and other non-HTTP(S) tabs are not treated as ordinary synchronizable tabs. Extension installation is not automated. Third-party extension settings are not synchronized.

Correctness also depends on the configured GitHub or WebDAV backend being available and writable.

## Contributing

Issues and pull requests are welcome.

For sync bugs, include the browser version, Chromium Cloud Sync version, affected collection, whether the change was local or remote, and the visible conflict or error message. Never include credentials or private Gist contents.

Run both `npm test` and `npm run validate` before submitting synchronization changes.

## Support

If Chromium Cloud Sync saves you time or gives you more control over browser-state storage, development support is available through the deployed payment page:

**https://cyojkoy.github.io/Payment/**

## License

This project is licensed under the **MIT License**.

See [`LICENSE`](LICENSE) for the complete license text and copyright notice.

<div align="center">
  <sub>Chromium Cloud Sync · synchronized browser state without a project-operated cloud service.</sub>
</div>
