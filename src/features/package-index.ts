(() => {
  /* --------------------------------------------------------------------------
   * Package-backup index domain.
   *
   * Third-party CRX/ZIP packages are backed up separately from browser-state
   * synchronization: they are large binary files with their own index, their own
   * provider destination, and their own provider selection. This module owns the
   * pure index/metadata rules that every backend (GitHub, WebDAV, Google Drive)
   * shares, so a provider integration cannot drift into its own idea of what a
   * backup record contains or when two backups collide.
   * ------------------------------------------------------------------------ */

  const PACKAGE_INDEX_SCHEMA = 2;
  const PACKAGE_METADATA_SCHEMA = 1;
  const PACKAGE_METADATA_TYPE = "chromium-cloud-sync-extension-package";
  const MAX_INDEX_ENTRIES = 200;

  const seg = (v) =>
    String(v || "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "package";

  const join = (...parts) =>
    parts
      .filter(Boolean)
      .map((x, i) =>
        i ? String(x).replace(/^\/+|\/+$/g, "") : String(x).replace(/\/+$/, ""),
      )
      .filter(Boolean)
      .join("/");

  const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };

  /** Stable per-package folder: `extensions/<id>/v<version>`. */
  function packageFolder(extensionId, version) {
    return join("extensions", seg(extensionId), `v${seg(version || "unknown")}`);
  }

  /** Relative path of a package file inside the backup destination. */
  function packagePath(extensionId, version, fileName) {
    return join(packageFolder(extensionId, version), seg(fileName));
  }

  function splitFileName(fileName) {
    const name = String(fileName || "package");
    const dot = name.lastIndexOf(".");
    if (dot <= 0) return { base: name, extension: "" };
    return { base: name.slice(0, dot), extension: name.slice(dot) };
  }

  function packageFormat(fileName) {
    return /\.zip$/i.test(String(fileName || "")) ? "zip" : "crx";
  }

  /**
   * Resolve a file name that cannot silently overwrite an unrelated backup.
   *
   * Two packages can legitimately share a name and version — a rebuild, a
   * different channel, or a repackaged CRX. When the plain name is already taken
   * by different content, the checksum prefix is folded into the name so both
   * backups survive and the result is stable across retries: uploading the same
   * bytes again lands on the same name instead of accumulating duplicates.
   */
  function resolveUniqueFileName(fileName, takenNames, sha256) {
    const wanted = String(fileName || "package");
    const taken = takenNames instanceof Set ? takenNames : new Set(takenNames || []);
    if (!taken.has(wanted)) return wanted;
    const { base, extension } = splitFileName(wanted);
    const digest = String(sha256 || "").replace(/[^a-f0-9]/gi, "").slice(0, 8);
    if (!digest) return `${base}-duplicate${extension}`;
    const candidate = `${base}-${digest}${extension}`;
    if (!taken.has(candidate)) return candidate;
    let suffix = 2;
    while (taken.has(`${base}-${digest}-${suffix}${extension}`)) suffix += 1;
    return `${base}-${digest}-${suffix}${extension}`;
  }

  /**
   * Where a package came from.
   *
   * Recorded alongside the file so a restored package can be traced back to its
   * origin, which matters when the same extension id appears from more than one
   * source.
   */
  /** Update endpoints that identify a store-installed package. */
  const CHROME_STORE_RE =
    /chromewebstore\.google\.com|chrome\.google\.com\/webstore|clients2\.google\.com\/service\/update2|clients2\.googleusercontent\.com/i;
  const EDGE_STORE_RE =
    /microsoftedge\.microsoft\.com|edge\.microsoft\.com\/extensionwebstorebase/i;

  function derivePackageSource(ext) {
    const updateUrl = String(ext?.updateUrl || "");
    const installType = String(ext?.installType || "");
    let source = "unknown";
    if (CHROME_STORE_RE.test(updateUrl)) source = "chrome-web-store";
    else if (EDGE_STORE_RE.test(updateUrl)) source = "edge-add-ons";
    else if (updateUrl) source = "self-hosted";
    else if (installType === "development") source = "unpacked";
    else if (installType === "side_loading") source = "side-loaded";
    else if (installType === "admin") source = "policy";
    else if (installType === "normal") source = "chrome-web-store";
    else if (installType) source = installType;
    return { source, installType, updateUrl };
  }

  /**
   * Build one backup record.
   *
   * Carries the filename, extension id, extension version, source information,
   * timestamp, size, and SHA-256 checksum, plus the backend that stored it so a
   * listing can say where a package lives.
   */
  function buildPackageRecord(input) {
    const ext = input?.extension || {};
    const fileName = String(input?.fileName || "package");
    const extensionId = String(ext.id || input?.extensionId || "");
    const version = String(ext.version || input?.version || "");
    const sourceInfo = derivePackageSource(ext);
    const bytes = num(input?.size, 0);
    return {
      extensionId,
      name: String(ext.name || input?.name || extensionId),
      version,
      fileName,
      format: packageFormat(fileName),
      size: bytes,
      sha256: String(input?.sha256 || "").toLowerCase(),
      path: String(input?.path || packagePath(extensionId, version, fileName)),
      storedAt: String(input?.storedAt || new Date().toISOString()),
      source: input?.source || sourceInfo.source,
      installType: input?.installType || sourceInfo.installType,
      updateUrl: input?.updateUrl || sourceInfo.updateUrl,
      backend: String(input?.backend || ""),
    };
  }

  /** Per-package metadata sidecar, kept separate from the index and from sync. */
  function packageMetadata(record) {
    return {
      schemaVersion: PACKAGE_METADATA_SCHEMA,
      type: PACKAGE_METADATA_TYPE,
      package: record,
    };
  }

  /** Identity of a backup: same extension, same version, same bytes. */
  function indexKey(record) {
    return `${record?.extensionId || ""}:${record?.version || ""}:${record?.sha256 || ""}`;
  }

  function emptyIndex() {
    return { schemaVersion: PACKAGE_INDEX_SCHEMA, backups: [] };
  }

  /** Tolerate older or partially written indexes instead of discarding them. */
  function normalizeIndex(raw) {
    const backups = Array.isArray(raw?.backups)
      ? raw.backups
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({
          extensionId: String(entry.extensionId || ""),
          name: String(entry.name || entry.extensionId || ""),
          version: String(entry.version || ""),
          fileName: String(entry.fileName || ""),
          format: String(entry.format || packageFormat(entry.fileName)),
          size: num(entry.size),
          sha256: String(entry.sha256 || "").toLowerCase(),
          path: String(entry.path || ""),
          storedAt: String(entry.storedAt || ""),
          source: String(entry.source || ""),
          installType: String(entry.installType || ""),
          updateUrl: String(entry.updateUrl || ""),
          backend: String(entry.backend || ""),
        }))
      : [];
    return {
      schemaVersion: PACKAGE_INDEX_SCHEMA,
      updatedAt: String(raw?.updatedAt || ""),
      backups,
    };
  }

  /**
   * Add or replace one backup record.
   *
   * The previous entry for the same extension/version/checksum is replaced, so
   * re-uploading identical bytes does not grow the index; entries with a
   * different checksum are kept side by side.
   */
  function upsertIndexEntry(index, record) {
    const current = normalizeIndex(index);
    const key = indexKey(record);
    const backups = current.backups.filter((entry) => indexKey(entry) !== key);
    backups.push(record);
    return {
      schemaVersion: PACKAGE_INDEX_SCHEMA,
      updatedAt: new Date().toISOString(),
      backups: backups.slice(-MAX_INDEX_ENTRIES),
    };
  }

  function findIndexEntry(index, match) {
    const key = indexKey(match);
    return normalizeIndex(index).backups.find((entry) => indexKey(entry) === key) || null;
  }

  /** File names already used inside one package folder. */
  function takenNamesInFolder(index, extensionId, version) {
    const folder = packageFolder(extensionId, version);
    const names = new Set();
    for (const entry of normalizeIndex(index).backups) {
      const path = String(entry.path || "");
      if (!path.startsWith(`${folder}/`)) continue;
      names.add(path.slice(folder.length + 1));
      if (entry.fileName) names.add(String(entry.fileName));
    }
    return names;
  }

  /**
   * Reconcile the index with what the provider actually lists.
   *
   * The index is the source of truth for metadata, but a package can exist on
   * the provider without an index entry (an interrupted upload, or a backup made
   * by another profile). Those are reported as unindexed rather than dropped, and
   * index entries whose file is gone are reported as missing rather than shown as
   * restorable.
   */
  function mergeIndexWithListing(index, listing) {
    const current = normalizeIndex(index);
    const listed = new Map();
    for (const entry of Array.isArray(listing) ? listing : []) {
      const path = String(entry?.path || "");
      if (!path || /(^|\/)(index|selection)\.json$/.test(path)) continue;
      if (/(^|\/)metadata\.json$/.test(path)) continue;
      listed.set(path, entry);
    }
    const backups = current.backups.map((entry) => {
      const remote = listed.get(entry.path);
      if (remote) listed.delete(entry.path);
      return {
        ...entry,
        present: !!remote,
        remoteSize: remote ? num(remote.size, entry.size) : null,
        remoteModified: remote ? String(remote.modifiedTime || "") : "",
      };
    });
    const unindexed = [...listed.values()].map((entry) => {
      const path = String(entry.path || "");
      const parts = path.split("/");
      const fileName = parts[parts.length - 1] || path;
      const versionPart = parts[parts.length - 2] || "";
      const idPart = parts[parts.length - 3] || "";
      return {
        ...buildPackageRecord({
          extensionId: idPart,
          version: versionPart.replace(/^v/, ""),
          fileName,
          size: num(entry.size),
          storedAt: String(entry.modifiedTime || ""),
          path,
        }),
        present: true,
        indexed: false,
        remoteSize: num(entry.size),
        remoteModified: String(entry.modifiedTime || ""),
      };
    });
    return {
      schemaVersion: PACKAGE_INDEX_SCHEMA,
      updatedAt: current.updatedAt,
      backups,
      unindexed,
      missing: backups.filter((entry) => !entry.present).map((entry) => entry.path),
    };
  }

  window.CCSyncPackageIndex = {
    PACKAGE_INDEX_SCHEMA,
    PACKAGE_METADATA_SCHEMA,
    PACKAGE_METADATA_TYPE,
    MAX_INDEX_ENTRIES,
    seg,
    join,
    packageFolder,
    packagePath,
    packageFormat,
    splitFileName,
    resolveUniqueFileName,
    derivePackageSource,
    buildPackageRecord,
    packageMetadata,
    indexKey,
    emptyIndex,
    normalizeIndex,
    upsertIndexEntry,
    findIndexEntry,
    takenNamesInFolder,
    mergeIndexWithListing,
  };
})();
