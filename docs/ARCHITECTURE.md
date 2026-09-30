# Chromium Cloud Sync Architecture

Chromium Cloud Sync is a Manifest V3 extension. Chromium is the runtime; no local server, embedded browser, or project-operated backend is required.

## Layered architecture

```text
Chromium APIs
     │
     ▼
Platform adapters ─────────────── Browser capability detection
     │
     ▼
Storage boundary ─────────────── Serialized local mutations
     │
     ▼
Sync orchestration
     │
     ▼
Modular storage domain ───────── Split / combine / module-scoped merge
     │
     ▼
Provider file protocol ───────── FileStore (read / write / remove / list / history)
     │
     ├──► GitHub Gist transport
     ├──► Google Drive transport
     └──► WebDAV transport
     │
     ▼
Sync domain
     ├── Snapshot model
     ├── 3-way merge (per module)
     ├── Tombstones
     ├── Conflict handling
     └── Revision/checksum consistency
     │
     ▼
Schema boundary
     ├── Runtime validation
     └── Version migration
     │
     ▼
UI / diagnostics
```

## Responsibility boundaries

### UI

Popup, options, history, guide, and recovery pages own presentation, locale/theme state, and user actions. They should not implement merge rules or direct GitHub transport.

### Background service worker

`background.ts` is the orchestration boundary. It coordinates browser collection, merge execution, remote reads/writes, alarms, and recovery operations. Mutable state that must survive worker termination belongs in extension storage rather than module globals. MV3 service workers are event-driven and can be terminated while idle, so lifecycle resilience is a hard requirement.

### Domain

`sync-core.ts` contains deterministic merge, tombstone, conflict, checksum, and entity operations. `types.ts` defines the shared domain contract so new synchronized resources can be introduced without re-defining object shapes in multiple modules.

`sync-modules.ts` is the modular storage domain. It splits a `CloudState` into the three synchronized modules, combines module files back into one coherent state, derives per-module change sets and revisions, and migrates a legacy monolithic payload. Merge rules stay in `sync-core.ts` as per-module functions (`mergeExtensionsModule`, `mergeBookmarksModule`, `mergeTabsModule`) that `mergeSnapshots` composes, so module-scoped merging reuses exactly the same conflict and tombstone semantics as the composed merge.

### Schema

`schema.ts` is the trust boundary for cloud state. Incoming Gist data is migrated into the current schema and validated before business logic consumes it. Future schema versions are rejected explicitly rather than silently downgraded.

### Storage

`storage.ts` centralizes `chrome.storage.local` access and serializes mutations through a single promise queue. This prevents concurrent read-modify-write operations from overwriting each other across asynchronous code paths.

### Transport

`cloud-files.ts` defines the provider-agnostic file protocol: a `FileStore` exposes `read`, `write`, `remove`, `list`, and an optional `history` adapter, and the protocol layer implements `readRemoteModularState`, `writeRemoteModularState`, `listRemoteHistory`, `readHistoryEntryState`, and `persistLegacyMigration` on top of it. Every provider — `cloud-gist.ts`, `cloud-gdrive.ts`, `cloud-webdav.ts` — implements only file placement, transport, and its native history model. Adding a provider therefore does not require touching merge, migration, or history semantics.

The sync protocol follows optimistic concurrency: fetch remote state, merge against the local base, write a new revision, then read the remote result back and verify revision plus snapshot checksum. A verification mismatch causes another merge attempt instead of treating an unverified write as success.

Credentials never travel through the protocol layer. The Gist transport receives its token through `configureGithubTokenSource`, registered once by the orchestrator, so the transport module cannot import the settings layer and cannot form an import cycle.

### Provider authorization

Authorization is a provider concern, and each provider keeps its credentials inside the local browser profile:

- **Google Drive** prefers browser-managed OAuth. `connectGoogleDriveBrowser()` calls `chrome.identity.getAuthToken({ interactive: true, scopes: ["…/auth/drive.file"] })`, so Chromium's account chooser performs authorization and Chromium owns the token cache — the extension stores no access or refresh token. The connected account is read back from Drive's `about` endpoint and recorded locally as `{ mode, email, accountId, displayName, photoLink, scope, connectedAt }`. A `401` from Drive drops the cached token and retries once before surfacing an auth failure; disconnecting removes the cached token, clears all cached tokens, and revokes server-side.
- **Manual OAuth** (`connectGoogleDriveManual`) is an explicit fallback for hosts where the Identity API cannot mint a token — typically unpacked development builds with no registered OAuth client. `browser-capabilities.ts` probes `identity.getAuthToken` and `removeCachedAuthToken`/`clearAllCachedAuthTokens`, and the UI only presents the manual client fields, with an explanatory notice, when that probe fails. `DriveAuthError` distinguishes "reconnect required" from a Drive fault.
- **GitHub Gist** uses a user-supplied token resolved through the registered token source.
- **WebDAV** uses the configured origin credentials.

