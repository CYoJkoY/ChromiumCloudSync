<div align="center">
  <img src="assets/readme/hero-v2.svg" alt="Chromium Cloud Sync browser-state synchronization workflow" width="960">
</div>

<div align="center">
  <h1>Chromium Cloud Sync</h1>
  <p><strong>Sync your Chromium browser state through infrastructure you control.</strong></p>
  <p>Tabs · Tab Groups · Windows · Bookmarks · Extensions · Recovery</p>
  <p>
    <a href="https://github.com/CYoJkoY/ChromiumCloudSync/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/CYoJkoY/ChromiumCloudSync/release.yml?style=flat-square&label=release" alt="Release workflow status"></a>
    <a href="https://github.com/CYoJkoY/ChromiumCloudSync/releases"><img src="https://img.shields.io/github/v/release/CYoJkoY/ChromiumCloudSync?style=flat-square" alt="Latest stable release"></a>
    <a href="https://github.com/CYoJkoY/ChromiumCloudSync/releases"><img src="https://img.shields.io/github/v/release/CYoJkoY/ChromiumCloudSync?include_prereleases&label=dev%20builds&style=flat-square" alt="Development releases"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-9E8F7E?style=flat-square" alt="MIT license"></a>
    <img src="https://img.shields.io/badge/Manifest-V3-7A8E8E?style=flat-square" alt="Manifest V3">
    <img src="https://img.shields.io/badge/platform-Chromium-8A9E8B?style=flat-square" alt="Chromium">
  </p>
</div>

## Overview

**Chromium Cloud Sync** is a Manifest V3 browser extension for synchronizing useful Chromium state across machines without requiring a project-operated cloud service.

The browser-state boundary is a private **GitHub Gist**. The extension builds normalized snapshots locally, compares them with a local base snapshot, merges local and remote changes, and records deletions and conflicts instead of blindly replacing one side.

A separate optional package-backup system stores third-party extension `.crx` / `.zip` files in a **private GitHub repository** or **WebDAV** server. Package storage is deliberately independent from the browser-state synchronization Gist.

> **Security:** the current `current.json` synchronization payload is ordinary JSON. It is **not end-to-end encrypted**. Older encrypted Gist formats remain readable for compatibility.

## What it synchronizes

| Data | Behavior |
| :--- | :--- |
| Tabs & windows | Synchronizes normal Chromium windows and HTTP(S) tabs. Browser-internal URLs are skipped. |
| Tab groups | Preserves group title, color, collapsed state, and stable synchronization identity. |
| Bookmarks | Uses stable synchronization IDs so local Chromium bookmark IDs do not need to match across machines. |
| Extensions | Synchronizes third-party extension metadata and detects extensions missing on the current browser. |

### What it intentionally does not synchronize

Chromium Cloud Sync does **not** synchronize third-party extension settings.

That boundary is intentional. Chromium extensions have isolated storage, settings differ widely between projects, and a generic sync extension cannot safely read or write another extension's private storage. The project therefore treats extension inventory and extension package recovery as separate, explicit functions.

## Sync model

The synchronization engine uses a three-way comparison:

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

Local-only changes and remote-only changes can be merged automatically. Field-level differences use collection-specific policies such as latest-value resolution or maximum-version selection. Deletions become **tombstones**, which prevents stale copies from silently resurrecting deleted items.

The synchronization state is versioned with monotonically increasing revisions. Every write is verified by reading the remote state back and comparing both revision and snapshot checksum; repeated concurrent failures are stopped instead of being written indefinitely.

## Extension Recovery Center

The extension system has two separate responsibilities:

```text
Extension inventory
        │
        ├── Installed metadata
        ├── Missing-extension detection
        └── Extension Recovery Center

Third-party package backup
        │
        ├── GitHub private repository
        └── WebDAV
```

When an extension exists in the cloud inventory but is not installed locally, **Extension Recovery Center** shows it with its extension ID, recorded cloud version, installation type, and any verified Chrome Web Store, Microsoft Edge Add-ons, or homepage link available from the metadata.

The recovery center does not silently install extensions. Browser installation remains an explicit user action.

For extensions that are unavailable from a browser store, the separate package-backup backend can keep CRX / ZIP files for manual recovery.

## Extension package backup

Package backup is configured independently in **Settings → Third-party extension file storage**.

Supported backends:

- **GitHub private repository** — stores package files, metadata, versioned paths, and SHA-256 hashes.
- **WebDAV** — stores the same package structure on a server you control.
- **Disabled** — no package backup is used.

GitHub browser-side uploads are limited to **95 MB**. Package installation remains manual.

## History and rollback

The GitHub Gist revision history provides recovery points for synchronized browser state. Chromium Cloud Sync also maintains a local index of up to **30** recent history entries.

The History page can inspect remote revisions and create a new current revision from a selected historical state. Rollback never pretends that an old revision is current; it creates a new revision with the restored snapshot.

## Installation

### Release package

