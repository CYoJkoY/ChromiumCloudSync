<div align="center">
  <img src="assets/readme/hero-v2.svg" alt="Chromium Cloud Sync — controlled synchronization for Chromium browser state" width="1200" style="max-width: 100%; height: auto;">

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

  <p><a href="#sync-scope">Sync scope</a> · <a href="#merge-model">Merge model</a> · <a href="#extension-recovery">Extensions</a> · <a href="#installation">Install</a> · <a href="#development">Develop</a></p>
</div>

> **Storage boundary:** browser state is synchronized through a private GitHub Gist. Optional third-party extension package backup uses a separate private GitHub repository or WebDAV backend.

## What it is

**Chromium Cloud Sync** is a Manifest V3 browser extension for synchronizing useful Chromium state across machines without requiring a project-operated cloud service.

The extension builds normalized snapshots locally, compares them against a local base snapshot, merges local and remote changes, and records deletions and conflicts rather than blindly replacing one side.

Browser-state sync and extension-package backup are deliberately separate. That keeps the core snapshot focused while making package recovery explicit and independently configurable.

> **Security boundary:** the current `current.json` payload is ordinary JSON and **not end-to-end encrypted**. Older encrypted Gist formats remain readable for compatibility.

## Sync scope

| Data | Behavior |
| :--- | :--- |
| Tabs & windows | Synchronizes normal Chromium windows and HTTP(S) tabs; browser-internal URLs are skipped. |
| Tab groups | Preserves title, color, collapsed state, and stable sync identity. |
| Bookmarks | Uses stable synchronization IDs instead of relying on local Chromium bookmark IDs. |
| Extensions | Synchronizes third-party extension metadata and detects extensions missing locally. |

### What is intentionally not synchronized

Third-party extension settings are **not** synchronized. Chromium extensions have isolated storage and incompatible schemas; a generic browser extension should not assume it can safely read or write another extension's private settings.

The project therefore treats extension inventory and package recovery as explicit functions rather than claiming arbitrary extension-state synchronization.

## Merge model

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

Local-only and remote-only changes can merge automatically. Collection-specific policies handle field differences, while deletions become **tombstones** so stale copies do not silently resurrect removed data.

Sync state uses monotonically increasing revisions. A remote write is verified by reading the state back and comparing revision and snapshot checksum; repeated concurrent failures stop instead of retrying indefinitely.

## Extension recovery

Extension inventory and package storage are separate layers.

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

When an extension is present in the cloud inventory but missing locally, **Extension Recovery Center** shows recorded metadata and available verified installation links.

The recovery center does not silently install extensions. Installation remains an explicit browser action.

For extensions unavailable from a browser store, configured package storage can retain CRX / ZIP files for manual recovery.

### Package backends

| Backend | Role |
| :--- | :--- |
| GitHub private repository | Package files, metadata, versioned paths, SHA-256 hashes |
| WebDAV | The same package structure on storage you control |
| Disabled | No third-party extension package backup |

GitHub browser-side uploads are limited to **95 MB**. Package installation remains manual.

## History and rollback

GitHub Gist revision history provides recovery points for synchronized browser state. The extension keeps a local index of up to **30** recent history entries.

A selected historical state is restored by creating a new current revision rather than rewriting history. This keeps rollback auditable and preserves the original revision chain.

## Installation

### Release package

Download the desired artifact from [Releases](https://github.com/CYoJkoY/ChromiumCloudSync/releases).

| Artifact | Purpose |
| :--- | :--- |
| `.zip` | Unpacked extension package |
| `.crx` | Signed CRX3 package |
| `SHA256SUMS.txt` | SHA-256 checksums |

### Load unpacked

1. Open `chrome://extensions/` or the corresponding extension-management page.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the directory containing `manifest.json`.

## First setup

Open **Chromium Cloud Sync → Settings**.

```text
GitHub Token
     │
     ▼
Validate token
     │
     ├── Create private sync Gist
     └── Bind existing sync Gist
     │
     ▼
Sync now
```

Automatic synchronization is disabled by default. When enabled, the default interval is **5 minutes**.

Treat the GitHub token as a credential: keep it out of source control, grant the smallest practical permission set, and revoke it if exposed.

## Release channels

`manifest.json` is the source of truth for the extension version.

```json
{
  "version": "1.7.9",
  "version_name": "1.7.9.dev7"
}
```

| Field | Meaning |
| :--- | :--- |
| `version` | Stable extension version and version mirrored to `package.json` |
| `version_name` | Optional development identifier in `X.Y.Z.devN` form |

Tags follow the same model:

```text
v1.7.9       → stable
v1.7.9.dev7  → development / pre-release
```

`package.json.version` follows only `manifest.version`. Development suffixes do not enter `package.json`, and the built-in update checker ignores pre-releases.

## Development

The extension uses native JavaScript, HTML, and CSS with no frontend framework.

### Validate

```bash
npm run validate
```

Validation checks version consistency, JavaScript syntax, required files, legacy Gist handling, removal of obsolete extension-settings sync paths, and sync-core regressions.

### Test

```bash
npm test
```

The regression suite covers local-only changes, tombstones, field conflicts, and identical-change convergence.

### Build

```bash
npm run build:zip
```

Local builds default to `manifest.version`; release packaging supplies the exact stable or development version associated with the tag.

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

The background service worker owns Chromium API access and remote synchronization. `sync-core.js` stays merge-oriented, while package storage remains outside the browser-state snapshot.

## Repository structure

```text
ChromiumCloudSync/
├── .github/workflows/
├── _locales/
├── assets/readme/
├── icons/
├── scripts/
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

## Troubleshooting

**Sync fails immediately:** inspect popup status, then re-check the GitHub token and Gist binding in Settings before modifying local browser data.

**An extension is missing:** open Extension Recovery Center and compare the local and cloud inventories.

**A browser-store package is unavailable:** configure GitHub private-repository or WebDAV package storage and recover the CRX / ZIP manually.

**A conflict appears:** inspect History and the recorded revisions before deciding whether to keep local or remote state.

## Security and privacy

- Newly created sync Gists are private.
- `current.json` is stored as ordinary JSON.
- The GitHub token and Gist binding remain local to the browser.
- WebDAV credentials remain local to the browser.
- Legacy encrypted Gist formats remain readable for compatibility.
- SHA-256 is integrity metadata, not encryption.

Do not commit GitHub tokens, WebDAV passwords, private synchronization data, or signing keys to this repository or issue tracker.

## Limitations

Browser-internal URLs and other non-HTTP(S) tabs are not treated as ordinary synchronized tabs. Extension installation is not automated. Third-party extension settings are not synchronized.

Correctness also depends on the configured GitHub or WebDAV backend being reachable and writable.

## Contributing

Useful contributions fix concrete synchronization defects, improve recovery behavior, strengthen compatibility, or make the sync model easier to understand and test.

For sync bugs, include the browser version, extension version, affected collection, whether the change was local or remote, and the visible conflict or error. Never include credentials or private Gist contents.

Run both `npm test` and `npm run validate` before submitting synchronization changes.

## Support

Development support is available through the deployed payment page:

**https://cyojkoy.github.io/Payment/**

## License

This project is licensed under the **MIT License**.

See [`LICENSE`](LICENSE) for the complete license text.

<div align="center">
  <sub>Chromium Cloud Sync · synchronized browser state without a project-operated cloud service.</sub>
</div>
