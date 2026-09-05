<div align="center">
  <img src="icons/icon128.png" width="104" height="104" alt="Chromium Cloud Sync">
  <h1>Chromium Cloud Sync</h1>
  <p><strong>Sync Chromium browser state through your own GitHub Gist.</strong></p>
  <p>
    <a href="https://github.com/CYoJkoY/ChromiumCloudSync/releases/latest"><img src="https://img.shields.io/github/v/release/CYoJkoY/ChromiumCloudSync?display_name=tag&style=for-the-badge" alt="Latest release"></a>
    <a href="https://github.com/CYoJkoY/ChromiumCloudSync/stargazers"><img src="https://img.shields.io/github/stars/CYoJkoY/ChromiumCloudSync?style=for-the-badge" alt="GitHub stars"></a>
    <a href="LICENSE"><img src="https://img.shields.io/github/license/CYoJkoY/ChromiumCloudSync?style=for-the-badge" alt="License"></a>
  </p>
  <p>
    <a href="https://github.com/CYoJkoY/ChromiumCloudSync/releases">Downloads</a>
    ·
    <a href="https://github.com/CYoJkoY/ChromiumCloudSync/issues">Issues</a>
    ·
    <a href="https://github.com/CYoJkoY/ChromiumCloudSync/discussions">Discussions</a>
  </p>
</div>

---

## What is Chromium Cloud Sync?

Chromium Cloud Sync is a lightweight Manifest V3 extension that synchronizes useful browser state between Chromium-based installations while keeping the storage architecture deliberately small.

There is **no project-owned sync server**. The extension talks directly to GitHub and uses a single shared private Gist as the synchronization state.

```text
             ┌───────────────────────┐
             │      Chromium A       │
             │ local base snapshot   │
             └───────────┬───────────┘
                         │
                  read / merge / write
                         │
                         ▼
              ┌──────────────────────┐
              │     GitHub Gist      │
              │   manifest.json      │
              │   current.json       │
              │   native revisions   │
              └──────────────────────┘
                         ▲
                  read / merge / write
                         │
             ┌───────────┴───────────┐
             │      Chromium B       │
             │ local base snapshot   │
             └───────────────────────┘
```

The project intentionally does **not** maintain a device registry or per-device cloud database. Every installation works against the same shared synchronization state.

## Why it is different

| | Chromium Cloud Sync | Traditional browser sync |
| --- | --- | --- |
| Sync backend | Your GitHub Gist | Vendor-owned service |
| Project server | None | Required |
| Cloud state | One shared state | Usually account/device oriented |
| History | GitHub Gist revisions | Provider-specific |
| Conflicts | Merge + explicit conflict records | Provider-specific |
| Data format | Inspectable JSON | Provider-specific |
| Extension packages | Separate optional storage | Not part of sync state |

The goal is not to reproduce every feature of a vendor browser account. The goal is to provide a transparent, inspectable synchronization layer for users who want control over the storage boundary.

## Features

### Browser state synchronization

Currently synchronized data includes:

- Tabs and window state
- Tab groups
- Bookmarks and bookmark trees
- Installed extension inventory
- Selected extension-local settings exposed through Chromium storage APIs
- Synchronization metadata, tombstones, and conflict records

Missing extensions are detected but **never silently installed**. Installation remains under browser and user control.

### Conflict-aware merging

The extension keeps a local base snapshot and compares it with the current remote state before writing.

That allows it to distinguish local changes from remote changes instead of treating synchronization as a blind overwrite:

```text
Local base ──────┐
                 ├── merge ──> new shared state
Local current ───┤
                 │
Remote current ──┘
                      │
                      └── unresolved differences → conflict records
```

### Native revision history

The Gist itself is the history system.

There is no custom `history/*` database. Previous Gist revisions remain available through GitHub, while rollback creates a **new revision** rather than rewriting history.

### Automatic synchronization

Automatic synchronization is **off by default**.

The default interval is **5 minutes**. It can be changed independently from the enabled/disabled state.

### Third-party extension package storage

CRX and ZIP backups are deliberately kept outside the browser synchronization Gist.

The Settings page provides a dedicated extension-storage section with three backend choices:

```text
Disabled
   │
   ├── GitHub private repository
   │
   └── WebDAV
```

A typical package layout is:

```text
<storage root>/
└── extensions/
    └── <extension-id>/
        └── v<version>/
            ├── package.crx / package.zip
            └── metadata.json
```

