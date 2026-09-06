import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const out = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const baseVersion = String(manifest.version || '').trim();
const versionName = String(manifest.version_name || '').trim();
const releaseVersion = String(process.env.RELEASE_VERSION || '').trim();

if (!/^\d+\.\d+\.\d+$/.test(baseVersion)) {
  throw new Error(`Invalid manifest version: ${baseVersion}; expected X.Y.Z`);
}
if (versionName && !/^\d+\.\d+\.\d+\.dev\d+$/.test(versionName)) {
  throw new Error(`Invalid manifest version_name: ${versionName}; expected X.Y.Z.devN`);
}
if (versionName && !versionName.startsWith(`${baseVersion}.dev`)) {
  throw new Error(`manifest.version_name (${versionName}) does not match manifest.version (${baseVersion})`);
}

// Release workflow supplies the channel-specific build version.
// Without it, local builds intentionally default to the stable manifest.version.
const version = releaseVersion || baseVersion;
if (version !== baseVersion && version !== versionName) {
  throw new Error(`Release version ${version} must match manifest.version ${baseVersion} or manifest.version_name ${versionName || '<empty>'}`);
}

fs.rmSync(out, {recursive: true, force: true});
fs.mkdirSync(out, {recursive: true});

const zip = path.join(out, `chromium-cloud-sync-v${version}.zip`);
const entries = [
  'manifest.json', 'background.js', 'legacy-crypto.js', 'sync-core.js', 'i18n.js', 'theme.js', 'runtime.js', 'update.js', 'extension-storage.js', 'extension-storage-layout.js', 'extension-storage-watch.js', 'popup-i18n.js', 'ui-overrides.css',
  'popup.html', 'popup.js', 'options.html', 'options.js', 'history.html', 'history.js', 'guide.html', 'guide.js', 'ui.css',
  '_locales', 'icons'
];

execFileSync('zip', ['-qr', zip, ...entries], {cwd: root, stdio: 'inherit'});
console.log(`Built ${version}: ${zip}`);
