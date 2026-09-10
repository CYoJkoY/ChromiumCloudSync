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

const runtimeArtifacts = [
  ['background.ts', 'background.js'],
  ['browser-capabilities.ts', 'browser-capabilities.js'],
  ['diagnostics.ts', 'diagnostics.js'],
  ['schema.ts', 'schema.js'],
  ['storage.ts', 'storage.js'],
  ['legacy-crypto.ts', 'legacy-crypto.js'],
  ['sync-core.ts', 'sync-core.js'],
  ['src/features/extension-storage-watch.ts', 'extension-storage-watch.js'],
  ['src/features/extension-storage.ts', 'extension-storage.js'],
  ['src/features/update.ts', 'update.js'],
  ['src/ui/extensions.ts', 'extensions.js'],
  ['src/ui/guide.ts', 'guide.js'],
  ['src/ui/history.ts', 'history.js'],
  ['src/ui/i18n.ts', 'i18n.js'],
  ['src/ui/options.ts', 'options.js'],
  ['src/ui/popup-fixes.ts', 'popup-fixes.js'],
  ['src/ui/popup-i18n.ts', 'popup-i18n.js'],
  ['src/ui/popup.ts', 'popup.js'],
  ['src/ui/runtime.ts', 'runtime.js'],
  ['src/ui/theme.ts', 'theme.js'],
] as const;

const extensionFiles = [
  'manifest.json',
  'popup.html', 'options.html', 'history.html', 'guide.html', 'extensions.html',
  'ui-overrides.css', 'ui-system.css', 'ui.css'
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

const version = releaseVersion || versionName || baseVersion;
if (version !== baseVersion && version !== versionName) {
  throw new Error(`Release version ${version} must match manifest.version ${baseVersion} or manifest.version_name ${versionName || '<empty>'}`);
}

fs.rmSync(compilerOut, { recursive: true, force: true });
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

const tsc = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';
execFileSync(tsc, ['-p', path.join(root, 'tsconfig.json')], { cwd: root, stdio: 'inherit' });

for (const [sourceFile, outputFile] of runtimeArtifacts) {
  const compiled = path.join(compilerOut, sourceFile.replace(/\.ts$/, '.js'));
  if (!fs.existsSync(compiled)) throw new Error(`Missing compiled extension file: ${sourceFile} -> ${outputFile}`);

  // TypeScript is the only source language. Compiled JavaScript exists only in
  // dist because Chrome extension runtime files must be JavaScript at package time.
  fs.copyFileSync(compiled, path.join(dist, outputFile));
}

for (const file of extensionFiles) {
  const source = path.join(root, file);
  if (!fs.existsSync(source)) throw new Error(`Missing extension file: ${file}`);
  fs.cpSync(source, path.join(dist, file), { recursive: true });
}

for (const directory of ['_locales', 'icons']) {
  const source = path.join(root, directory);
  if (!fs.existsSync(source)) throw new Error(`Missing extension directory: ${directory}`);
  fs.cpSync(source, path.join(dist, directory), { recursive: true });
}

if (!makeZip) {
  fs.rmSync(compilerOut, { recursive: true, force: true });
  console.log(`Prepared runnable extension in ${dist}`);
  process.exit(0);
}

const zip = path.join(dist, `chromium-cloud-sync-v${version}.zip`);
fs.rmSync(zip, { force: true });
const zipEntries = fs.readdirSync(dist).filter((entry) => entry !== path.basename(zip));
execFileSync('zip', ['-qr', zip, ...zipEntries], { cwd: dist, stdio: 'inherit' });
fs.rmSync(compilerOut, { recursive: true, force: true });
console.log(`Built ${version}: ${zip}`);
