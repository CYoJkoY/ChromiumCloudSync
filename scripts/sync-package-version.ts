import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestPath = path.join(root, "manifest.json");
const packagePath = path.join(root, "package.json");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const pkg = JSON.parse(fs.readFileSync(packagePath, "utf8"));

const stableVersion = String(manifest.version || "").trim();

if (!/^\d+\.\d+\.\d+$/.test(stableVersion)) {
  throw new Error(
    `Invalid manifest version: ${stableVersion}. Expected X.Y.Z.`,
  );
}

if (Object.prototype.hasOwnProperty.call(manifest, "version_name")) {
  throw new Error(
    "manifest.version_name is disabled. Remove it and use a single stable release channel.",
  );
}

if (pkg.version !== stableVersion) {
  pkg.version = stableVersion;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  console.log(
    `Synchronized package.json version with stable manifest.version: ${stableVersion}`,
  );
} else {
  console.log(
    `package.json version already synchronized with stable manifest.version: ${stableVersion}`,
  );
}
