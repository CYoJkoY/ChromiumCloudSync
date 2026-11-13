# Portable extension backup v1

The use case is selection, offline capture, verified cloud transfer, selected
replacement and rollback. The new BackupService declares NativePort, CloudPort
and StatePort. Cloud adapters depend on that contract; the use case imports no
browser APIs or provider SDK. The runtime is the composition root and owns native
connections, serialization, startup/alarm upload and local checkpoints. The DOM
adapter owns explicit Profile, extension-ID and category choices. No event bus is
introduced. The existing sync-core, sync schema and package-index contracts have
zero changes. Legacy extensionBackup configuration keys remain supported.

Native modules separate Profile discovery, versioned category mapping, shared
origin export, archive validation, protocol and offline worker. Archive manifests
contain Profile-relative paths and layout versions. Only the machine-local Profile
registry stores resolved absolute locations. On Windows discovery starts with
LOCALAPPDATA; on macOS with HOME/Library/Application Support; on Linux with
CHROME_CONFIG_HOME, XDG_CONFIG_HOME or HOME/.config. No source machine root is
used as a restore target.

| Category | Profile-relative scope |
| --- | --- |
| program | Extensions/<id> |
| local | Local Extension Settings/<id> |
| sync | Sync Extension Settings/<id> |
| indexeddb | IndexedDB/chrome-extension_<id>_0.indexeddb.leveldb and .blob |
| localStorage | Origin-filtered records, imported into the target shared database |
| files | Legacy persistent File System origin, remapped on restore |

OPFS/storage buckets, preferences, extension registration, passwords, cookies,
caches and unknown database formats are excluded. These category adapters are
statically composed; this is not an arbitrary third-party plugin loader. Adding a
layout requires a versioned mapping, archive ownership validation and fixture tests.

Cloud layout is extension-backups/v1/<owner-extension-id>/<snapshot-id>. Multi-ID
archives use the first sorted ID as owner and list every ID in record.json. Parts
are 4 MiB, native messages carry 256 KiB, archive size is capped at 32 GiB and
200,000 entries. SHA-256 verifies parts, archive and extracted files. These are
resource limits, not measured performance claims. Metadata publishes last; retries
verify existing parts before reuse. Pause occurs between chunks.

Native tasks move through waiting/running to ready/uploaded or restored/rolledBack;
downloads use receiving/preview before explicit scheduling. Failed, timedOut and
cancelled states carry errors. Pending jobs precede completed history in the bounded
task response. The worker waits up to 30 minutes for known browser processes to
exit, journals originals, checks idleness between scopes, and recovers interrupted
replacement. A user reopening the browser during writes remains a race: do not
reopen it until the operation finishes. Rollback data is retained locally.

## Verification and remaining integration work

Baseline main: 681c102449c72edd0d266e2fbcc47840be964dc0. Existing 13 TypeScript
suites passed before implementation. npm run validate passes strict checking,
undefined-call checking, existing suites, transfer and shared provider read
contracts, registration fixtures, build, runtime validation and artifact audit.
Rust 1.90.0 passes 10 fixture tests and a Windows debug build. The actual Windows
binary passes framed native protocol tests with temporary task roots. Registration
tests simulate all three platforms without installing a helper.

Fixtures cover traversal/alias rejection, ordered idempotent chunks, archive
integrity, origin isolation, scoped replacement, rollback, interrupted recovery,
browser-open rejection, metadata identity checks and pending-job visibility. Cloud
tests cover corrupt resumed chunks, cancellation before publication and common
GitHub/WebDAV/Drive read, missing-object, unsafe-path and size-limit behavior.

Not locally verified: installed extension-to-helper connection, live cloud provider
round trips, actual macOS/Linux execution, screenshots and throughput/memory
benchmarks. CI exercises native builds/tests on all three OSes and the extension
smoke suite. Helper registration remains an explicit manual system configuration
step documented in README.md. No release, system installation or merge is performed.
Persistent database restore requires the same OS, browser family and major version.
The existing package format remains available; the new v1 full-backup namespace has
no earlier released format to migrate.
