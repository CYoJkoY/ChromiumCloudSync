<div align="center">
  <img src="icons/icon128.png" width="96" height="96" alt="Chromium Cloud Sync icon">
  <h1>Chromium Cloud Sync</h1>
  <p>A lightweight Chromium browser sync extension powered by your own GitHub Gist.</p>

  <a href="https://github.com/CYoJkoY/ChromiumCloudSync/actions/workflows/release.yml"><img src="https://github.com/CYoJkoY/ChromiumCloudSync/actions/workflows/release.yml/badge.svg?branch=main" alt="Release workflow"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/CYoJkoY/ChromiumCloudSync" alt="License"></a>
  <a href="https://github.com/CYoJkoY/ChromiumCloudSync/releases"><img src="https://img.shields.io/github/v/release/CYoJkoY/ChromiumCloudSync" alt="Latest release"></a>
  <a href="https://github.com/CYoJkoY/ChromiumCloudSync"><img src="https://img.shields.io/github/stars/CYoJkoY/ChromiumCloudSync?style=flat" alt="GitHub stars"></a>
</div>

Chromium Cloud Sync is a lightweight, transparent Chromium browser synchronization extension built around user-controlled storage.

Instead of operating its own synchronization server, the extension uses a **GitHub Gist selected by you** as the cloud synchronization store. Different Chromium browsers read the same Gist state, merge it with their local base snapshot, and write a new Gist revision. GitHub Gist's native revision history provides synchronization history and rollback.

## Why Chromium Cloud Sync

Traditional browser synchronization often requires a vendor account or a dedicated third-party synchronization service. Chromium Cloud Sync takes a different approach: **you control the storage, the synchronization path stays short, and the project does not operate a service that stores your synchronization data.**

The design follows a few principles:

- **Your Gist, your storage:** the extension communicates directly with your selected GitHub Gist.
- **No custom sync backend:** synchronized browser data is not routed through a project-owned server.
- **One shared synchronization state:** the current model does not maintain a device registry or device identity system.
- **GitHub revisions as history:** the extension does not create a separate history database or history file tree.
- **User-controlled automation:** automatic synchronization is disabled by default and uses a 5-minute default interval when enabled.
- **Transparent cloud data:** the current synchronization payload is stored as regular JSON without application-layer encryption.

## Features

| Feature | Description |
| --- | --- |
| Tab synchronization | Synchronize URLs, titles, pinned state, window state, and related tab information |
| Tab group synchronization | Synchronize group title, color, and collapsed state |
| Bookmark synchronization | Synchronize bookmark structure, titles, URLs, and ordering, with local bookmark tree merging |
| Extension inventory synchronization | Record installed extensions to identify extensions missing on another browser |
| Extension settings synchronization | Synchronize selected extension-local settings that the browser allows the extension to read |
| Conflict handling | Merge cloud and local state using a stored local base snapshot and record conflicts when necessary |
| Revision history | Use native GitHub Gist revisions instead of a separate history system |
| Rollback | Restore a previous Gist revision by writing it back as a new current revision |
| Automatic synchronization | Optional, disabled by default, 5-minute default interval |
| Internationalization | English and Simplified Chinese UI |
| Themes | Light and dark themes |

## Synchronization Model

The synchronization model is intentionally simple:

```text
                 GitHub Gist
                      │
             current.json + manifest.json
                      │
          ┌───────────┴───────────┐
          │                       │
      Browser A               Browser B
          │                       │
     local snapshot         local snapshot
          │                       │
          └─────── merge ─────────┘
                    │
              new revision
                    │
                    ▼
                 GitHub Gist
```

Each synchronization reads the current Gist state and combines it with the locally stored base snapshot before producing a new revision. This avoids the additional complexity of device registration, device naming, and device-specific cloud state.

## Gist Data Model

The current format uses two primary files:

```text
manifest.json
current.json
```

`manifest.json` stores synchronization format and revision metadata. `current.json` contains the actual synchronized browser state.

Historical versions are provided by GitHub Gist's native revision system rather than by additional extension-managed history files.

### Synchronized State

The current synchronization state can contain:

- Tabs and window state
- Tab group metadata
- Bookmark trees
- Installed extension inventory
- Selected readable extension settings
- Tombstones for deleted objects
- Conflict records
- Synchronization version and timestamp metadata

## Privacy and Security

### No Project-Owned Sync Server

The extension communicates directly with GitHub's API and Gist services. The project does not operate a relay or synchronization server that receives your browser synchronization data.

### Private Gists by Default

When the extension creates a new Gist, it requests a private Gist. When you connect an existing Gist, its visibility and permissions remain governed by the settings of that Gist.

### Synchronization Data Is Not Application-Layer Encrypted

The current synchronization state is stored as regular JSON in the Gist. This keeps the data structure transparent and avoids an additional encryption key-management system.

Treat **access to the Gist as access to the synchronized data**.

The project retains compatibility code for reading and migrating legacy encrypted Gists from older versions, but normal synchronization, creation, and rollback in the current version use regular JSON.

### GitHub Token

The GitHub Token is used to authenticate GitHub API and Gist requests and is stored in the browser extension's local storage. Never commit a Token, private key, PEM file, or other credentials to the repository.

