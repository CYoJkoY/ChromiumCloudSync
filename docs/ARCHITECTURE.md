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

`sync-core.js` owns merge and conflict behavior. Domain functions should not depend on DOM APIs.

### Platform adapters

Chromium APIs remain at the extension boundary: tabs, windows, tab groups, bookmarks, management, storage, alarms, and downloads.

### Transport

GitHub API access is an explicit adapter boundary. Authentication material is read from extension storage and is never embedded in UI markup.

### Persistence

`chrome.storage.local` is the primary settings and state persistence layer. The private Gist is the remote synchronization store. IndexedDB or SQLite should only be introduced when the workload demonstrates a real need for structured/local-scale data beyond extension storage.

## Frontend direction

The extension uses native HTML/CSS/JavaScript today. This is intentionally retained for existing surfaces while the codebase is gradually moved toward explicit module boundaries.

For future substantial UI work:

- use TypeScript when cross-context contracts or shared domain models become difficult to maintain in JavaScript;
- keep content/page integration native and narrow;
- use a UI framework only for a surface whose state and component reuse demonstrably justify it;
- define message types and response semantics before adding new runtime messages.

## Message contract

New cross-context messages should follow a stable shape:

```js
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

Do not rewrite the whole extension merely to introduce a new stack. Refactor by boundary:

```text
existing JS
  → explicit modules
  → shared contracts
  → TypeScript for high-value boundaries
  → framework only where state complexity proves it necessary
```

This keeps the extension maintainable without adding runtime or dependency weight that the product does not need.
