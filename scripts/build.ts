import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const compilerOut = path.join(root, '.build');
const dist = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const baseVersion = String(manifest.version || '').trim();
const versionName = String(manifest.version_name || '').trim();
const releaseVersion = String(process.env.RELEASE_VERSION || '').trim();
const makeZip = process.argv.includes('--zip');

const runtimeFiles = [
  'background.js', 'extension-storage-watch.js', 'extension-storage.js', 'extensions.js',
  'guide.js', 'history.js', 'i18n.js', 'legacy-crypto.js', 'options.js', 'popup-fixes.js',
  'popup-i18n.js', 'popup.js', 'runtime.js', 'sync-core.js', 'theme.js', 'update.js'
];

if (!/^\d+\.\d+\.\d+$/.test(baseVersion)) {
  throw new Error(`Invalid manifest version: ${baseVersion}; expected X.Y.Z`);
}
if (versionName && !/^\d+\.\d+\.\d+\.dev\d+$/.test(versionName)) {
  throw new Error(`Invalid manifest version_name: ${versionName}; expected X.Y.Z.devN`);
}
if (versionName && !versionName.startsWith(`${baseVersion}.dev`)) {
  throw new Error(`manifest.version_name (${versionName}) does not match manifest.version (${baseVersion})`);
}

const version = releaseVersion || baseVersion;
if (version !== baseVersion && version !== versionName) {
  throw new Error(`Release version ${version} must match manifest.version ${baseVersion} or manifest.version_name ${versionName || '<empty>'}`);
}

fs.rmSync(compilerOut, { recursive: true, force: true });
fs.rmSync(dist, { recursive: true, force: true });
for (const file of runtimeFiles) fs.rmSync(path.join(root, file), { force: true });

const tsc = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';
execFileSync(tsc, ['-p', path.join(root, 'tsconfig.json')], { cwd: root, stdio: 'inherit' });

fs.mkdirSync(dist, { recursive: true });
for (const file of runtimeFiles) {
  const compiled = path.join(compilerOut, file);
  if (!fs.existsSync(compiled)) throw new Error(`Missing compiled extension file: ${file}`);
  fs.copyFileSync(compiled, path.join(root, file));
}

if (!makeZip) {
  fs.rmSync(compilerOut, { recursive: true, force: true });
  console.log(`Prepared extension runtime JavaScript from TypeScript sources in ${root}`);
  process.exit(0);
}

const zip = path.join(dist, `chromium-cloud-sync-v${version}.zip`);
fs.rmSync(zip, { force: true });
const entries = [
  'manifest.json', 'background.js', 'legacy-crypto.js', 'sync-core.js', 'i18n.js', 'theme.js', 'runtime.js',
  'update.js', 'extension-storage.js', 'extension-storage-watch.js', 'popup-i18n.js', 'popup.js',
  'options.js', 'history.js', 'guide.js', 'extensions.js', 'popup-fixes.js',
  'ui-overrides.css', 'ui-system.css', 'ui.css', 'popup.html', 'options.html', 'history.html', 'guide.html', 'extensions.html',
  '_locales', 'icons'
];
execFileSync('zip', ['-qr', zip, ...entries], { cwd: root, stdio: 'inherit' });
fs.rmSync(compilerOut, { recursive: true, force: true });
console.log(`Built ${version}: ${zip}`);
