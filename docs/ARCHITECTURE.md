# Contributor Guide

This guide explains where to make a change, how data moves through Chromium Cloud Sync, and how to verify it. The project is a Manifest V3 browser extension. Chromium APIs are its runtime; it does not require a local server or a project-operated backend.

## Get a working build

Requirements: Node.js 22 or later, npm, and Chromium for the browser smoke test. CI currently uses Node.js 22.

```sh
npm install
npm run build
```

The build writes the unpacked extension to `dist/`. In Chromium, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist/`. Changes to TypeScript require another build and an extension reload.

Useful checks: `npm run typecheck` for the strict TypeScript project, `npm test` for the unit and contract tests, `npm run validate` for the complete source/build/package validation, and `npm run smoke` for a real Chromium load and runtime ping. The smoke test needs Playwright Chromium; install it with `npx playwright install chromium`.

## First use: sync

Browser-state sync stores bookmarks, tab-group data and third-party extension inventory metadata. It does not copy another extension's private settings or files.

### Synchronize browser state

1. Open the extension's **Settings** page and choose **GitHub Gist**, **Google Drive**, or **WebDAV** under **Cloud sync provider**.
2. Complete that provider's connection: validate a GitHub token and save or create the Gist; authorize Google Drive in the browser; or enter the WebDAV URL and any credentials, save, and test the connection. Credentials stay on this device.
3. Choose **Sync now**. Automatic sync is off by default; enable and save it in the same Settings panel if you want background runs. The popup reports provider binding, last sync time, revision, conflicts, and automatic-sync state.

The first sync merges browser state according to the sync rules; it is not a full profile clone. Standalone tabs and whole-window layouts are not synchronized.

## Find the right place

```text
src/
├── runtime/     Sync orchestration, domain rules, storage, schema, providers
├── features/    Update capabilities
└── ui/          Popup, options, history, guide, extension recovery pages
scripts/         Build, validation, smoke test, and focused test runners
docs/            Contributor and architecture notes
```

| Change | Start here | Keep the responsibility here |
| --- | --- | --- |
| Merge, tombstone, checksum rule | `src/runtime/sync-core.ts` | Pure sync-domain logic |
| Cloud file layout or module revisions | `src/runtime/sync-modules.ts` | Split/combine and modular state rules |
| Cloud payload validation or migration | `src/runtime/schema.ts` | External data boundary and schema lifecycle |
| Local extension storage | `src/runtime/storage.ts` | Serialized `chrome.storage.local` access |
| Provider-independent remote protocol | `src/runtime/cloud-files.ts` | `FileStore` protocol and modular read/write |
| Provider transport or authorization | `src/runtime/cloud-gist.ts`, `cloud-gdrive.ts`, `cloud-webdav.ts` | One provider adapter |
| Browser API collection and orchestration | `src/runtime/background.ts` | MV3 composition root and message/alarm handling |
| Screen behavior or wording | Matching `src/ui/` module and page | Presentation, user actions, localization |

The runtime is statically composed by `background.ts`; there is no generic third-party plugin loader. Keep new behavior in its owning module and connect it through an existing interface where possible. The core sync rules should not import UI, provider SDKs, or browser-specific transport code.

## How synchronization works

```text
Browser events / scheduled alarm / user action
        ↓
background.ts collects local state and selects a provider
        ↓
FileStore adapter reads remote files
        ↓
schema.ts validates and migrates external state
        ↓
sync-modules.ts combines module files; sync-core.ts merges snapshots
        ↓
background.ts writes changed modules and verifies the remote revision
        ↓
storage.ts and diagnostics.ts persist local state and outcome
```

`background.ts` is the composition root: it reads settings, chooses an adapter, collects browser data, and coordinates the sync use case. `cloud-files.ts` defines the provider-neutral `FileStore` contract (`read`, `write`, `remove`, `list`, and optional history). Gist, Drive, and WebDAV implement that contract; they do not call each other.

The synchronized state is split into extensions, bookmarks, and tabs. `sync-modules.ts` owns the file layout, per-module revisions, change detection, split/combine operations, and legacy conversion. `sync-core.ts` owns deterministic merge behavior, tombstones, conflicts, and checksums. `schema.ts` treats remote JSON as untrusted input, migrates supported older shapes forward, and rejects unsupported future versions.

The remote write path uses optimistic concurrency: read, merge against the local base, write changed files, then read back and verify revision and checksum. A mismatch is handled as a remote change and merged again; a write is not considered successful solely because the provider accepted it. MV3 workers may stop while idle, so durable state belongs in extension storage rather than module globals. `storage.ts` serializes mutations to avoid overlapping read-modify-write operations.

## Provider and data boundaries

Provider adapters translate the common file protocol into provider-specific requests and history behavior. Provider authorization stays in its adapter and settings flow. The Gist token source is registered by the composition root; Drive uses browser-managed OAuth when available and has an explicit manual fallback; WebDAV uses configured origin credentials.

Credentials must not enter synchronized payloads. `cloud-files.ts` checks modular writes for credential-shaped keys, and schema validation runs before remote state reaches merge logic. Preserve those boundaries when adding fields or transport behavior.

## Common change recipes

### Add a synchronized resource

1. Define its domain shape in `src/runtime/types.ts` and include it in the snapshot.
2. Add validation and a forward migration in `schema.ts` where needed.
3. Add its module ownership and split/combine behavior in `sync-modules.ts`.
4. Implement collection and restore at the browser boundary in `background.ts` or a focused runtime module.
5. Add merge/tombstone behavior in `sync-core.ts` only when the resource requires distinct semantics.
6. Cover round-trip, migration, merge, and failure behavior with focused tests before exposing it in the UI.

### Add a cloud provider

Implement `FileStore` in a provider module. Keep authentication and request translation there, register the adapter in `background.ts`, and test the shared protocol against a recording in-memory store. Provider-specific history may implement the optional history contract. Do not duplicate modular layout, schema, or merge rules in the adapter.

### Change the UI

Keep rendering and user interaction in the matching `src/ui/` module. Use the existing runtime message boundary for worker operations, update both locale message files when adding visible text, and add or adjust the focused DOM-shim test when behavior is covered there. Avoid moving sync rules into page scripts.

## Tests and diagnosis

Tests are executable TypeScript scripts under `scripts/`. Run the narrow test while iterating, then run `npm test` or `npm run validate` before delivery. Important suites include:

- `test-sync-core.ts`, `test-sync-invariants.ts`, `test-schema.ts`, and `test-storage.ts` for merge, invariants, migration, and local mutation ordering.
- `test-sync-modules.ts` and `test-cloud-files.ts` for modular layout, legacy conversion, provider protocol, and changed-file behavior.
- `test-gdrive-auth.ts` for Drive authorization paths.
- `npm run smoke` for loading the built extension in Chromium and checking its runtime connection.

For sync failures, inspect the popup status and the latest diagnostics before changing merge behavior. `diagnostics.ts` records the result category, revision context, changed counts, and failure details. Reproduce provider behavior with mocks or an in-memory `FileStore`; tests should not need a real account, token, or cloud write.