`assertNoCredentialsInPayload` runs on every modular write and rejects any payload containing a credential-shaped key (`access_token`, `refresh_token`, `client_secret`, `code_verifier`, …) at any depth. The check is key-based, so ordinary synchronized data such as a bookmark URL containing `access_token=` in its query string is unaffected.

### Diagnostics

`diagnostics.ts` records the last sync outcome, revision context, changed counts, and categorized failures so users and maintainers can distinguish authentication, validation, network, and concurrency problems.

## Modular storage layout

Cloud storage is split into independent module files instead of one monolithic payload. Each synchronized resource is its own file, so a provider can upload, download, and version it independently.

```text
manifest.json          storage layout, schema version, module index, legacy archive pointer
meta.json              revisions, tombstone counts, migration record, orphan tombstones
extensions.json        module envelope: extension inventory
bookmarks.json         module envelope: bookmark collection
tabs.json              module envelope: windows, tabs, and tab groups
history/index.json     provider history index where the provider has no native history
history/<label>/...    complete point-in-time archive of every protocol file
```

Rules the layout enforces:

- A module envelope carries only `{ module, revision, updatedAt, checksum, data, tombstones }`. Conflicts, revisions of other modules, and schema metadata stay in `meta.json`, so no module file is coupled to unrelated data.
- Tombstones are partitioned by owning module; a tombstone whose collection maps to no module is retained in `meta.json` as an orphan instead of being dropped.
- `diffModuleChanges` compares `{ data, tombstones }` checksums, and `bumpModuleRevisions` advances a module revision only when that module changed. `serializeModularState` then omits unchanged module files, so a bookmark edit uploads `bookmarks.json` plus the two control files and leaves `extensions.json` and `tabs.json` byte-identical.
- History entries archive the complete protocol file set before an overwrite, so a rollback restores every module rather than only the modules that changed. Providers with native versioning (Gist commits, Drive revisions) map that history onto the same interface.

### Legacy migration

A remote that still holds `current.json` (or the older `chromium-cloud-sync.json`) is detected by `parseModularFiles` and migrated in place:

1. The legacy payload is validated and normalized through the schema boundary.
2. `migrateLegacyToModular` splits it into module files, carrying the legacy revision forward so module revisions stay continuous.
3. The migration is recorded in `meta.json` (`from`, `legacyRevision`, `legacyChecksum`, `migratedAt`) and in `manifest.json` (`legacyArchive`).
4. The legacy file is **preserved** as a read-only archive. `writeRemoteModularState` explicitly removes `current.json` from the deletion set, so migration can never silently delete or reset cloud data.
5. A mixed layout is resolved by revision and timestamp: if a pre-modular client later wrote a newer `current.json`, that payload wins and the migration record is re-created against it.
6. An incomplete modular layout raises an explicit error rather than presenting a partial state as complete.

Legacy encrypted payloads (`chromium-cloud-sync.encrypted.json`) are still cleaned up, but only when they are actually present in the prior file list.

### Coherent state for the UI

Because storage is split, the UI must not be asked to reason about individual files. `readRemoteModularState` always returns one combined `CloudState` plus the modular metadata, and `storageLayoutStatus()` reports the layout, per-module revisions, checksums, tombstone counts, and the legacy archive pointer as a single summary. Popup restore, tab management, and history therefore continue to observe one coherent overall synchronization state.

## Package backup subsystem

Third-party CRX/ZIP package backup is a separate subsystem from browser-state synchronization. It has its own backend selection, its own destination, and its own index, and choosing a package backend never changes the sync provider.

```text
extension-storage.ts (page context)
     │
     ├── GitHub Contents API transport
     ├── WebDAV transport
     └── Google Drive transport ──► gdrivePackageSession / describeDriveError
                                        │
                                        ▼
                                 background worker (Drive session owner)
```