Open the [Releases](https://github.com/CYoJkoY/ChromiumCloudSync/releases) page and download the required artifact.

Each release provides:

- `.zip` — unpacked extension package.
- `.crx` — signed CRX3 package.
- `SHA256SUMS.txt` — SHA-256 checksums.

### Load unpacked

1. Open `chrome://extensions/` or the equivalent extension-management page for your Chromium browser.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the repository directory containing `manifest.json`.

## Initial setup

Open **Chromium Cloud Sync → Settings**.

```text
GitHub Token
     │
     ▼
Validate token
     │
     ├── Create a private sync Gist
     │
     └── Bind an existing sync Gist
     │
     ▼
Sync now
```

Automatic synchronization is disabled by default. Its default interval is **5 minutes** after enabling it.

Your GitHub token is a credential. Keep it out of source control, use the smallest practical permission set, and revoke it if exposed.

## Troubleshooting

### Synchronization fails immediately

Open the popup and read the detailed status message. Check the GitHub Token and Gist binding in Settings before changing browser data.

### An extension is missing on another browser

Open **Extension Recovery Center** from the popup. The page compares the local extension inventory with the cloud inventory and provides the verified installation path available from the stored metadata.

### An extension is not available in a browser store

Configure the separate package-backup backend in Settings and restore the CRX / ZIP package manually.

### A conflict appears

Open **History** to inspect the recorded conflict information and recent revisions. Do not delete the remote state blindly; the synchronization engine keeps revision history specifically so a previous state can be recovered.

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

Stable and development releases therefore share one numeric extension version while keeping the development suffix in `version_name`.

```text
v1.7.9
└── stable release

v1.7.9.dev2
└── development / pre-release
```

`package.json.version` follows only `manifest.version`. Development suffixes never enter `package.json`.

The release workflow publishes `vX.Y.Z.devN` as a GitHub pre-release and `vX.Y.Z` as a stable release. The extension's built-in update checker intentionally ignores pre-releases.

## Development

The project uses native JavaScript, HTML, and CSS with no frontend framework.

### Validate

```bash
npm run validate
```

Validation checks version consistency, JavaScript syntax, required files, legacy Gist handling, the absence of removed extension-settings synchronization code, and the sync-core regression suite.

### Test the sync engine

```bash
npm test
```

The regression tests cover local-only changes, tombstone creation, field conflicts, and identical-change convergence.

### Build

```bash
npm run build:zip
```

The local build defaults to `manifest.version`. The release workflow supplies the exact stable or development release version when packaging a tag.

## Repository structure

```text
ChromiumCloudSync/
├── .github/workflows/
│   ├── release.yml
│   └── sync-package-version.yml
├── _locales/
│   ├── en/
│   └── zh_CN/
├── assets/readme/
├── icons/
├── scripts/
│   ├── build.mjs
│   ├── sync-package-version.mjs
│   ├── test-sync-core.mjs
│   └── validate.mjs
├── background.js
├── extensions.html
├── extensions.js
├── extension-storage.js
├── extension-storage-layout.js
├── extension-storage-watch.js
├── guide.html
├── guide.js
├── history.html
├── history.js
├── i18n.js
├── legacy-crypto.js
├── manifest.json
├── options.html
├── options.js
├── package.json
├── popup.html
├── popup-i18n.js
├── popup.js
├── popup-fixes.js
├── runtime.js
├── sync-core.js
├── theme.js
├── ui-overrides.css
├── ui.css
├── update.js
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

The background service worker owns Chromium API access and remote synchronization. `sync-core.js` remains a pure merge-oriented module. Package storage is deliberately isolated from the browser-state snapshot.

## Security and privacy

- New synchronization Gists created by the extension are private.
- The current synchronized state is stored as normal JSON in `current.json`.
- The GitHub token and Gist binding remain local to the browser.
- WebDAV credentials remain local to the browser.
- Legacy encrypted Gist formats can still be read for compatibility.
- SHA-256 is used for extension-package integrity metadata; it is not encryption.

Do not commit GitHub tokens, WebDAV passwords, private synchronization data, or signing keys to this repository or issue tracker.

## Limitations

Browser-internal URLs and other non-HTTP(S) tabs are not treated as ordinary synchronizable tabs. Extension installation is not automated. Third-party extension settings are not synchronized.

Correctness also depends on the configured GitHub or WebDAV backend being available and writable.

## Contributing

Issues and pull requests are welcome.

For sync bugs, include the browser version, Chromium Cloud Sync version, affected collection, whether the change was local or remote, and the visible conflict or error message. Never include credentials or private Gist contents.

Run both `npm test` and `npm run validate` before submitting changes that affect synchronization logic.

## License

This project is licensed under the **MIT License**.

See [`LICENSE`](LICENSE) for the complete MIT License text and copyright notice.

## Support the Author

If this project saves you time or improves your workflow, consider supporting its development.

<div align="center">
  <a href="https://cyojkoy.github.io/Payment/">
    <img src="https://img.shields.io/badge/Support_the_Author-9E8F7E?style=for-the-badge&logo=buy-me-a-coffee&logoColor=BEB8AE" alt="Support the Author">
  </a>
</div>

<div align="center">
  <sub>Built for users who want synchronized Chromium state without giving up control over where their data is stored.</sub>
</div>
