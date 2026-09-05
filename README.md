<div align="center" style="background-color: #1E1E1E; padding: 40px 20px; border-radius: 28px;">
  <div style="background: #2A2A2A; border-radius: 36px; padding: 28px 18px; margin-bottom: 28px;">
    <img src="assets/readme/hero.svg?v=2" alt="Chromium Cloud Sync architecture" width="960">
    <h1 style="color: #E6DED6; font-weight: 350; letter-spacing: 2px; margin: 18px 0 8px;">Chromium Cloud Sync</h1>
    <p style="color: #BEB8AE; font-size: 1.2em; max-width: 720px; margin: 0 auto;">A Chromium extension for keeping tabs, tab groups, bookmarks, installed extensions, and extension settings synchronized through your own GitHub Gist.</p>
    <p style="color: #8A9E8B; font-size: 0.95em; margin-top: 12px;">Manifest V3 · JavaScript · GitHub Gist · WebDAV · Local-first merge &amp; history</p>
  </div>
  <p>
    <a href="https://github.com/CYoJkoY/ChromiumCloudSync/actions"><img src="https://img.shields.io/badge/CI-GitHub_Actions-8A9E8B?style=flat-square&logo=github" alt="GitHub Actions"></a>
    <a href="manifest.json"><img src="https://img.shields.io/badge/Manifest-V3-7A8E8E?style=flat-square" alt="Manifest V3"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-GPL--3.0-9E8F7E?style=flat-square" alt="GPL-3.0-only"></a>
    <img src="https://img.shields.io/badge/Platform-Chromium-8A9E8B?style=flat-square" alt="Chromium">
    <a href="https://github.com/CYoJkoY/ChromiumCloudSync/releases"><img src="https://img.shields.io/github/v/release/CYoJkoY/ChromiumCloudSync?style=flat-square&color=7A8E8E" alt="Latest release"></a>
  </p>
  <p style="word-spacing: 6px; margin-top: 20px;">
    <a href="#-overview" style="color: #8A9E8B; text-decoration: none; border-bottom: 1px dotted #5A6B6B;">Overview</a> &nbsp;•&nbsp;
    <a href="#-core-features" style="color: #8A9E8B; text-decoration: none; border-bottom: 1px dotted #5A6B6B;">Features</a> &nbsp;•&nbsp;
    <a href="#-installation--setup" style="color: #8A9E8B; text-decoration: none; border-bottom: 1px dotted #5A6B6B;">Installation</a> &nbsp;•&nbsp;
    <a href="#-configuration--parameters" style="color: #8A9E8B; text-decoration: none; border-bottom: 1px dotted #5A6B6B;">Configuration</a> &nbsp;•&nbsp;
    <a href="#-implementation-highlights" style="color: #8A9E8B; text-decoration: none; border-bottom: 1px dotted #5A6B6B;">Implementation</a> &nbsp;•&nbsp;
    <a href="#-contributing--feedback" style="color: #8A9E8B; text-decoration: none; border-bottom: 1px dotted #5A6B6B;">Contributing</a>
  </p>
</div>

## 📖 Overview

**Chromium Cloud Sync** is a Manifest V3 browser extension designed around a simple storage model: Chromium holds the local state, while a **private GitHub Gist** acts as the shared synchronization boundary.

The extension synchronizes useful browser state across machines without requiring a project-operated sync server. It can collect and restore tabs, windows, tab groups, bookmarks, installed extensions, and extension-local settings. A separate backup backend can also store third-party extension **CRX / ZIP** packages in a private GitHub repository or through WebDAV.

The synchronization engine keeps a local base snapshot and uses that snapshot to distinguish unchanged data, remote-only changes, local-only changes, and real conflicts. It also maintains revisions, rollback history, deletion tombstones, and checksums so the sync process remains inspectable rather than behaving like a blind overwrite.

> **Note**  
> The current sync format stores `current.json` in the configured private Gist. The repository also contains a compatibility reader for the encrypted format used by older releases. Do not assume the current Gist payload is end-to-end encrypted merely because legacy encrypted-state support exists.

---

## ✨ Core Features

### 🗂️ Browser State Sync
- Synchronize open `tabs`, `windows`, and `tab groups`.
- Synchronize `bookmarks` using stable local sync IDs.
- Synchronize installed third-party extensions and their metadata.
- Synchronize extension-local settings while excluding Chromium Cloud Sync's own control state.

