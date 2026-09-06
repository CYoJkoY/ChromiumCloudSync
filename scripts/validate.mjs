import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const baseVersion = String(manifest.version || '').trim();
const versionName = String(manifest.version_name || '').trim();

if (!/^\d+\.\d+\.\d+$/.test(baseVersion)) {
  throw new Error(`invalid manifest version ${baseVersion}; expected X.Y.Z`);
}

if (versionName && !/^\d+\.\d+\.\d+\.dev\d+$/.test(versionName)) {
  throw new Error(`invalid manifest version_name ${versionName}; expected X.Y.Z.devN`);
}

if (versionName && !versionName.startsWith(`${baseVersion}.dev`)) {
  throw new Error(`manifest version_name ${versionName} does not match manifest version ${baseVersion}`);
}

if (pkg.version !== baseVersion) {
  throw new Error(`package.json version ${pkg.version} is not synchronized with manifest.version ${baseVersion}`);
}

for (const f of fs.readdirSync(root).filter(x => x.endsWith('.js'))) {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['--check', path.join(root, f)], {stdio: 'inherit'});
}

for (const f of ['background.js','sync-core.js','legacy-crypto.js','options.js','popup.js','popup-i18n.js','extension-storage.js','extension-storage-layout.js','history.js','guide.js','i18n.js','runtime.js','theme.js']) {
  if (!fs.existsSync(path.join(root, f))) throw new Error(`Missing ${f}`);
}

const bg = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
if (bg.includes(`[LEGACY_ENCRYPTED_FILE]:{content:null}`)) throw new Error('Invalid Gist PATCH payload: legacy encrypted file must be deleted with a null file value, not null content');
if (!bg.includes('if(Object.prototype.hasOwnProperty.call(existingFiles||{},LEGACY_ENCRYPTED_FILE))files[LEGACY_ENCRYPTED_FILE]=null;')) throw new Error('Missing legacy encrypted file cleanup guard');

console.log(`Validation passed for stable manifest ${baseVersion}${versionName ? ` (development name: ${versionName})` : ''}`);
