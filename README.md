<div align="center">
  <img src="icons/icon128.png" width="96" height="96" alt="Chromium Cloud Sync icon">
  <h1>Chromium Cloud Sync</h1>
  <p>Browser synchronization built around GitHub Gist, without a dedicated sync server.</p>

  <a href="https://github.com/CYoJkoY/ChromiumCloudSync/actions/workflows/release.yml"><img src="https://github.com/CYoJkoY/ChromiumCloudSync/actions/workflows/release.yml/badge.svg?branch=main" alt="Release workflow"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/CYoJkoY/ChromiumCloudSync" alt="License"></a>
  <a href="https://github.com/CYoJkoY/ChromiumCloudSync/releases"><img src="https://img.shields.io/github/v/release/CYoJkoY/ChromiumCloudSync" alt="Latest release"></a>
  <a href="https://github.com/CYoJkoY/ChromiumCloudSync"><img src="https://img.shields.io/github/stars/CYoJkoY/ChromiumCloudSync?style=flat" alt="GitHub stars"></a>
</div>

I built Chromium Cloud Sync because I wanted browser synchronization without introducing another account, another backend, or another opaque service into the stack.

The idea is deliberately straightforward: **GitHub Gist is the storage layer, Chromium is the client, and the extension is responsible for collecting, merging, and restoring state.** There is no synchronization server operated by this project.

This is not an attempt to reproduce every feature of a vendor browser account. It is a focused synchronization tool for people who want control over where their browser state is stored and who are comfortable managing their own GitHub access.

## What I Am Building

The project is centered around one shared synchronization state.

Each browser reads the current Gist, compares it with its locally stored base snapshot, merges the changes, and writes the resulting state back as a new Gist revision.

```text
Browser A ──┐
            ├── read ──> GitHub Gist ──> merge ──> new revision
Browser B ──┘                  ▲
                               │
                         current.json
                         manifest.json
```

I intentionally do not maintain a device registry, device-specific cloud state, or an extension-owned history database. Those systems add a lot of state and failure modes for comparatively little value in this project. GitHub's native Gist revisions already provide the history layer I need.

## What Gets Synchronized

Chromium Cloud Sync currently focuses on the browser state that is useful when moving between installations:

| Area | What is synchronized |
| --- | --- |
| Tabs | URLs, titles, pinned state, active state, window state, and tab group metadata |
| Tab groups | Titles, colors, and collapsed state |
| Bookmarks | Bookmark trees, titles, URLs, ordering, and local-tree merging |
| Extensions | Installed extension inventory for cross-browser comparison |
| Extension settings | Selected extension-local storage that Chromium allows the extension to read |
| Sync metadata | Revision information, timestamps, tombstones, and conflict records |

The extension does not silently install missing extensions. It can identify missing extensions and open their installation pages, but the final installation decision stays with the browser and the user.

## Why GitHub Gist?

I chose Gist for a practical reason: it gives the project a simple remote persistence layer without forcing me to operate infrastructure.

That gives me a very small architecture:

```text
Chromium Cloud Sync
        │
        ├── Chromium APIs
        │
        ├── Local base snapshot
        │
        └── GitHub API
                 │
                 ▼
              GitHub Gist
                 │
                 └── native revisions
```

There is no project-owned API endpoint sitting between the browser and GitHub. That makes the synchronization path easier to understand, easier to debug, and easier for users to inspect.

## Data Model

The current Gist format is intentionally small:

```text
manifest.json
current.json
```

`manifest.json` describes the synchronization format and revision metadata.

`current.json` contains the current shared synchronization state.

I do not create separate `history/*` files. Historical versions come from GitHub Gist revisions, and rollback means writing a selected historical state back as a new revision instead of deleting or rewriting the existing history.

## Conflict Handling

Synchronization is not a blind overwrite operation.

The extension keeps a local base snapshot so it can reason about what changed locally and what changed remotely. During synchronization, those states are merged and unresolved conflicts are recorded instead of being silently discarded.

The design goal is not to pretend conflicts do not exist. The goal is to make them visible and keep the synchronization state recoverable.

That is also why the history page is part of the core UI rather than a debugging-only screen.

## Privacy and Security

I deliberately keep the trust model simple.

### No project-owned sync service

Your synchronized browser data is sent directly to GitHub through the GitHub API/Gist service. This repository does not operate a synchronization backend that receives or stores your browser state.

### Private Gists by default

When the extension creates a new synchronization Gist, it requests a private Gist. Existing Gists keep their own visibility and access configuration.

### Plain JSON storage

The current synchronization format is stored as normal JSON. I removed application-layer encryption from the current synchronization path because I preferred a transparent data model and fewer recovery/key-management failure modes.

That means the security boundary is explicit:

> **Anyone who can access the synchronization Gist can access the synchronized browser state.**

Older encrypted Gists remain readable through compatibility-only migration code so that users can move forward without abandoning their existing synchronization data.

### GitHub Token

The GitHub Token is stored locally in the extension and is used to authenticate GitHub API requests. Do not commit tokens, private keys, PEM files, or personal Gist data to this repository.

## Installation

### GitHub Releases

Releases are published here:

<https://github.com/CYoJkoY/ChromiumCloudSync/releases>

A normal release contains:

```text
chromium-cloud-sync-vX.Y.Z.zip
chromium-cloud-sync-vX.Y.Z.crx
SHA256SUMS.txt
```

The ZIP is the primary package for development and manual unpacked installation.

The CRX is provided for environments and distribution channels that accept CRX packages.

### Load the extension manually

1. Open `chrome://extensions/` or the equivalent extensions page in your Chromium-based browser.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select the project directory.

## First-Time Setup

The intended setup is deliberately short:

1. Open the extension settings.
2. Enter a GitHub Token that can access Gists.
3. Validate the Token.
4. Create a new synchronization Gist or bind an existing one.
5. Run **Sync now** once to verify the connection.
6. Enable automatic synchronization only if background synchronization is actually needed.

New Gists created by the extension are private by default.

## Automatic Synchronization

Automatic synchronization is optional and disabled by default.

The default interval is five minutes. The interval can be changed independently of the enabled/disabled state.

```text
Automatic sync: Off
Default interval: 5 minutes
```

The purpose of keeping automatic synchronization disabled by default is simple: synchronization should happen because the user wants it to, not because the extension assumes it should run in the background.

## Updates from GitHub Releases

I intentionally chose GitHub Releases as the primary distribution channel instead of making Chrome Web Store a project requirement.

The extension checks the repository's latest GitHub Release and can notify the user when a newer version is available. The release workflow also produces a CRX using a stable signing key so consecutive releases keep the same extension identity.

The expected release flow is:

```text
git tag v1.5.15
        ↓
GitHub Actions
        ↓
validate
        ↓
build ZIP
        ↓
build signed CRX3
        ↓
create GitHub Release
        ↓
extension detects newer Release
```

For normal users, this is a **download-and-update workflow**, not an attempt to bypass Chromium's installation policies. Chromium can restrict automatic installation of self-hosted extensions depending on the browser and installation context.

## History and Rollback

GitHub Gist's native revision history is part of the design.

The history page lets me expose:

- previous Gist revisions
- the current revision
- revision timestamps and authors
- unresolved synchronization conflicts
- rollback to a previous state

A rollback creates a new revision from the selected historical state. Existing GitHub history is not erased.

## Supported Browser Model

The project targets Chromium-based browsers that support Manifest V3 and the APIs used by the extension.

The actual behavior of extension management, restricted URLs, tab groups, and installation policies can vary between Chrome, Chromium, Edge, and other Chromium distributions. The extension therefore avoids pretending that every Chromium browser behaves identically.

## Known Limitations

There are several limitations I consider intentional rather than bugs:

- Restricted pages such as some `chrome://` URLs cannot be synchronized.
- Extension-local settings are limited to storage that Chromium allows this extension to inspect.
- Extension installation remains a user/browser-controlled operation.
- GitHub availability and Gist behavior are external dependencies.
- GitHub access is the trust boundary for the plain-JSON synchronization state.

## Development

The project is intentionally small and uses native JavaScript with Manifest V3 rather than a large frontend framework.

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

## Release Engineering

Releases are built by GitHub Actions from semantic version tags.

```bash
git tag v1.5.15
git push origin v1.5.15
```

The workflow validates the version, builds the ZIP, verifies its contents, creates a CRX3 package, calculates SHA-256 checksums, and publishes the GitHub Release artifacts.

The CRX signing key must remain stable across releases and must never be committed to the repository. The workflow expects it through the repository secret:

```text
CRX_PRIVATE_KEY_B64
```

## Project Structure

```text
ChromiumCloudSync/
├── .github/workflows/release.yml
├── _locales/
├── icons/
├── background.js       # GitHub/Gist integration and synchronization lifecycle
├── sync-core.js        # State merging, tombstones, and conflict handling
├── update.js           # GitHub Release update detection
├── popup.html/js       # Popup interface
├── options.html/js     # Settings interface
├── history.html/js     # Revision history and rollback interface
├── guide.html/js       # Built-in user guide
├── i18n.js             # Localization
├── theme.js            # Theme management
├── runtime.js          # Runtime messaging helpers
├── ui.css              # Base UI styles
├── ui-overrides.css    # Layout and responsive refinements
├── manifest.json       # Manifest V3 definition
└── scripts/
    ├── build.mjs
    └── validate.mjs
```

## Design Principles

I would rather keep this project understandable than turn it into a general-purpose synchronization platform.

That means I intentionally favor:

1. A single shared synchronization state over per-device cloud state.
2. GitHub's own revision history over a custom history database.
3. Plain, inspectable JSON over an additional application-layer cryptographic protocol.
4. Explicit conflict records over silent last-write-wins behavior.
5. Small native browser code over a heavy application framework.
6. User-controlled installation and automation over hidden background behavior.

These choices are part of the project's architecture, not temporary shortcuts.

## Contributing

Issues and pull requests are welcome.

When changing the project, please keep the core model intact unless the change has a clear reason to make the synchronization system more complex.

In particular:

- Do not commit credentials or signing keys.
- Do not upload personal Gist data.
- Keep permissions synchronized with the actual feature set.
- Preserve migration paths when changing the Gist schema.
- Update the README when a user-visible architectural decision changes.

## License

Chromium Cloud Sync is released under the **MIT License**. See [LICENSE](LICENSE).