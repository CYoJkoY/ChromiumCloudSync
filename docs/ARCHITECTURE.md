# Chromium Cloud Sync Architecture

Chromium Cloud Sync is a Manifest V3 extension. The browser is the runtime; no embedded browser, local server, or database server is required.

## Runtime model

```text
Chromium
└── Extension
    ├── Content / page-facing work
    ├── Background service worker
    │   ├── sync orchestration
    │   ├── Chromium privileged APIs
    │   └── GitHub transport
    ├── Popup
    ├── Options
    ├── History / Guide / Extensions pages
    └── Shared domain modules
        ├── sync-core
        ├── snapshot normalization
        └── storage / transport adapters
```

The architecture deliberately keeps the browser extension runtime as the only always-on platform runtime. Go/Rust, a local HTTP service, SQLite, Electron, and other additional process boundaries are not required by the current product model.

## Responsibility boundaries

### UI

Popup and settings pages own presentation, user interaction, accessibility semantics, locale selection, and theme state.

### Orchestration

The background service worker coordinates snapshot collection, merge policy, persistence, GitHub reads/writes, alarms, and recovery flows.

### Domain logic

`sync-core.ts` owns merge and conflict behavior. Domain functions do not depend on DOM APIs.

### Platform adapters

Chromium APIs remain at the extension boundary: tabs, windows, tab groups, bookmarks, management, storage, alarms, and downloads.

### Transport

GitHub API access is an explicit adapter boundary. Authentication material is read from extension storage and is never embedded in UI markup.

### Persistence

`chrome.storage.local` is the primary settings and state persistence layer. The private Gist is the remote synchronization store. IndexedDB or SQLite should only be introduced when the workload demonstrates a real need for structured/local-scale data beyond extension storage.

## TypeScript build model

The repository contains TypeScript source only for executable application and tooling code. Browser JavaScript is generated during the build and ignored by Git so the extension can still be loaded by Chromium and packaged for release.

```text
TypeScript source (*.ts)
        │
        ▼
   TypeScript compiler
        │
        ├── .build/*.js  temporary compiler output
        ▼
   root runtime *.js   generated + ignored
        │
        ├── Chromium service worker
        └── HTML script entrypoints
```

The generated root JavaScript preserves the existing filenames and execution order. This keeps the Manifest V3 runtime contract, global script boundaries, and storage/sync behavior unchanged while moving the editable source to TypeScript.

`npm run build:extension` prepares the ignored runtime files. `npm run build:zip` additionally packages the same runtime into a release ZIP.

## Message contract

New cross-context messages should follow a stable shape:

```ts
{
  type: 'namespace.action',
  requestId: 'uuid',
  payload: {},
  version: 1
}
```

Responses should make success and failure explicit rather than relying on loosely structured ad-hoc objects.

## Performance rules

Content scripts and DOM-facing work must remain narrow. Prefer event-driven background work over polling. Avoid broad page observers and repeated full-tree scans. UI animation should use `transform` and `opacity`; theme changes must not animate the entire application tree.

## Migration rule

The TypeScript migration is source/build-only. It does not change the product runtime model, sync protocol, storage boundary, or UI framework.

```text
existing JavaScript source
        ↓
same source logic as TypeScript
        ↓
compiler-generated browser JavaScript
        ↓
existing Manifest V3 entrypoints
```

Future changes should use TypeScript for shared contracts and domain logic while keeping the browser-extension runtime narrow and native unless a concrete product requirement justifies additional framework or process complexity.
