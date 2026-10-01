import assert from "node:assert/strict";
import zlib from "node:zlib";

/*
 * The local-source module is a page-context script, so it publishes itself on
 * `window`. Installing a minimal window before the import lets the exact code
 * the options page runs be exercised here — including the ZIP writer, the CRX
 * reader, and the folder planner — with no DOM and no browser.
 */
const win: Record<string, unknown> = {};
(globalThis as unknown as Record<string, unknown>).window = win;

await import("../src/features/extension-local-source.ts");

const api = win.CCSyncExtensionLocalSource as Record<string, any>;
assert.ok(api, "local source module must publish window.CCSyncExtensionLocalSource");

const {
  buildLocalPackage,
  compareVersions,
  createZip,
  crc32,
  detectLocalLayout,
  identifyUploadedPackage,
  packageFileName,
  parseCrxId,
  planLocalPackages,
  readZipEntry,
  readZipManifestInfo,
  scanPickedFiles,
} = api;

const enc = (text: string) => new TextEncoder().encode(text);
// Chromium IDs are 32 characters of the a-p alphabet (hex digits 0-f mapped
// onto a-p), which is what the layout detector has to accept.
const ID_A = "abcdefghijklmnopabcdefghijklmnop";
const ID_B = "bcdefghijklmnopabcdefghijklmnopa";
const ID_C = "cdefghijklmnopabcdefghijklmnopab";
const HEX_TO_ID = (hex: string) =>
  [...hex].map((char) => String.fromCharCode(97 + parseInt(char, 16))).join("");
const ID_TO_HEX = (id: string) =>
  [...id].map((char) => (char.charCodeAt(0) - 97).toString(16)).join("");

/* --------------------------------------------------------------------------
 * ZIP writing.
 * ------------------------------------------------------------------------ */
assert.equal(crc32(enc("hello world")), 0x0d4a1185, "crc32 matches the reference value");
assert.equal(crc32(new Uint8Array(0)), 0, "crc32 of empty input is zero");