## Permissions

The Manifest V3 extension currently declares the following primary permissions:

| Permission | Purpose |
| --- | --- |
| `tabs` | Read and restore tab state |
| `management` | Read the installed extension inventory |
| `storage` | Store local synchronization configuration and base snapshots |
| `alarms` | Schedule synchronization when automatic sync is enabled |
| `bookmarks` | Read, merge, and restore bookmarks |
| `tabGroups` | Read and restore tab group information |

Host permissions:

- `https://api.github.com/*` — GitHub API and Gist operations
- `https://gist.githubusercontent.com/*` — Compatibility access to Gist raw content

These permissions reflect the current `manifest.json`. Always verify the final manifest when publishing a release.

## Installation

### GitHub Releases

Download the latest release from:

<https://github.com/CYoJkoY/ChromiumCloudSync/releases>

A release provides:

```text
chromium-cloud-sync-vX.Y.Z.zip
chromium-cloud-sync-vX.Y.Z.crx
SHA256SUMS.txt
```

The **ZIP** package can be loaded through Chromium's developer mode and can also be used as a package for Chrome Web Store submission.

The **CRX** package is intended for direct distribution or third-party platforms that support CRX files. Browser installation behavior may vary by Chromium distribution, enterprise policy, and browser version.

### Load as an Unpacked Extension

1. Open `chrome://extensions/` or the equivalent extension management page in your Chromium-based browser.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Select the project directory.

## Configure GitHub Gist

1. Create a GitHub Token with appropriate permissions for your intended Gist operations.
2. Enter the Token in the extension settings.
3. Verify the Token.
4. Create a new synchronization Gist or bind an existing Chromium Cloud Sync Gist.
5. Use **Sync Now** to verify that read and write operations work correctly.
6. Enable automatic synchronization only when you need background synchronization.

Use a GitHub Token with the narrowest practical permissions and rotate it periodically.

## Automatic Synchronization

Automatic synchronization is optional and disabled by default.

Default settings:

```text
Automatic sync: Off
Sync interval:   5 minutes
```

When automatic synchronization is disabled, no background synchronization is triggered. The configured interval is retained and can be used when automatic synchronization is enabled again.

## History and Rollback

GitHub Gist provides native revision history, so the extension does not create `history/*` or other extension-managed history files.

The synchronization history page can be used to:

- View Gist revisions
- Identify the current revision
- Inspect timestamps and revision authors
- Check unresolved synchronization conflicts
- Restore a previous revision as a new current revision

Rollback does not delete GitHub's existing revision history. Instead, the selected historical state is written back as a new revision.

## Known Limitations

- Restricted browser pages such as some `chrome://` pages cannot be read or restored.
- Different Chromium distributions may differ in extension management, restricted URLs, and tab group capabilities.
- Extension settings synchronization only covers local extension storage that the browser allows this extension to read. Full settings synchronization is not guaranteed for every extension.
- Installing extensions is still controlled by the user and the browser. The project provides missing-extension detection and installation entry points rather than silently installing extensions.
- GitHub Gist is a third-party service, so availability, permissions, and retention are subject to GitHub's service policies.

## Development

The project uses native JavaScript and Manifest V3 without a large frontend framework.

Requirements:

- Node.js 24+
- A Chromium-based browser with Manifest V3 support

Validate the project:

```bash
npm run validate
```

Build the release ZIP:

```bash
npm run build:zip
```

## Automated Releases

Releases can be created automatically from semantic version tags using GitHub Actions.

For example:

```bash
git tag v1.5.15
git push origin v1.5.15
```

The release workflow can:

1. Verify that the tag version matches `manifest.json`.
2. Run project validation.
3. Build the ZIP package.
4. Verify the ZIP contents.
5. Generate a CRX3 package using a fixed signing key stored in a repository secret.
6. Generate SHA-256 checksums.
7. Create a GitHub Release containing the ZIP, CRX, and checksum file.

The CRX signing private key must **never** be committed to the repository. Store it in a GitHub Actions secret such as:

```text
CRX_PRIVATE_KEY_B64
```

## Project Structure

```text
ChromiumCloudSync/
├── .github/workflows/release.yml
├── _locales/
├── icons/
├── background.js       # GitHub Gist, synchronization, and restore logic
├── sync-core.js        # State merging, tombstones, and conflict handling
├── popup.html/js       # Popup UI
├── options.html/js     # Settings UI
├── history.html/js     # Gist revision history
├── guide.html/js       # Built-in user guide
├── i18n.js             # Internationalization
├── theme.js            # Theme management
├── runtime.js          # Runtime request wrapper
├── ui.css              # UI styling
├── manifest.json       # Manifest V3
└── scripts/
    ├── build.mjs
    └── validate.mjs
```

## Contributing

Issues and pull requests are welcome.

When contributing, please:

- Keep the synchronization model simple and explainable.
- Avoid reintroducing device registration or device-level cloud state unless there is a strong design reason.
- Never submit Tokens, private keys, PEM files, or personal Gist data.
- Update the README and privacy documentation when permissions change.
- Consider compatibility and migration behavior when modifying the synchronization data format.

## License

This project is licensed under the **MIT License**. See [LICENSE](LICENSE) for details.
