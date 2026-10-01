(() => {
  /* --------------------------------------------------------------------------
   * Local extension sources for third-party package backup.
   *
   * Chromium exposes another extension's metadata through `chrome.management`
   * but never its installed files. The user, however, has those files on disk:
   * every store install is unpacked into the profile's `Extensions/<id>/<version>`
   * tree, and development/side-loaded extensions live in whatever folder they
   * were loaded from. Letting the user point this extension at one of those
   * folders once replaces the per-extension CRX/ZIP picker entirely.
   *
   * The module is deliberately split in two:
   *   - pure planning and encoding (ZIP writing, CRX id parsing, layout
   *     detection, extension matching), which runs in Node without a browser;
   *   - thin platform glue (directory walking, file reading) that uses only
   *     standard web APIs and never touches the DOM, so the options page keeps
   *     every user-facing string in its own translation table.
   * ------------------------------------------------------------------------ */

  /** Chrome extension IDs are 32 characters of the a-p alphabet. */
  const EXTENSION_ID_RE = /^[a-p]{32}$/;
  const MANIFEST_FILE = "manifest.json";
  const EXTENSIONS_DIR = "Extensions";
  /** Guards against a pathological profile walk before any byte is read. */
  const MAX_SCAN_FILES = 200000;
  /**
   * Browser-internal profile directories that never hold extension files.
   *
   * A real profile carries hundreds of megabytes of cache and site storage, and
   * walking it just to discover that none of it is an extension wastes the whole
   * scan. Only the top two levels are filtered, so an extension that happens to
   * contain a folder with one of these names is never affected.
   */
  const SKIP_DIR_NAMES = new Set([
    "Cache",
    "Code Cache",
    "GPUCache",
    "DawnCache",
    "DawnGraphiteCache",
    "DawnScratchTimestampCache",
    "GrShaderCache",
    "ShaderCache",
    "Media Cache",
    "Service Worker",
    "IndexedDB",
    "Local Storage",
    "Session Storage",
    "blob_storage",
    "databases",
    "extension_state",
    "File System",
    "Storage",
  ]);
  const MAX_SCAN_DEPTH = 8;
  const MAX_MANIFEST_BYTES = 1024 * 1024;
  const MAX_MANIFESTS = 2000;
  const MAX_PACKAGE_FILES = 20000;
  /**
   * Fixed 1980-01-01 DOS timestamp. A stable timestamp keeps a package
   * byte-identical when the same files are packaged again, so the existing
   * checksum identity in the backup index recognizes it instead of storing a
   * second copy of unchanged content.
   */
  const ZIP_DOS_DATE = 0x0021;
  const ZIP_DOS_TIME = 0;
  const ZIP_LOCAL_SIG = 0x04034b50;
  const ZIP_CENTRAL_SIG = 0x02014b50;
  const ZIP_EOCD_SIG = 0x06054b50;
  const ZIP_METHOD_STORE = 0;
  const ZIP_METHOD_DEFLATE = 8;
  const ZIP_UTF8_FLAG = 0x0800;

  const u16 = (bytes, at) =>
    at + 2 <= bytes.length ? (bytes[at] | (bytes[at + 1] << 8)) >>> 0 : 0;
  const u32 = (bytes, at) =>
    at + 4 <= bytes.length
      ? ((bytes[at] |
          (bytes[at + 1] << 8) |
          (bytes[at + 2] << 16) |
          (bytes[at + 3] << 24)) >>>
        0)
      : 0;
  const hex = (bytes, from = 0, to = bytes.length) => {
    let out = "";
    for (let i = Math.max(0, from); i < Math.min(bytes.length, to); i += 1)
      out += bytes[i].toString(16).padStart(2, "0");
    return out;
  };

  /**
   * Chromium spells extension IDs with the a-p alphabet: the 128-bit hash is
   * hex-encoded and every hex digit is then mapped to the letter `a` plus its
   * value. Anything read out of a CRX header must go through this conversion
   * before it can be compared with an ID from `chrome.management`.
   */
  function hexToExtensionId(value) {
    let out = "";
    for (const char of String(value || "").toLowerCase()) {
      const nibble = parseInt(char, 16);
      if (Number.isNaN(nibble)) return "";
      out += String.fromCharCode(97 + nibble);
    }
    return out;
  }

  /** Same segment rule the backup index uses, so names cannot escape a folder. */
  const seg = (value) =>
    String(value || "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "package";

  const toBytes = (value) => {
    if (value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value))
      return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return new Uint8Array(0);
  };

  const dirOf = (path) => {
    const at = String(path || "").lastIndexOf("/");
    return at < 0 ? "" : String(path).slice(0, at);
  };

  const sameText = (a, b) =>
    String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

  const slug = (value) =>
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");

  const byLengthThenName = (a, b) =>
    a.split("/").length - b.split("/").length || (a < b ? -1 : a > b ? 1 : 0);

  /* --------------------------------------------------------------------------
   * ZIP writing.
   * ------------------------------------------------------------------------ */

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    const data = toBytes(bytes);
    let c = 0xffffffff;
    for (let i = 0; i < data.length; i += 1)
      c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /**
   * Build a ZIP archive from `{ path, bytes }` entries.
   *
   * Entries are stored uncompressed: packaging must not spend CPU re-compressing
   * already compressed extension assets, and the output stays readable by every
   * unzip tool and by Chrome's unpacked loader.
   */
  function createZip(entries) {
    const list = (Array.isArray(entries) ? entries : [])
      .map((entry) => ({
        path: String(entry?.path || "")
          .replace(/\\/g, "/")
          .replace(/^\/+/, "")
          .replace(/\/{2,}/g, "/"),
        bytes: toBytes(entry?.bytes),
      }))
      .filter((entry) => entry.path && entry.bytes.length)
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .slice(0, MAX_PACKAGE_FILES);

    const encoder = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const entry of list) {
      const name = encoder.encode(entry.path);
      const crc = crc32(entry.bytes);
      const size = entry.bytes.length;
      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, ZIP_LOCAL_SIG, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, ZIP_UTF8_FLAG, true);
      lv.setUint16(8, ZIP_METHOD_STORE, true);
      lv.setUint16(10, ZIP_DOS_TIME, true);
      lv.setUint16(12, ZIP_DOS_DATE, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, name.length, true);
      lv.setUint16(28, 0, true);
      local.set(name, 30);
      parts.push(local, entry.bytes);

      const dir = new Uint8Array(46 + name.length);
      const dv = new DataView(dir.buffer);
      dv.setUint32(0, ZIP_CENTRAL_SIG, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 20, true);
      dv.setUint16(8, ZIP_UTF8_FLAG, true);
      dv.setUint16(10, ZIP_METHOD_STORE, true);
      dv.setUint16(12, ZIP_DOS_TIME, true);
      dv.setUint16(14, ZIP_DOS_DATE, true);
      dv.setUint32(16, crc, true);
      dv.setUint32(20, size, true);
      dv.setUint32(24, size, true);
      dv.setUint16(28, name.length, true);
      dv.setUint32(42, offset, true);
      dir.set(name, 46);
      central.push(dir);
      offset += local.length + size;
    }

    let centralSize = 0;
    for (const dir of central) centralSize += dir.length;
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, ZIP_EOCD_SIG, true);
    ev.setUint16(8, list.length, true);
    ev.setUint16(10, list.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    const total =
      parts.reduce((sum, part) => sum + part.length, 0) + centralSize + 22;
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of [...parts, ...central, end]) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  /* --------------------------------------------------------------------------
   * ZIP reading (only what matching an uploaded archive needs).
   * ------------------------------------------------------------------------ */

  function findEndOfCentralDirectory(bytes) {
    const min = Math.max(0, bytes.length - 22 - 65535);
    for (let at = bytes.length - 22; at >= min; at -= 1) {
      if (u32(bytes, at) !== ZIP_EOCD_SIG) continue;
      const entries = u16(bytes, at + 10);
      const size = u32(bytes, at + 12);
      const offset = u32(bytes, at + 16);
      if (offset === 0xffffffff || size === 0xffffffff) return null;
      if (offset + size > bytes.length) return null;
      return { entries, size, offset };
    }
    return null;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") return null;
    try {
      const stream = new Blob([bytes])
        .stream()
        .pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      return null;
    }
  }

  async function readLocalEntry(bytes, offset, method, size) {
    if (offset + 30 > bytes.length) return null;
    if (u32(bytes, offset) !== ZIP_LOCAL_SIG) return null;
    const nameLen = u16(bytes, offset + 26);
    const extraLen = u16(bytes, offset + 28);
    const start = offset + 30 + nameLen + extraLen;
    if (start + size > bytes.length) return null;
    const data = bytes.subarray(start, start + size);
    if (method === ZIP_METHOD_STORE) return data;
    if (method === ZIP_METHOD_DEFLATE) return await inflateRaw(data);
    return null;
  }

  /** Read one stored entry by name; returns null when it is absent/unreadable. */
  async function readZipEntry(bytes, wanted) {
    const data = toBytes(bytes);
    const name = String(wanted || "");
    if (!name) return null;
    const eocd = findEndOfCentralDirectory(data);
    if (!eocd) return null;
    let at = eocd.offset;
    for (let i = 0; i < eocd.entries; i += 1) {
      if (at + 46 > data.length) return null;
      if (u32(data, at) !== ZIP_CENTRAL_SIG) return null;
      const method = u16(data, at + 10);
      const size = u32(data, at + 20);
      const nameLen = u16(data, at + 28);
      const extraLen = u16(data, at + 30);
      const commentLen = u16(data, at + 32);
      const offset = u32(data, at + 42);
      const entryName = new TextDecoder().decode(
        data.subarray(at + 46, at + 46 + nameLen),
      );
      if (entryName === name)
        return await readLocalEntry(data, offset, method, size);
      at += 46 + nameLen + extraLen + commentLen;
    }
    return null;
  }

  /** Extension name and version from an uploaded ZIP's `manifest.json`. */
  async function readZipManifestInfo(bytes) {
    const entry = await readZipEntry(bytes, MANIFEST_FILE);
    if (!entry) return null;
    try {
      const json = JSON.parse(new TextDecoder().decode(entry));
      return {
        name: String(json?.name || ""),
        version: String(json?.version || ""),
      };
    } catch {
      return null;
    }
  }

  /* --------------------------------------------------------------------------
   * CRX identity.
   * ------------------------------------------------------------------------ */

  async function sha256Prefix(bytes, count = 16) {
    const digest = await crypto.subtle.digest("SHA-256", toBytes(bytes));
    return hexToExtensionId(hex(new Uint8Array(digest), 0, count));
  }

  /** DER public key inside a protobuf `AsymmetricKeyProof` (CRX3 fallback). */
  function findEmbeddedPublicKey(bytes, from, to) {
    const limit = Math.min(bytes.length, to);
    for (let at = Math.max(0, from); at + 4 < limit; at += 1) {
      if (bytes[at] !== 0x0a) continue;
      const len = bytes[at + 1];
      if (len < 90 || len > 1200) continue;
      const key = at + 2;
      if (key + len > limit) continue;
      if (bytes[key] !== 0x30) continue;
      return bytes.subarray(key, key + len);
    }
    return null;
  }

  /**
   * Extension ID carried by a CRX package.
   *
   * CRX3 states it directly as the 128-bit `crx_id` in the signed header; CRX2
   * only carries the public key, and the ID is the first 16 bytes of its
   * SHA-256 hash. Matching an uploaded CRX to an installed extension therefore
   * needs no filename convention and no guesswork.
   */
  async function parseCrxId(bytes) {
    const data = toBytes(bytes);
    if (data.length < 20) return null;
    if (!(data[0] === 0x43 && data[1] === 0x72 && data[2] === 0x32 && data[3] === 0x34))
      return null;
    const version = u32(data, 4);
    if (version === 3) {
      const headerLength = u32(data, 8);
      const signedHeaderSize = u32(data, 12);
      const signed = data.subarray(16, Math.min(data.length, 16 + signedHeaderSize));
      // SignedData { crx_id = 1 } is serialized as 0x0A 0x10 <16 bytes>.
      if (signed.length >= 18 && signed[0] === 0x0a && signed[1] === 0x10)
        return hexToExtensionId(hex(signed, 2, 18));
      if (signed.length >= 16) return hexToExtensionId(hex(signed, 0, 16));
      const key = findEmbeddedPublicKey(data, 16, 12 + headerLength);
      return key ? await sha256Prefix(key, 16) : null;
    }
    if (version === 2) {
      const keyLength = u32(data, 8);
      const signatureLength = u32(data, 12);
      const key = data.subarray(16, 16 + keyLength);
      if (!keyLength || keyLength > 4096 || signatureLength > 8192) return null;
      return key.length ? await sha256Prefix(key, 16) : null;
    }
    return null;
  }

  /* --------------------------------------------------------------------------
   * Local layout detection and planning.
   * ------------------------------------------------------------------------ */

  const normalizeFiles = (files) =>
    (Array.isArray(files) ? files : [])
      .map((file) => ({
        path: String(file?.path || "").replace(/\\/g, "/").replace(/^\/+/, ""),
        size: Number(file?.size || 0),
        read: typeof file?.read === "function" ? file.read : null,
      }))
      .filter((file) => file.path);

  const normalizeManifests = (manifests) =>
    (Array.isArray(manifests) ? manifests : [])
      .map((entry) => ({
        path: String(entry?.path || "").replace(/\\/g, "/").replace(/^\/+/, ""),
        name: String(entry?.name || ""),
        version: String(entry?.version || ""),
      }))
      .filter((entry) => entry.path);

  const normalizeInstalled = (installed) =>
    (Array.isArray(installed) ? installed : [])
      .map((entry) => ({
        id: String(entry?.id || ""),
        name: String(entry?.name || entry?.id || ""),
        version: String(entry?.version || ""),
        installType: String(entry?.installType || ""),
      }))
      .filter((entry) => entry.id);

  /**
   * Work out what kind of folder the user picked.
   *
   * A browser profile, a single profile's `Extensions` directory, and a plain
   * source folder all look different on disk, and the same code has to serve
   * all three: `User Data` contains several profiles, a profile contains one
   * `Extensions` tree, and a development folder contains unpacked extensions
   * with no ID-named directories at all.
   */
  function detectLocalLayout(files) {
    const list = normalizeFiles(files);
    const dirs = new Set();
    for (const file of list) {
      const parts = file.path.split("/");
      for (let i = 1; i < parts.length; i += 1)
        dirs.add(parts.slice(0, i).join("/"));
    }
    const extensionDirs = [...dirs]
      .filter((dir) => dir.split("/").pop() === EXTENSIONS_DIR)
      .sort(byLengthThenName);
    if (extensionDirs.length) {
      const depth = extensionDirs[0].split("/").length;
      const roots = extensionDirs.filter(
        (dir) => dir.split("/").length === depth,
      );
      return { mode: "profile", roots };
    }
    const topLevel = new Set();
    for (const file of list) {
      const parts = file.path.split("/");
      if (parts.length > 1) topLevel.add(parts[0]);
    }
    const idLike = [...topLevel].filter((name) => EXTENSION_ID_RE.test(name));
    if (topLevel.size && idLike.length / topLevel.size >= 0.6)
      return { mode: "extensions", roots: [""] };
    return { mode: "loose", roots: [""] };
  }

  const versionParts = (value) =>
    String(value || "")
      .split(/[._-]/)
      .filter(Boolean);

  /** Numeric-aware comparison so v10 sorts above v9. */
  function compareVersions(a, b) {
    const left = versionParts(a);
    const right = versionParts(b);
    for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
      const x = left[i] || "";
      const y = right[i] || "";
      const nx = /^\d+$/.test(x) ? Number(x) : null;
      const ny = /^\d+$/.test(y) ? Number(y) : null;
      if (nx !== null && ny !== null && nx !== ny) return nx - ny;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }

  /** Prefer the installed version; otherwise the newest directory present. */
  function chooseVersion(versions, preferred) {
    const names = [...versions.keys()];
    if (!names.length) return null;
    if (preferred && versions.has(preferred))
      return { version: preferred, ...versions.get(preferred) };
    const newest = names.sort(compareVersions).pop();
    return { version: newest, ...versions.get(newest) };
  }

  /**
   * Turn a scanned folder into backup candidates.
   *
   * Matching is deliberately conservative: an ID-named directory is trusted,
   * anything else has to match an installed extension's manifest name *and*
   * version uniquely. A wrong match would file a backup under the wrong
   * extension ID, which is worse than reporting "not found".
   */
  function planLocalPackages(input) {
    const files = normalizeFiles(input?.files);
    const manifests = normalizeManifests(input?.manifests);
    const installed = normalizeInstalled(input?.installed);
    const layout = detectLocalLayout(files);
    const manifestByDir = new Map(
      manifests.map((entry) => [dirOf(entry.path), entry]),
    );
    const installedById = new Map(installed.map((entry) => [entry.id, entry]));
    const packages = [];
    const plannedDirs = new Set();
    const matchedIds = new Set();
    const orphanDirs = [];

  const pushPackage = (item) => {
    if (plannedDirs.has(item.rootPath)) return;
    plannedDirs.add(item.rootPath);
    // Directory walks return filesystem order; sorting keeps the plan (and the
    // package it produces) identical no matter how the folder was scanned.
    const files = item.files
      .slice()
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    packages.push({
        extensionId: item.extensionId,
        name: item.name,
        version: item.version,
        installedVersion: item.installedVersion || "",
        versionMismatch: Boolean(item.versionMismatch),
        matchKind: item.matchKind,
        installed: Boolean(item.installed),
        rootPath: item.rootPath,
        files,
        fileCount: files.length,
        totalSize: files.reduce((sum, file) => sum + Number(file.size || 0), 0),
      });
    };

    /* ---------------------------- ID/version tree --------------------------- */
    if (layout.mode !== "loose") {
      const roots = layout.roots.length ? layout.roots : [""];
      const byRoot = new Map();
      for (const root of roots) byRoot.set(root, new Map());
      for (const file of files) {
        for (const root of roots) {
          if (root && !file.path.startsWith(`${root}/`)) continue;
          const relative = root ? file.path.slice(root.length + 1) : file.path;
          const parts = relative.split("/");
          if (parts.length < 2) continue;
          const id = parts[0];
          if (!EXTENSION_ID_RE.test(id)) continue;
          const version = parts.length >= 3 ? parts[1] : "";
          const dir = [root, id, version].filter(Boolean).join("/");
          const group = byRoot.get(root);
          if (!group.has(id)) group.set(id, new Map());
          const versions = group.get(id);
          if (!versions.has(version)) versions.set(version, { dir, files: [] });
          versions.get(version).files.push(file);
          break;
        }
      }
      for (const group of byRoot.values()) {
        for (const [id, versions] of [...group.entries()].sort((a, b) =>
          a[0] < b[0] ? -1 : 1,
        )) {
          const ext = installedById.get(id);
          const chosen = chooseVersion(versions, ext?.version || "");
          if (!chosen) continue;
          if (!ext) {
            const manifest = manifestByDir.get(chosen.dir);
            pushPackage({
              extensionId: id,
              name: manifest?.name || id,
              version: chosen.version || "unknown",
              matchKind: "orphan",
              installed: false,
              rootPath: chosen.dir,
              files: chosen.files,
            });
            orphanDirs.push(chosen.dir);
            continue;
          }
          matchedIds.add(id);
          pushPackage({
            extensionId: id,
            name: ext.name || id,
            version: chosen.version || ext.version,
            installedVersion: ext.version,
            versionMismatch: chosen.version !== ext.version,
            matchKind: "id",
            installed: true,
            rootPath: chosen.dir,
            files: chosen.files,
          });
        }
      }
    }

    /* ------------------------ unpacked source folders ----------------------- */
    const looseCandidates = [];
    for (const entry of manifests) {
      const dir = dirOf(entry.path);
      if (!dir || dir.includes("/")) continue;
      if (plannedDirs.has(dir)) continue;
      if (layout.roots.some((root) => root && dir.startsWith(`${root}/`))) continue;
      looseCandidates.push({ dir, ...entry });
    }
    const unmatched = installed.filter((ext) => !matchedIds.has(ext.id));
    const ambiguous = [];
    for (const ext of unmatched) {
      const hits = looseCandidates.filter(
        (candidate) =>
          sameText(candidate.name, ext.name) &&
          String(candidate.version || "") === String(ext.version || ""),
      );
      if (hits.length === 1) {
        const hit = hits[0];
        const hitFiles = files.filter(
          (file) => file.path === hit.dir || file.path.startsWith(`${hit.dir}/`),
        );
        if (!hitFiles.length) continue;
        matchedIds.add(ext.id);
        pushPackage({
          extensionId: ext.id,
          name: ext.name || ext.id,
          version: ext.version,
          installedVersion: ext.version,
          matchKind: "manifest",
          installed: true,
          rootPath: hit.dir,
          files: hitFiles,
        });
      } else if (hits.length > 1) ambiguous.push(ext.id);
    }

    return {
      mode: layout.mode,
      roots: layout.roots,
      packages,
      matchedIds: [...matchedIds],
      missing: installed
        .filter((ext) => !matchedIds.has(ext.id))
        .map((ext) => ({ id: ext.id, name: ext.name, version: ext.version })),
      ambiguous,
      orphanDirs,
      fileCount: files.length,
    };
  }

  /** Backup file name: `<extension>-<version>.zip`. */
  function packageFileName(name, version) {
    return `${seg(name)}-${seg(version || "unknown")}.zip`;
  }

  /**
   * Package one planned directory into ZIP bytes.
   *
   * Entry paths are relative to the extension's own directory, so the archive
   * extracts straight into a folder Chrome can load unpacked.
   */
  async function buildLocalPackage(item) {
    const root = String(item?.rootPath || "");
    const planned = Array.isArray(item?.files) ? item.files : [];
    if (planned.length > MAX_PACKAGE_FILES)
      // A truncated archive would look like a complete backup, so refuse it.
      throw Error("too-many-files");
    const entries = [];
    let skipped = 0;
    for (const file of planned) {
      if (typeof file?.read !== "function") {
        skipped += 1;
        continue;
      }
      const relative = root ? file.path.slice(root.length + 1) : file.path;
      if (!relative) continue;
      try {
        entries.push({ path: relative, bytes: await file.read() });
      } catch {
        skipped += 1;
      }
    }
    if (!entries.length)
      throw Error(
        `No readable files under ${root || "the selected folder"}`,
      );
    const bytes = createZip(entries);
    return {
      bytes,
      fileName: packageFileName(item?.name, item?.version),
      fileCount: entries.length,
      skipped,
      size: bytes.length,
    };
  }

  /* --------------------------------------------------------------------------
   * Identifying an uploaded archive.
   * ------------------------------------------------------------------------ */

  /**
   * Decide which installed extension an uploaded CRX/ZIP belongs to.
   *
   * A CRX carries its own ID; a ZIP carries a manifest. Both are exact, so a
   * multi-file upload can be filed without asking the user to rename anything.
   * Filename matching is the last resort and only accepts a unique hit.
   */
  async function identifyUploadedPackage(input) {
    const installed = normalizeInstalled(input?.installed);
    const fileName = String(input?.fileName || "");
    const bytes = input?.bytes ? toBytes(input.bytes) : null;
    if (bytes && bytes.length) {
      if (/\.crx$/i.test(fileName)) {
        const id = await parseCrxId(bytes);
        const hit = installed.find((entry) => entry.id === id);
        if (hit) return { extension: hit, how: "crx-id" };
      }
      const manifest = await readZipManifestInfo(bytes);
      if (manifest?.name) {
        const exact = installed.filter(
          (entry) =>
            sameText(entry.name, manifest.name) &&
            String(entry.version || "") === String(manifest.version || ""),
        );
        if (exact.length === 1) return { extension: exact[0], how: "zip-manifest" };
        const byName = installed.filter((entry) =>
          sameText(entry.name, manifest.name),
        );
        if (byName.length === 1)
          return { extension: byName[0], how: "zip-manifest-name" };
      }
    }
    const base = fileName.replace(/\.[^./]+$/, "");
    if (base) {
      const byId = installed.find(
        (entry) => entry.id && base.toLowerCase().includes(entry.id.toLowerCase()),
      );
      if (byId) return { extension: byId, how: "file-name-id" };
      const wanted = slug(base);
      const byName = installed.filter((entry) => {
        const name = slug(entry.name);
        // "uBlock-Origin-1.2.3.zip" has to resolve to "uBlock Origin".
        return name.length >= 3 && wanted.startsWith(name);
      });
      if (byName.length === 1) return { extension: byName[0], how: "file-name" };
    }
    return null;
  }

  /* --------------------------------------------------------------------------
   * Platform glue: walk a directory the user picked.
   * ------------------------------------------------------------------------ */

  const entryNameAndHandle = (item) =>
    Array.isArray(item) ? item : [item?.name, item];

  async function walkDirectoryHandle(handle, prefix, depth, files) {
    if (depth > MAX_SCAN_DEPTH || files.length >= MAX_SCAN_FILES) return;
    const iterator =
      typeof handle?.entries === "function"
        ? handle.entries()
        : typeof handle?.values === "function"
          ? handle.values()
          : null;
    if (!iterator) return;
    for await (const item of iterator) {
      if (files.length >= MAX_SCAN_FILES) return;
      const [rawName, entry] = entryNameAndHandle(item);
      const name = String(rawName || entry?.name || "");
      if (!name) continue;
      const path = prefix ? `${prefix}/${name}` : name;
      if (entry?.kind === "directory" || typeof entry?.getFile !== "function") {
        if (depth <= 2 && SKIP_DIR_NAMES.has(name)) continue;
        if (typeof entry?.values === "function" || typeof entry?.entries === "function")
          await walkDirectoryHandle(entry, path, depth + 1, files);
        continue;
      }
      try {
        const file = await entry.getFile();
        files.push({
          path,
          size: Number(file?.size || 0),
          read: async () => new Uint8Array(await file.arrayBuffer()),
        });
      } catch {
        /* A file the browser refuses to hand out is simply not backed up. */
      }
    }
  }

  /** Walk a `FileSystemDirectoryHandle` into the flat file list the planner wants. */
  async function scanDirectoryHandle(handle) {
    const files = [];
    await walkDirectoryHandle(handle, "", 1, files);
    return { rootName: String(handle?.name || ""), files };
  }

  /** Same list from a `webkitdirectory` file input (no File System Access API). */
  function scanPickedFiles(fileList) {
    const files = [];
    for (const file of Array.from(fileList || [])) {
      const path = String(file?.webkitRelativePath || file?.name || "")
        .replace(/\\/g, "/")
        .replace(/^\/+/, "");
      if (!path) continue;
      const parts = path.split("/");
      if (parts.slice(0, 2).some((part) => SKIP_DIR_NAMES.has(part))) continue;
      files.push({
        path,
        size: Number(file?.size || 0),
        read: async () => new Uint8Array(await file.arrayBuffer()),
      });
    }
    return { rootName: "", files: files.slice(0, MAX_SCAN_FILES) };
  }

  /**
   * Read the `manifest.json` of every candidate directory.
   *
   * Installed ID directories are skipped on purpose: their name and version
   * already come from `chrome.management`, and a large profile can hold hundreds
   * of extensions. Only uninstalled leftovers and unpacked source folders need
   * their manifest read.
   */
  async function readLocalManifests(files, options = {}) {
    const installedIds = new Set(
      (Array.isArray(options?.installed) ? options.installed : [])
        .map((entry) => String(entry?.id || ""))
        .filter(Boolean),
    );
    const list = normalizeFiles(files);
    const out = [];
    for (const file of list) {
      if (out.length >= MAX_MANIFESTS) break;
      const parts = file.path.split("/");
      if (parts[parts.length - 1] !== MANIFEST_FILE) continue;
      if (parts.length > 6) continue;
      if (Number(file.size || 0) > MAX_MANIFEST_BYTES) continue;
      if (installedIds.has(parts[parts.length - 3] || "")) continue;
      if (typeof file.read !== "function") continue;
      try {
        const json = JSON.parse(new TextDecoder().decode(await file.read()));
        out.push({
          path: file.path,
          name: String(json?.name || ""),
          version: String(json?.version || ""),
        });
      } catch {
        /* Not an extension manifest; the planner ignores it. */
      }
    }
    return out;
  }

  window.CCSyncExtensionLocalSource = {
    EXTENSION_ID_RE,
    MANIFEST_FILE,
    EXTENSIONS_DIR,
    MAX_PACKAGE_FILES,
    ZIP_DOS_DATE,
    ZIP_DOS_TIME,
    seg,
    hexToExtensionId,
    crc32,
    createZip,
    packageFileName,
    buildLocalPackage,
    readZipEntry,
    readZipManifestInfo,
    parseCrxId,
    detectLocalLayout,
    planLocalPackages,
    compareVersions,
    identifyUploadedPackage,
    scanDirectoryHandle,
    scanPickedFiles,
    readLocalManifests,
  };
})();
