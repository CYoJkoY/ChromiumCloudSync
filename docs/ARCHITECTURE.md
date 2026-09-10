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
     ├──────────────► GitHub Gist transport
     │
     ▼
Sync domain
     ├── Snapshot model
     ├── 3-way merge
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

### Schema

`schema.ts` is the trust boundary for cloud state. Incoming Gist data is migrated into the current schema and validated before business logic consumes it. Future schema versions are rejected explicitly rather than silently downgraded.

### Storage

`storage.ts` centralizes `chrome.storage.local` access and serializes mutations through a single promise queue. This prevents concurrent read-modify-write operations from overwriting each other across asynchronous code paths.

### Transport

GitHub access remains an explicit adapter boundary. The sync protocol follows optimistic concurrency: fetch remote state, merge against the local base, write a new revision, then read the remote result back and verify revision plus snapshot checksum. A verification mismatch causes another merge attempt instead of treating an unverified write as success.

### Diagnostics

`diagnostics.ts` records the last sync outcome, revision context, changed counts, and categorized failures so users and maintainers can distinguish authentication, validation, network, and concurrency problems.

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

CI validates the project at four distinct boundaries:

1. Source boundary: no tracked `.js` files and required TypeScript sources exist.
2. Type boundary: strict type-checking covers the shared domain, schema, storage, capability, and diagnostics layer.
3. Artifact boundary: generated JS is syntactically valid, the production artifact has only approved files, and forbidden remote-code/runtime constructs are rejected.
4. Browser boundary: real Chromium loads `dist/`, registers the MV3 service worker, opens the popup, and receives a runtime ping.

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