`package-index.ts` holds the pure index domain shared by all three backends: path construction, source derivation, record shape, duplicate-name resolution, index upsert, and listing reconciliation. It is a page-context script that publishes `window.CCSyncPackageIndex`, which keeps the rules testable without a DOM while remaining loadable by the options page.

The Drive backend reuses the session the user already authorized for synchronization instead of introducing a second authentication mechanism. The page cannot import runtime modules, so the worker exposes exactly two messages: `gdrivePackageSession` (a short-lived access token plus the connected account) and `describeDriveError` (classification of a raw status and error body into `quota`, `rate-limit`, `auth`, `permission`, `not-found`, `too-large`, `server`, or `unknown`). The page performs the Drive requests itself, so large package bodies never travel through extension messaging.

Separation guarantees:

- Packages live in the app-managed `Chromium Cloud Sync Packages` folder, distinct from the `Chromium Cloud Sync` synchronization folder.
- `index.json`, `selection.json`, and per-package `metadata.json` sidecars live inside the package destination, never among the sync module files.
- Uploads use the resumable protocol with `X-Upload-Content-Length` declared up front, which streams large binaries and makes quota exhaustion reportable before bytes move.
- `resolveUniqueFileName` folds a checksum prefix into the file name when the same name and version already hold different bytes, so a duplicate never overwrites an unrelated backup; identical bytes resolve to the same name, so retries are idempotent.
- `mergeIndexWithListing` reconciles the index against what Drive actually lists, reporting provider-only packages as unindexed and vanished files as missing instead of offering them as restorable.

## Schema lifecycle

```text
Remote JSON
    │
    ▼
Parse
    │
    ▼
Detect schema version
    │
    ├── current ───────────────┐
    └── supported legacy ──► migrate
                              │
                              ▼
                         Current shape
                              │
                              ▼
                         Validate
                              │
                              ▼
                         Sync domain
```

The current schema version is defined once by `SCHEMA_VERSION`. Migration code must always move forward to that version and must never mutate the remote Gist implicitly without an explicit sync write.

## Build model

The repository is TypeScript-only for executable source code. Generated JavaScript is never committed and only exists under ignored `dist/` output.

```text
*.ts source
   │
   ▼
TypeScript compiler
   │
   ▼
dist/*.js
   │
   ├── load as unpacked extension
   └── package into ZIP / CRX
```

The browser package therefore remains JavaScript-compatible while the editable source tree remains TypeScript-only.

## Verification layers

CI validates the project at eight distinct boundaries:

1. Source boundary: no tracked `.js` files and required TypeScript sources exist.
2. Type boundary: strict type-checking covers the shared domain, schema, storage, modular storage domain, provider file protocol, capability, and diagnostics layer.
3. Domain boundary: `test-sync-core.ts`, `test-sync-invariants.ts`, `test-schema.ts`, and `test-storage.ts` cover merge, tombstone, schema, and local storage queue behaviour.
4. Modular storage boundary: `test-sync-modules.ts` covers split/combine round-trips, tombstone partitioning, legacy detection and migration, mixed-layout resolution, module-scoped change detection, per-module revisions, and module-scoped merge; `test-cloud-files.ts` drives the provider file protocol against a recording in-memory `FileStore` to prove which files are uploaded, which stay untouched, that a legacy archive survives migration, and that history entries restore a complete previous state.
5. Package-backup boundary: `test-package-index.ts` covers path construction and traversal safety, source derivation, record completeness, duplicate-name resolution, index normalization/upsert/capping, and listing reconciliation.
6. Drive authorization boundary: `test-gdrive-auth.ts` drives both authorization modes against a mocked Identity API and fetch.
7. Artifact boundary: generated JS is syntactically valid, the production artifact has only approved files, and forbidden remote-code/runtime constructs are rejected.
8. Browser boundary: real Chromium loads `dist/`, registers the MV3 service worker, opens the popup, and receives a runtime ping.

This separation is intentional: a successful TypeScript build cannot prove that a generated MV3 extension actually registers and runs inside Chromium.

## Extension evolution rule

New synchronized resources should be implemented in this order:

```text
Domain type
   ↓
Schema validation / migration
   ↓
Snapshot collection adapter
   ↓
Merge policy
   ↓
Persistence / tombstone behavior
   ↓
Tests
   ↓
UI
```

This prevents UI-first features from bypassing the sync protocol and creating resource-specific special cases in the background worker.
