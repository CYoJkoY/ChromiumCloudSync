import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifestPath = path.join(root, 'manifest.json');
const packagePath = path.join(root, 'package.json');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));

const manifestVersion = String(manifest.version || '').trim();

if (!/^\d+\.\d+\.\d+$/.test(manifestVersion)) {
  throw new Error(`Invalid manifest version: ${manifestVersion}. Expected X.Y.Z.`);
}

if (pkg.version !== manifestVersion) {
  pkg.version = manifestVersion;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8');
  console.log(`Synchronized package.json version with manifest.version: ${manifestVersion}`);
} else {
  console.log(`package.json version already synchronized: ${manifestVersion}`);
}
