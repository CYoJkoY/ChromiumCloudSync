import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestPath = path.join(root, 'manifest.json');
const packagePath = path.join(root, 'package.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

const stableVersion = String(manifest.version || '').trim();
const versionName = String(manifest.version_name || '').trim();

if (!/^\d+\.\d+\.\d+$/.test(stableVersion)) {
  throw new Error(`Invalid manifest version: ${stableVersion}. Expected X.Y.Z.`);
}

if (versionName && !/^\d+\.\d+\.\d+\.dev\d+$/.test(versionName)) {
  throw new Error(`Invalid manifest version_name: ${versionName}. Expected X.Y.Z.devN.`);
}

if (versionName && !versionName.startsWith(`${stableVersion}.dev`)) {
  throw new Error(`manifest.version_name (${versionName}) does not match manifest.version (${stableVersion}).`);
}

if (pkg.version !== stableVersion) {
  pkg.version = stableVersion;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  console.log(`Synchronized package.json version with stable manifest.version: ${stableVersion}`);
} else {
  console.log(`package.json version already synchronized with stable manifest.version: ${stableVersion}`);
}