{
  const bytes = createZip([
    { path: "manifest.json", bytes: enc('{"name":"Demo"}') },
    { path: "background/service.js", bytes: enc("console.log(1)") },
  ]);
  // Local header, central directory and end-of-central-directory signatures.
  assert.equal(
    [...bytes.subarray(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join(""),
    "504b0304",
    "archive starts with a local file header",
  );
  const eocdAt = bytes.length - 22;
  assert.equal(
    [...bytes.subarray(eocdAt, eocdAt + 4)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
    "504b0506",
    "archive ends with an end-of-central-directory record",
  );
  assert.equal(bytes[eocdAt + 10], 2, "both entries are recorded");
  assert.equal(bytes[eocdAt + 8], 2, "disk entry count matches");
  // UTF-8 name flag is set so non-ASCII extension files survive round-tripping.
  assert.equal(
    bytes[6] | (bytes[7] << 8),
    0x0800,
    "local header declares UTF-8 names",
  );
  const manifest = await readZipEntry(bytes, "manifest.json");
  assert.deepEqual(
    new TextDecoder().decode(manifest),
    '{"name":"Demo"}',
    "stored entry round-trips",
  );
  assert.equal(await readZipEntry(bytes, "missing.js"), null, "absent entry is null");

  // Deterministic output: the same content must hash to the same bytes, which is
  // what lets the backup index recognize an unchanged package.
  const again = createZip([
    { path: "background/service.js", bytes: enc("console.log(1)") },
    { path: "manifest.json", bytes: enc('{"name":"Demo"}') },
  ]);
  assert.deepEqual(again, bytes, "entry order and fixed timestamps keep output stable");
  assert.equal(packageFileName("uBlock Origin", "1.2.3"), "uBlock-Origin-1.2.3.zip");
  assert.equal(packageFileName("", ""), "package-unknown.zip");
}

/* --------------------------------------------------------------------------
 * Reading a foreign ZIP (deflated entries, produced by Node's zlib).
 * ------------------------------------------------------------------------ */
function deflatedZip(name: string, content: string): Uint8Array {
  const compressed = zlib.deflateRawSync(enc(content));
  const nameBytes = enc(name);
  const local = Buffer.alloc(30 + nameBytes.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(crc32(enc(content)), 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(enc(content).length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  local.set(nameBytes, 30);
  const central = Buffer.alloc(46 + nameBytes.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(crc32(enc(content)), 16);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(enc(content).length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  central.set(nameBytes, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + compressed.length, 16);
  return new Uint8Array(
    Buffer.concat([local, compressed, central, end]),
  );
}

{
  const bytes = deflatedZip(
    "manifest.json",
    JSON.stringify({ name: "Deflated Demo", version: "9.9.9" }),
  );
  const manifest = await readZipManifestInfo(bytes);
  assert.deepEqual(manifest, { name: "Deflated Demo", version: "9.9.9" });
  assert.equal(await readZipManifestInfo(enc("not a zip")), null);
}

/* --------------------------------------------------------------------------
 * CRX identity.
 * ------------------------------------------------------------------------ */
const publicKey = new Uint8Array(294).map((_, i) => (i * 7) % 251);
const expectedCrxId = await (async () => {
  const digest = await crypto.subtle.digest("SHA-256", publicKey);
  return HEX_TO_ID(
    [...new Uint8Array(digest)]
      .slice(0, 16)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(""),
  );
})();

function crx2(): Uint8Array {
  const signature = enc("signature-bytes");
  const head = Buffer.alloc(16);
  head.write("Cr24", 0, "latin1");
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(publicKey.length, 8);
  head.writeUInt32LE(signature.length, 12);
  return new Uint8Array(Buffer.concat([head, Buffer.from(publicKey), signature]));
}

function crx3(id: string): Uint8Array {
  const signed = Buffer.alloc(2 + 16);
  signed.writeUInt8(0x0a, 0);
  signed.writeUInt8(0x10, 1);
  // The crx_id field carries the raw 16-byte hash whose hex spelling is the ID.
  signed.write(ID_TO_HEX(id), 2, "hex");
  const proof = Buffer.alloc(4 + publicKey.length + 8);
  proof.writeUInt32LE(signed.length, 0);
  signed.copy(proof, 4);
  const head = Buffer.alloc(12);
  head.write("Cr24", 0, "latin1");
  head.writeUInt32LE(3, 4);
  head.writeUInt32LE(proof.length, 8);
  return new Uint8Array(Buffer.concat([head, proof]));
}

/** A CRX3 whose signed header is too small to hold a crx_id and has no key. */
function crx3TooShort(): Uint8Array {
  const head = Buffer.alloc(16);
  head.write("Cr24", 0, "latin1");
  head.writeUInt32LE(3, 4);
  head.writeUInt32LE(8, 8);
  head.writeUInt32LE(4, 12);
  return new Uint8Array(head);
}

assert.equal(await parseCrxId(crx2()), expectedCrxId, "CRX2 id is derived from its public key");
assert.equal(await parseCrxId(crx3(ID_A)), ID_A, "CRX3 id is read from the signed header");
assert.equal(
  await parseCrxId(crx3("a".repeat(32))),
  "a".repeat(32),
  "an all-zero crx_id is reported as-is",
);
assert.equal(
  api.hexToExtensionId("0123456789abcdef"),
  "abcdefghijklmnop",
  "hex digits map onto the a-p ID alphabet",
);
assert.equal(await parseCrxId(crx3TooShort()), null, "a header without a crx_id or key is rejected");
assert.equal(await parseCrxId(enc("Cr24-truncated")), null, "truncated headers are rejected");
assert.equal(await parseCrxId(new Uint8Array(64)), null, "non-CRX bytes are rejected");

/* --------------------------------------------------------------------------
 * Layout detection.
 * ------------------------------------------------------------------------ */
{
  const profile = [
    { path: "Default/Extensions/" + ID_A + "/manifest.json", size: 10 },
    { path: "Default/Extensions/" + ID_A + "/1.0.0/background.js", size: 20 },
    { path: "Profile 1/Extensions/" + ID_B + "/2.0.0/background.js", size: 30 },
    { path: "Local State", size: 40 },
  ];
  const layout = detectLocalLayout(profile);
  assert.equal(layout.mode, "profile", "a user-data folder is detected by its Extensions trees");
  assert.deepEqual(layout.roots, ["Default/Extensions", "Profile 1/Extensions"]);

  const extensionsRoot = [
    { path: ID_A + "/1.0.0/background.js", size: 20 },
    { path: ID_B + "/2.0.0/background.js", size: 30 },
    { path: "Temp/scratch/1.0.0/x.js", size: 1 },
  ];
  assert.equal(detectLocalLayout(extensionsRoot).mode, "extensions");
  assert.deepEqual(detectLocalLayout(extensionsRoot).roots, [""]);

  const loose = [
    { path: "my-extension/manifest.json", size: 10 },
    { path: "my-extension/background.js", size: 20 },
  ];
  assert.equal(detectLocalLayout(loose).mode, "loose");
  assert.deepEqual(detectLocalLayout([]).roots, [""]);

  // Browser-internal profile directories are never walked: a profile carries
  // hundreds of megabytes of cache and site storage that cannot be an extension.
  const withCache = [
    { path: "Default/Cache/data_0", size: 4096 },
    { path: "Default/Code Cache/js/x", size: 4096 },
    { path: "Default/IndexedDB/https_example.test/0.indexeddb.leveldb/000003.log", size: 99 },
    { path: "Default/Extensions/" + ID_A + "/1.2.0/manifest.json", size: 12 },
  ];
  assert.deepEqual(
    detectLocalLayout(withCache).roots,
    ["Default/Extensions"],
    "cache directories do not disturb layout detection",
  );
  const scanned = scanPickedFiles(
    withCache.map((entry) => ({
      name: entry.path.split("/").pop(),
      size: entry.size,
      webkitRelativePath: entry.path,
    })),
  );
  assert.deepEqual(
    scanned.files.map((file) => file.path),
    ["Default/Extensions/" + ID_A + "/1.2.0/manifest.json"],
    "the input-based scan drops browser-internal directories",
  );
}

/* --------------------------------------------------------------------------
 * Planning: what gets packaged, under which identity.
 * ------------------------------------------------------------------------ */
const installed = [
  { id: ID_A, name: "Alpha", version: "1.2.0", installType: "normal" },
  { id: ID_B, name: "Beta", version: "5.0.0", installType: "development" },
];

function filesAt(paths: string[]) {
  return paths.map((path) => ({
    path,
    size: 128,
    read: async () => enc(`content of ${path}`),
  }));
}

{
  // Profile layout, including an uninstalled leftover and an unrelated directory.
  const files = filesAt([
    "Default/Preferences",
    `Default/Extensions/${ID_A}/1.2.0/manifest.json`,
    `Default/Extensions/${ID_A}/1.2.0/background.js`,
    `Default/Extensions/${ID_C}/0.1.0/manifest.json`,
    `Default/Extensions/${ID_C}/0.1.0/background.js`,
    "Default/Extensions/Temp/1.0.0/scratch.js",
    "Default/Sync Data/LevelDB/000003.log",
  ]);
  const plan = planLocalPackages({
    files,
    manifests: [
      { path: `Default/Extensions/${ID_C}/0.1.0/manifest.json`, name: "Gamma", version: "0.1.0" },
    ],
    installed,
  });
  const byId = new Map(plan.packages.map((item) => [item.extensionId, item]));
  assert.deepEqual(
    [...byId.keys()].sort(),
    [ID_A, ID_C].sort(),
    "installed extensions and local leftovers are both planned",
  );
  const alpha = byId.get(ID_A);
  assert.equal(alpha.matchKind, "id");
  assert.equal(alpha.version, "1.2.0");
  assert.equal(alpha.versionMismatch, false);
  assert.equal(alpha.fileCount, 2);
  assert.equal(alpha.totalSize, 256);
  assert.deepEqual(
    alpha.files.map((file) => file.path),
    [
      `Default/Extensions/${ID_A}/1.2.0/background.js`,
      `Default/Extensions/${ID_A}/1.2.0/manifest.json`,
    ],
    "the installed version directory is preferred",
  );
  const gamma = byId.get(ID_C);
  assert.equal(gamma.matchKind, "orphan", "an uninstalled leftover is still packaged under its own ID");
  assert.equal(gamma.name, "Gamma", "the leftover name comes from its manifest");
  assert.equal(gamma.installed, false);
  assert.deepEqual(
    plan.missing.map((entry) => entry.id),
    [ID_B],
    "extensions without local files are reported as missing",
  );
  // Beta is a development install: its files are not in the profile at all.
  assert.equal(plan.packages.some((item) => item.extensionId === ID_B), false);

  // A different local version is packaged under the version it actually is, and
  // flagged, instead of silently relabelling old bytes as the installed one.
  const stale = planLocalPackages({
    files: filesAt([
      `Default/Extensions/${ID_A}/1.1.0/manifest.json`,
      `Default/Extensions/${ID_A}/1.1.0/background.js`,
    ]),
    manifests: [],
    installed,
  });
  assert.equal(stale.packages.length, 1);
  assert.equal(stale.packages[0].version, "1.1.0");
  assert.equal(stale.packages[0].versionMismatch, true);
  assert.equal(stale.packages[0].installedVersion, "1.2.0");

  // Two version directories: the installed one wins over the newer leftover.
  const twoVersions = planLocalPackages({
    files: filesAt([
      `Default/Extensions/${ID_A}/1.0.0/manifest.json`,
      `Default/Extensions/${ID_A}/1.2.0/manifest.json`,
    ]),
    manifests: [],
    installed,
  });
  assert.equal(twoVersions.packages[0].version, "1.2.0");
  assert.equal(compareVersions("1.10.0", "1.9.0") > 0, true, "numeric version segments compare numerically");
  assert.equal(compareVersions("1.2.0", "1.2.0"), 0);
}

{
  // A development folder: no ID directories, only manifest-matched sources.
  const files = filesAt([
    "alpha-source/manifest.json",
    "alpha-source/background.js",
    "unrelated/notes.txt",
  ]);
  const plan = planLocalPackages({
    files,
    manifests: [
      { path: "alpha-source/manifest.json", name: "Alpha", version: "1.2.0" },
    ],
    installed,
  });
  assert.equal(plan.packages.length, 1);
  assert.equal(plan.packages[0].extensionId, ID_A);
  assert.equal(plan.packages[0].matchKind, "manifest");
  assert.deepEqual(
    plan.packages[0].files.map((file) => file.path),
    ["alpha-source/background.js", "alpha-source/manifest.json"],
  );
  assert.deepEqual(plan.missing.map((entry) => entry.id), [ID_B]);

  // Two folders claiming the same name and version must not be guessed at.
  const ambiguous = planLocalPackages({
    files: filesAt([
      "alpha-source/manifest.json",
      "alpha-copy/manifest.json",
    ]),
    manifests: [
      { path: "alpha-source/manifest.json", name: "Alpha", version: "1.2.0" },
      { path: "alpha-copy/manifest.json", name: "Alpha", version: "1.2.0" },
    ],
    installed,
  });
  assert.equal(ambiguous.packages.length, 0, "an ambiguous match is never packaged");
  assert.deepEqual(ambiguous.ambiguous, [ID_A]);

  // A name match with a different version is not a match.
  const wrongVersion = planLocalPackages({
    files: filesAt(["alpha-source/manifest.json"]),
    manifests: [
      { path: "alpha-source/manifest.json", name: "Alpha", version: "0.0.1" },
    ],
    installed,
  });
  assert.equal(wrongVersion.packages.length, 0);
}

/* --------------------------------------------------------------------------
 * Packaging a planned directory.
 * ------------------------------------------------------------------------ */
{
  const plan = planLocalPackages({
    files: filesAt([`Default/Extensions/${ID_A}/1.2.0/manifest.json`, `Default/Extensions/${ID_A}/1.2.0/js/main.js`]),
    manifests: [],
    installed,
  });
  const built = await buildLocalPackage(plan.packages[0]);
  assert.equal(built.fileName, "Alpha-1.2.0.zip");
  assert.equal(built.fileCount, 2);
  assert.equal(built.skipped, 0);
  assert.deepEqual(
    new TextDecoder().decode(await readZipEntry(built.bytes, "js/main.js")),
    `content of Default/Extensions/${ID_A}/1.2.0/js/main.js`,
    "archive entries are relative to the extension directory",
  );
  assert.ok(
    (await readZipEntry(built.bytes, "manifest.json")) !== null,
    "the manifest travels with the package",
  );
  // A directory with more files than the cap must fail loudly instead of
  // silently producing a partial archive.
  const tooMany = Array.from({ length: api.MAX_PACKAGE_FILES + 1 }, (_, i) => ({
    path: `x/f${i}.js`,
    size: 1,
    read: async () => enc("x"),
  }));
  assert.equal(
    await buildLocalPackage({ rootPath: "x", files: tooMany }).then(
      () => null,
      (error) => error?.message,
    ),
    "too-many-files",
    "oversized directories are refused, not truncated",
  );
  const unreadable = await buildLocalPackage({
    rootPath: "x",
    files: [{ path: "x/manifest.json", size: 1, read: async () => { throw Error("locked"); } }],
  }).then(
    () => null,
    (error) => error,
  );
  assert.ok(unreadable instanceof Error, "a directory with no readable files fails loudly");
}

/* --------------------------------------------------------------------------
 * Identifying uploaded archives.
 * ------------------------------------------------------------------------ */
{
  const crxMatch = await identifyUploadedPackage({
    fileName: "whatever.crx",
    bytes: crx2(),
    installed: [{ id: expectedCrxId, name: "Alpha", version: "1.2.0" }, ...installed],
  });
  assert.equal(
    crxMatch?.extension?.id,
    expectedCrxId,
    "an uploaded CRX is filed by its embedded ID",
  );
  assert.equal(crxMatch?.how, "crx-id");

  const zipMatch = await identifyUploadedPackage({
    fileName: "beta-backup.zip",
    bytes: deflatedZip("manifest.json", JSON.stringify({ name: "Beta", version: "5.0.0" })),
    installed,
  });
  assert.equal(zipMatch?.extension?.id, ID_B, "an uploaded ZIP is filed by its manifest");

  const nameMatch = await identifyUploadedPackage({
    fileName: "Alpha-1.2.0.zip",
    bytes: null,
    installed,
  });
  assert.equal(nameMatch?.extension?.id, ID_A, "a filename match is accepted when it is unique");

  const duplicateNames = await identifyUploadedPackage({
    fileName: "Alpha-1.2.0.zip",
    bytes: null,
    installed: [
      { id: ID_A, name: "Alpha", version: "1.2.0" },
      { id: ID_B, name: "Alpha", version: "1.2.0" },
    ],
  });
  assert.equal(duplicateNames, null, "an ambiguous filename is not filed anywhere");

  const unknown = await identifyUploadedPackage({
    fileName: "mystery.zip",
    bytes: null,
    installed,
  });
  assert.equal(unknown, null);
}

/* --------------------------------------------------------------------------
 * webkitdirectory input scanning.
 * ------------------------------------------------------------------------ */
{
  const fakeFile = (name: string, size: number, body = "x") => {
    const blob = new Blob([body]);
    Object.defineProperty(blob, "name", { value: name });
    Object.defineProperty(blob, "webkitRelativePath", {
      value: `Extensions/${name}`,
    });
    Object.defineProperty(blob, "size", { value: size });
    return blob;
  };
  const scanned = scanPickedFiles([fakeFile("manifest.json", 10, "{}")]);
  assert.equal(scanned.files.length, 1);
  assert.equal(scanned.files[0].path, "Extensions/manifest.json");
  assert.deepEqual(
    new TextDecoder().decode(await scanned.files[0].read()),
    "{}",
    "dropped/picked files are readable through the same reader",
  );
}

console.log("Local extension source tests passed.");