### 🔄 Deterministic Merge &amp; Conflict Handling
- Three-way merge against a stored base snapshot.
- Field-level `latest`, `maxVersion`, and manual conflict policies.
- Deletion tombstones prevent removed entities from silently reappearing.
- Unresolved conflicts remain visible in the history interface.

### 🕘 Revision History &amp; Rollback
- Keep a local index of recent synchronization revisions.
- Inspect synchronization history from a dedicated history page.
- Roll back to a previous GitHub revision.
- Keep the latest 30 history entries in the local history index.

### 📦 Third-party Extension Package Storage
- Store extension `.crx` and `.zip` packages outside the synchronization Gist.
- Use a **private GitHub repository** or **WebDAV** as the package backend.
- Track package hashes, versions, metadata, and storage paths.
- Browser-side GitHub uploads are rejected above `95 MB`.
- Package installation remains a manual user action.

### 🌐 Localized &amp; Theme-aware UI
- Simplified Chinese and English locale files.
- Explicit light and dark themes.
- Dedicated popup, settings, user guide, and synchronization history pages.
- Reduced-motion support for theme transitions.

---

## 🚀 Installation &amp; Setup

### 1. Install from a release

Download the latest release assets from the repository's **Releases** page. Releases are built as both a ZIP package and a signed CRX3 package, together with SHA-256 checksums.

### 2. Load the extension manually

For development or when using the ZIP package:

1. Open your Chromium-based browser's extension management page.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select the project directory.
4. Open **Chromium Cloud Sync** from the extensions toolbar.

The manifest targets **Manifest V3** and exposes the extension popup through `popup.html` and the configuration page through `options.html`.

### 3. Configure GitHub Gist sync

Create a GitHub access token suitable for the Gist operations you intend to use, then configure it in **Settings**.

```text
GitHub Token → Validate token
             ↓
          Create Gist
             or
        Bind existing Gist
             ↓
           Sync now
```

The sync Gist is created as a **private Gist**. The extension stores the configured token and Gist identifier in `chrome.storage.local` so subsequent synchronization can run without re-entering credentials.

> ⚠️ **Security**  
> Treat the GitHub token as a secret. Use the minimum permissions necessary for your account and revoke or rotate the token if it is exposed.

### 4. Enable automatic synchronization

Automatic synchronization is disabled by default. In **Settings**, enable it and select an interval in minutes. The built-in default interval is **5 minutes**.

---

## ⚙️ Configuration &amp; Parameters

### Synchronization state

| Setting | Default | Purpose |
|---|---:|---|
| Auto sync | Disabled | Periodically synchronize browser state. |
| Auto sync interval | `5 min` | Interval used by the background alarm. |
| Sync schema | `10` | Current internal synchronization schema. |
| History entries | `30` | Maximum number of local history index entries kept. |

### Synchronizable data

| Data | Behavior |
|---|---|
| Tabs / windows | Restores normal Chromium windows and HTTP(S) tabs; restricted browser URLs are skipped. |
| Tab groups | Preserves group title, color, collapsed state, and stable sync identity. |
| Bookmarks | Flattened into sync entities with stable local IDs and restored through merge logic. |
| Extensions | Synchronizes extension metadata and can detect missing extensions. |
| Extension settings | Synchronizes local extension storage while excluding Chromium Cloud Sync's own control keys. |
| CRX / ZIP packages | Optional separate backup through GitHub private repositories or WebDAV. |

### Extension package storage

The package storage backend is independent from the synchronization Gist. The available modes are:

```text
disabled
   │
   ├── github  → private GitHub repository / optional branch / optional folder
   │
   └── webdav  → configurable WebDAV endpoint / optional folder / optional Basic auth
```

GitHub package storage uses the Contents API and rejects packages larger than `95 MB`. Package metadata includes the extension ID, version, file name, format, byte size, SHA-256 hash, storage path, and timestamp.

---

## 🧠 Implementation Highlights

### Local-first three-way merge

The core merge engine in `sync-core.js` compares **base**, **local**, and **remote** snapshots. If one side is unchanged from the base, the other side wins without producing an artificial conflict. When both sides changed the same field, the merge policy determines whether the value is resolved automatically or exposed as a manual conflict.

### Stable synchronization identities

Browser-local tab, window, group, and bookmark IDs are not treated as global identities. The extension keeps local ID maps in `chrome.storage.local` and assigns stable synchronization IDs such as `tab-*`, `window-*`, `group-*`, and `bookmark-*`.

### Tombstones &amp; deletion tracking

