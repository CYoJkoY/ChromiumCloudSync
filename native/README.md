# Offline extension backup helper

The optional helper discovers Chrome, Edge and Chromium profiles from the current
user's OS environment and maps extension IDs to Profile-relative paths. Archives
contain no absolute machine paths. Custom profiles require explicit registration.

Build with Rust 1.90.0:

    cargo test --manifest-path native/Cargo.toml --locked
    cargo build --manifest-path native/Cargo.toml --release --locked

Register explicitly as the current user (replace the ID and binary path):

    node native/register.mjs aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa native/target/release/ccsync-native.exe

On macOS/Linux use the binary without the .exe suffix. Registration writes user
Native Messaging manifests and Windows HKCU registry entries. It does not install
a service, elevate privileges, or terminate browsers. Keep the binary at its
registered location. Re-run registration if its path or extension ID changes.

Task roots: %LOCALAPPDATA%/ChromiumCloudSync on Windows;
~/Library/Application Support/ChromiumCloudSync on macOS;
XDG_STATE_HOME/ChromiumCloudSync on Linux (default ~/.local/state).
CCSYNC_HOME is a test override. Profile discovery uses LOCALAPPDATA,
Application Support, or XDG configuration roots independently.

Save the cloud destination in Settings > Full extension backup > Cloud destination
and legacy program-only packages. Select a Profile, extension IDs and categories,
preview, then schedule. Quit all Chromium browsers, including background processes.
The detached worker waits up to 30 minutes. On next start ready tasks upload
automatically; an alarm retries every five minutes. Cloud records publish last.

Download verifies every part and ZIP checksum before a restore preview. Confirm
replacement and close browsers. Selected scopes are replaced, including deletion
of selected data absent from the snapshot. Originals remain in the task rollback
directory. Use Roll back after browser closes to recover them. Keep this directory
until accepting the restore.

Persistent databases require the same OS, browser family and major version.
Program files do not install/register an extension; browser installation is still
required. Account sync may overwrite storage.sync. Preferences, passwords, cookies,
secure registration, temporary files, caches, storage buckets/OPFS and unknown
SQLite formats are excluded. Shared localStorage is exported by origin, never as
a shared database file. File System support is legacy persistent data only.
Selected extension data may itself contain credentials.

Do not reopen browsers while the worker writes. Process checks between scopes
cannot prevent users launching browsers during an operation. Unknown/rebranded
browser executables are unsupported. Future schema compatibility is not guaranteed.
Cloud backups are not end-to-end encrypted. Use private storage and least privilege.

To unregister this extension ID, run explicitly:

    node native/unregister.mjs aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

The script removes only that allowed origin. Registrations for other extension
IDs remain. When the final origin is removed, it removes this host's manifests
and owned Windows registry values. The binary and all task/rollback data remain.
Deletion of backup data is a separate explicit user action.

Cloud objects live under extension-backups/v1/<extensionId>/<snapshotId>/.
For multi-extension selections the lexicographically first ID owns the archive;
record.json lists the full selection. Parts are 4 MiB and SHA-256 checked before
reuse. Native messages carry at most 256 KiB of archive bytes. Pause takes effect
between cloud chunks after the active network request completes. Retrying resumes
verified upload parts or idempotent native download chunks. Metadata publishes last.
