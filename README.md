<div align="center">
  <img src="icons/icon128.png" width="96" height="96" alt="Chromium Cloud Sync icon">
  <h1>Chromium Cloud Sync</h1>
  <p>A self-hosted-in-practice Chromium sync extension powered by GitHub Gist.</p>

  <p>
    <a href="https://github.com/CYoJkoY/ChromiumCloudSync/releases"><img src="https://img.shields.io/github/v/release/CYoJkoY/ChromiumCloudSync" alt="Latest release"></a>
    <a href="https://github.com/CYoJkoY/ChromiumCloudSync/actions/workflows/release.yml"><img src="https://github.com/CYoJkoY/ChromiumCloudSync/actions/workflows/release.yml/badge.svg?branch=main" alt="Release workflow"></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/CYoJkoY/ChromiumCloudSync" alt="License"></a>
    <a href="https://github.com/CYoJkoY/ChromiumCloudSync"><img src="https://img.shields.io/github/stars/CYoJkoY/ChromiumCloudSync?style=flat" alt="GitHub stars"></a>
  </p>

  <p>
    <strong>No project-owned sync server.</strong><br>
    <strong>One shared sync state.</strong><br>
    <strong>GitHub-native revision history.</strong>
  </p>
</div>

## Overview

Chromium Cloud Sync is a Manifest V3 extension for synchronizing browser state between Chromium-based browser installations.

The project uses **GitHub Gist as the synchronization storage layer**. The extension talks to GitHub directly; this project does not operate a separate synchronization server or database.

The synchronization model is intentionally simple:

```text
┌──────────────┐
│  Chromium A  │
└──────┬───────┘
       │
       │ read / merge / write
       ▼
┌──────────────────────┐
│     GitHub Gist      │
│  manifest.json       │
│  current.json        │
│  native revisions    │
└──────────┬───────────┘
           │
           │ read / merge / write
           ▼
┌──────────────┐
│  Chromium B  │
└──────────────┘
```

There is **no device registry** and no device-specific cloud database. Every installation participates in the same shared synchronization state. Each browser keeps a local base snapshot so changes can be merged instead of blindly overwriting the remote state.

## Current Features

### Browser synchronization

The main synchronization layer covers the browser state that can be meaningfully exchanged between installations:

| Area | Data |
| --- | --- |
| Tabs | URLs, titles, pinned state, active state, window state, and tab-group metadata |
| Tab groups | Titles, colors, and collapsed state |
| Bookmarks | Bookmark trees, titles, URLs, ordering, and local-tree merging |
| Extensions | Extension inventory for comparing installations |
| Extension settings | Selected extension-local storage that Chromium exposes to the extension |
| Sync metadata | Revision metadata, timestamps, tombstones, and conflict records |

The extension does not silently install extensions. Missing extensions can be identified, but installation remains controlled by the browser and the user.

### Conflict-aware synchronization

Sync is not a simple last-write-wins upload.

The extension compares the current remote state with its local base snapshot, merges local and remote changes, and records unresolved conflicts instead of silently dropping one side.

This makes the synchronization state recoverable and keeps conflicts visible to the user.

### GitHub Gist history

The Gist's own revision system is the history layer.

The project does not maintain a separate `history/*` database. The history UI reads Gist revisions, and rollback creates a new revision from a selected historical state rather than destroying existing history.

### Automatic synchronization

Automatic sync is **disabled by default**.

The default interval is **5 minutes**, and the interval can be changed without changing the enabled/disabled state.

```text
Automatic sync: Off by default
Default interval: 5 minutes
```

### Third-party extension package storage

Third-party extension packages are handled separately from browser sync.

CRX/ZIP files are **not stored inside the synchronization Gist**. The Settings UI has a dedicated extension-storage section where a user can choose a package storage backend:

- GitHub private repository
- WebDAV
- Disabled

GitHub storage uses the repository's Contents API. WebDAV storage uses the configured WebDAV endpoint.

The storage layer keeps package files and metadata separately from the browser synchronization state and uses a structure similar to:

```text
<configured-root>/
└── extensions/
    └── <extension-id>/
        └── v<version>/
            ├── <package>.crx / <package>.zip
            └── metadata.json
```

Package uploads over **95 MB** are rejected when using the browser-side GitHub Contents API. Git LFS may be appropriate for larger repositories, but the extension does not implement Git LFS transfer itself.

Extension installation is always a user-controlled action.

## Data and Trust Model

### What is stored in GitHub Gist

The current synchronization format is deliberately small:

```text
manifest.json
current.json
```

`manifest.json` describes the synchronization format and revision metadata.

`current.json` contains the current shared synchronization state.

### Plain JSON by design

The current synchronization payload is stored as normal JSON. There is no application-layer encryption in the current sync path.

This is an intentional architectural choice: the state remains inspectable, and there is no additional encryption key-management or recovery protocol to maintain.

The security boundary is therefore explicit:

> **Anyone who can access the synchronization Gist can access the synchronized browser state.**

Older encrypted Gists are still handled by compatibility code so existing users can migrate to the current format.

### GitHub token

The GitHub Token is stored locally by the extension and is used for authenticated GitHub API requests.