Deleted entities are represented by tombstones containing the collection, sync ID, deletion timestamp, and revision. Tombstones are merged across sources and applied after state aggregation.

### Backward compatibility

The background worker can read several historical Gist layouts, including the older encrypted `current.enc.json` format. Legacy state is normalized into the current schema before synchronization processing.

### GitHub Gist as the synchronization boundary

```text
manifest.json   → schema / format / current file / revision metadata
current.json    → current normalized synchronization state
```

---

## 📁 Project Structure

```tree
ChromiumCloudSync/
├── 📁 .github
│   └── 📁 workflows
│       └── ⚙️ release.yml
├── 📁 _locales
│   ├── 📁 en
│   │   └── 📄 messages.json
│   └── 📁 zh_CN
│       └── 📄 messages.json
├── 📁 assets
│   └── 📁 readme
│       └── 🖼️ hero.svg
├── 📁 icons
│   ├── 🖼️ icon.svg
│   ├── 🖼️ icon16.png
│   ├── 🖼️ icon32.png
│   ├── 🖼️ icon48.png
│   ├── 🖼️ icon128.png
│   ├── 🖼️ icon256.png
│   └── 🖼️ icon512.png
├── 📁 scripts
│   ├── 📄 build.mjs
│   └── 📄 validate.mjs
├── 📄 background.js
├── 📄 extension-storage.js
├── 📄 extension-storage-layout.js
├── 📄 extension-storage-watch.js
├── 📄 guide.html
├── 📄 guide.js
├── 📄 history.html
├── 📄 history.js
├── 📄 i18n.js
├── 📄 legacy-crypto.js
├── 📄 manifest.json
├── 📄 options.html
├── 📄 options.js
├── 📄 package.json
├── 📄 popup.html
├── 📄 popup-i18n.js
├── 📄 popup.js
├── 📄 runtime.js
├── 📄 sync-core.js
├── 📄 theme.js
├── 📄 ui-overrides.css
├── 📄 ui.css
├── 📄 update.js
├── 📄 LICENSE
└── 📄 README.md
```

---

## 🛠️ Development

The project does not use a frontend framework or a runtime package dependency. It is a browser extension composed of native JavaScript, HTML, and CSS.

A recent Node.js installation is used for validation and release packaging.

### Validate the project

```bash
npm run validate
```

### Build the release ZIP

```bash
npm run build:zip
```

The release workflow validates the project, builds the ZIP package, verifies its contents, creates a signed CRX3 package, generates SHA-256 checksums, and publishes the release assets.

> **Note**  
> Signed CRX builds require the repository secret `CRX_PRIVATE_KEY_B64` to contain the base64-encoded CRX signing key.

---

## 🔐 Security Notes

Chromium Cloud Sync keeps the synchronization backend under the user's own GitHub account rather than introducing a project-operated sync server.

However, this does **not** make all synchronized data end-to-end encrypted. In the current format, the sync payload is written to a private Gist as JSON. Access to the Gist and the configured GitHub token therefore matters directly to confidentiality.

The extension also stores its GitHub token in `chrome.storage.local`. Anyone who can execute code with access to that extension's storage context may be able to access the token. Avoid reusing privileged tokens for unrelated GitHub tasks.

The extension filters out non-HTTP(S) tab URLs before building a snapshot, which avoids trying to synchronize browser-internal or otherwise restricted pages.

---

## 🤝 Contributing &amp; Feedback

Issues and pull requests are welcome.

For bug reports, include the browser version, extension version, synchronization direction, and any visible conflict or error message. Do not paste GitHub tokens, private Gist contents, WebDAV passwords, or other credentials into issues.

For synchronization bugs, the most useful information is usually the affected collection (`tabs`, `bookmarks`, `extensions`, or `windows`), whether the data changed locally and remotely, and whether the problem is reproducible after a fresh synchronization.

---

## 📄 License

Chromium Cloud Sync is licensed under the **GNU General Public License v3.0 only (GPL-3.0-only)**.

See [`LICENSE`](LICENSE) for the complete license text.

---

## 💰 Support the Author

If this project improves your workflow, consider buying the author a coffee.

<div align="center">
  <a href="https://cyojkoy.github.io/Payment/">
    <img src="https://img.shields.io/badge/Support_the_Author-9E8F7E?style=for-the-badge&logo=buy-me-a-coffee&logoColor=BEB8AE" alt="Support the Author">
  </a>
</div>

---

<div align="center">
  <sub>Built for users who want synchronization without giving up control over where their browser state is stored.</sub>
</div>