The browser-side GitHub Contents API currently rejects files larger than **95 MB**. Git LFS may be appropriate for larger repositories, but this extension does not implement Git LFS transfers.

Package installation is always a user-controlled action.

## Storage and privacy

### The sync Gist

The current synchronization format contains two files:

```text
manifest.json
current.json
```

`manifest.json` describes synchronization format and revision metadata.

`current.json` contains the current shared browser state.

### Plain JSON is intentional

The current sync path uses normal JSON. There is no application-layer encryption for current synchronization data.

This keeps the storage model inspectable and avoids a separate encryption-key recovery protocol.

> **Access to the synchronization Gist should be treated as access to the synchronized browser state.**

New Gists created by the extension are private by default. Older encrypted Gists remain readable through compatibility-only migration code so existing data can be migrated.

### GitHub credentials

The GitHub Token is stored locally in the extension and is used for authenticated GitHub API access.

Never commit tokens, signing keys, PEM/private-key files, personal Gist contents, or private backup credentials.

## Installation

### Recommended: GitHub Releases

Download the latest release from:

**https://github.com/CYoJkoY/ChromiumCloudSync/releases/latest**

A release contains the distributable ZIP, signed CRX3 package, and SHA-256 checksums.

For standard manual installation:

```text
1. Download the ZIP
2. Extract it
3. Open chrome://extensions/
4. Enable Developer mode
5. Choose Load unpacked
6. Select the extracted directory
```

The project does **not** claim that a GitHub-hosted CRX can silently update an installed extension. Chromium installation policies vary by browser and environment.

### Development installation

```text
1. Clone this repository
2. Open the Chromium extensions page
3. Enable Developer mode
4. Choose Load unpacked
5. Select the repository directory
```

## First-time setup

```text
Install
  ↓
Open Settings
  ↓
Enter GitHub Token
  ↓
Validate Token
  ↓
Create or bind a synchronization Gist
  ↓
Run Sync now
  ↓
Optionally enable automatic synchronization
```

New synchronization Gists created by the extension are private by default.

## Updates & releases

The extension checks the repository's latest GitHub Release and can notify you when a newer version is available.

Release builds are produced from semantic version tags:

```text
git tag vX.Y.Z
      │
      ▼
  GitHub Actions
      │
      ├─ validate
      ├─ build ZIP
      ├─ build signed CRX3
      ├─ generate SHA-256SUMS
      └─ publish Release
```

The CRX signing key is supplied through the GitHub Actions secret:

```text
CRX_PRIVATE_KEY_B64
```

The key must remain stable so releases keep the same extension signing identity.

## History & rollback

Rollback is non-destructive:

```text
Historical revision
       │
       ▼
Selected state
       │
       ▼
Write as a new revision
```

Existing Gist revisions are not deleted by rollback.

## Limitations

- Restricted pages such as many `chrome://` URLs cannot be synchronized.
- Extension settings are limited to storage exposed to the extension by Chromium.
- Missing extensions are reported rather than silently installed.
- GitHub availability and Gist behavior are external dependencies.
- Plain JSON means Gist access is equivalent to access to the synced state.
- Browser-side GitHub package uploads are limited to 95 MB per file.
- Chromium-based browsers do not all enforce extension policies identically.

## Development

The project uses native JavaScript and Manifest V3 rather than a heavy frontend framework.

**Requirements**

- Node.js 24+
- A Chromium-based browser with Manifest V3 support

**Validate**

```bash
npm run validate
```

**Build**

```bash
npm run build:zip
```

The build reads its version directly from `manifest.json`.

## Project structure

```text
ChromiumCloudSync/
├── .github/workflows/release.yml
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

## Design philosophy

Chromium Cloud Sync intentionally chooses a small and inspectable architecture:

> **One shared state. Local base snapshots. Explicit conflicts. Native history. Separate package storage. User-controlled installation.**

That means fewer moving parts, easier recovery, and fewer hidden services between the browser and its data.

## Contributing

Issues and pull requests are welcome.

When making changes, preserve the project's core properties:

- Do not commit credentials or signing keys.
- Do not upload private synchronization data.
- Keep permissions aligned with actual feature usage.
- Preserve migration paths when changing the sync schema.
- Update the README when the user-visible architecture changes.

## License

Chromium Cloud Sync is free software licensed under the **GNU General Public License v3.0 only (GPL-3.0-only)**.

See [LICENSE](LICENSE).

<div align="center">
  <sub>Chromium Cloud Sync · GitHub-backed browser synchronization</sub>
</div>