Never commit the following to the repository:

- GitHub tokens
- CRX signing keys
- PEM/private-key files
- personal Gist contents
- personal extension backup repositories or credentials

## Installation

### Recommended: GitHub Releases

Releases are published at:

<https://github.com/CYoJkoY/ChromiumCloudSync/releases>

A release is built from the version in `manifest.json` and publishes the distributable ZIP, the signed CRX, and SHA-256 checksums.

For normal manual installation:

1. Download the release ZIP.
2. Extract it to a local directory.
3. Open `chrome://extensions/` or the equivalent extensions page.
4. Enable **Developer mode**.
5. Select **Load unpacked** and choose the extracted directory.

The CRX is provided for environments that accept CRX packages. Chromium installation policy varies by browser and environment, so the project does not claim that a self-hosted CRX can silently replace an installed extension.

### Development installation

You can also load the repository directly:

1. Clone the repository.
2. Open the Chromium extensions page.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the repository directory.

## First-time setup

After installation:

1. Open the extension's Settings page.
2. Enter a GitHub Token with permission to use Gists.
3. Validate the Token.
4. Create a new synchronization Gist or bind an existing one.
5. Run **Sync now** to verify the connection.
6. Enable automatic sync only when you want background synchronization.

New synchronization Gists created by the extension are private by default.

## Updates

The extension checks the project's latest GitHub Release and can notify the user when a newer version is available.

Releases are built by GitHub Actions from version tags:

```text
git tag vX.Y.Z
      │
      ▼
GitHub Actions
      │
      ├── validate
      ├── build ZIP
      ├── build signed CRX3
      ├── generate SHA-256 checksums
      └── publish GitHub Release
```

The CRX signing key is supplied to GitHub Actions through the repository secret:

```text
CRX_PRIVATE_KEY_B64
```

The signing key must remain stable across releases so the extension keeps the same cryptographic identity.

## History and Rollback

The History page exposes GitHub Gist revisions, including previous states and synchronization conflict information.

Rollback is intentionally non-destructive:

```text
selected historical revision
            │
            ▼
       current state
            │
            ▼
      new Gist revision
```

Existing Gist history is not rewritten or deleted by rollback.

## Browser Compatibility

Chromium Cloud Sync targets Chromium-based browsers that support Manifest V3 and the APIs used by the extension.

Browser behavior is not completely uniform across Chrome, Chromium, Edge, and other Chromium distributions. In particular, extension-management policy, restricted URLs, tab groups, and extension installation rules can differ between environments.

The project therefore treats unsupported browser behavior as a platform limitation rather than pretending all Chromium browsers are identical.

## Known Limitations

- Restricted pages such as many `chrome://` URLs cannot be synchronized.
- Extension settings are limited to storage that Chromium exposes to this extension.
- Missing extensions are identified rather than silently installed.
- GitHub availability and Gist behavior are external dependencies.
- Plain-JSON sync means access to the Gist should be treated as access to the synchronized data.
- Browser-side GitHub package uploads are limited to 95 MB per file.

## Development

The project uses native JavaScript and Manifest V3 rather than a large frontend framework.

Requirements:

- Node.js 24+
- A Chromium-based browser with Manifest V3 support

Validate the repository:

```bash
npm run validate
```

Build the release ZIP:

```bash
npm run build:zip
```

The release build takes the version directly from `manifest.json`.

## Project Structure

```text
ChromiumCloudSync/
├── .github/workflows/
│   └── release.yml
├── _locales/
├── icons/
├── background.js
├── sync-core.js
├── legacy-crypto.js
├── update.js
├── runtime.js
├── i18n.js
├── theme.js
├── extension-storage.js
├── extension-storage-layout.js
├── extension-storage-watch.js
├── popup.html
├── popup.js
├── popup-i18n.js
├── options.html
├── options.js
├── history.html
├── history.js
├── guide.html
├── guide.js
├── ui.css
├── ui-overrides.css
├── manifest.json
└── scripts/
    ├── build.mjs
    └── validate.mjs
```

## Design Principles

The project deliberately favors a small, inspectable architecture:

1. **One shared sync state** instead of per-device cloud state.
2. **Local base snapshots** instead of blind remote overwrites.
3. **GitHub Gist revisions** instead of a custom history database.
4. **Explicit conflicts** instead of silently discarding concurrent changes.
5. **Plain JSON** instead of maintaining a separate application-layer encryption protocol.
6. **Separate package storage** instead of mixing CRX/ZIP binaries into the sync Gist.
7. **User-controlled installation** instead of hidden extension installation.
8. **Native browser APIs** instead of a heavy application framework.

These are architectural decisions, not temporary implementation shortcuts.

## Contributing

Issues and pull requests are welcome.

When changing the synchronization model, please preserve migration paths and keep the data model understandable. In particular:

- Do not commit credentials or signing keys.
- Do not upload private synchronization data.
- Keep extension permissions aligned with actual feature usage.
- Preserve compatibility when changing the Gist schema.
- Update this README when user-visible architecture changes.

## License

Chromium Cloud Sync is free software released under the **GNU General Public License v3.0 only (GPL-3.0-only)**.

See [LICENSE](LICENSE).
