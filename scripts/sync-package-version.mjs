import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestPath = path.join(root, 'manifest.json');
const packagePath = path.join(root, 'package.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

const baseVersion = String(manifest.version || '').trim();
const displayVersion = String(manifest.version_name || '').trim();

if (!/^\d+\.\d+\.\d+$/.test(baseVersion)) {
  throw new Error(`Invalid manifest version: ${baseVersion}. Expected X.Y.Z.`);
}

const effectiveVersion = displayVersion || baseVersion;
if (!/^\d+\.\d+\.\d+(?:\.dev\d+)?$/.test(effectiveVersion)) {
  throw new Error(`Invalid manifest version_name: ${effectiveVersion}. Expected X.Y.Z or X.Y.Z.devN.`);
}

if (displayVersion && !displayVersion.startsWith(`${baseVersion}.dev`)) {
  throw new Error(
    `manifest.version_name (${displayVersion}) must be ${baseVersion} or start with ${baseVersion}.dev`
  );
}

if (pkg.version !== effectiveVersion) {
  pkg.version = effectiveVersion;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  console.log(`Synchronized package.json version: ${effectiveVersion}`);
} else {
  console.log(`package.json version already synchronized: ${effectiveVersion}`);
}
