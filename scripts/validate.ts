import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const baseVersion = String(manifest.version || '').trim();
const versionName = String(manifest.version_name || '').trim();

if (!/^\d+\.\d+\.\d+$/.test(baseVersion)) throw new Error(`invalid manifest version ${baseVersion}; expected X.Y.Z`);
if (versionName && !/^\d+\.\d+\.\d+\.dev\d+$/.test(versionName)) throw new Error(`invalid manifest version_name ${versionName}; expected X.Y.Z.devN`);
if (versionName && !versionName.startsWith(`${baseVersion}.dev`)) throw new Error(`manifest version_name ${versionName} does not match manifest version ${baseVersion}`);
if (pkg.version !== baseVersion) throw new Error(`package.json version ${pkg.version} is not synchronized with manifest.version ${baseVersion}`);
if (manifest.background?.service_worker !== 'background.js') throw new Error('Manifest background service worker must remain background.js in the built extension');

const sourceFiles = [
  'src/runtime/types.ts', 'src/runtime/sync-core.ts', 'src/runtime/schema.ts', 'src/runtime/storage.ts',
  'src/runtime/browser-capabilities.ts', 'src/runtime/diagnostics.ts', 'src/runtime/legacy-crypto.ts', 'src/runtime/background.ts',
  'src/features/extension-storage.ts', 'src/features/extension-storage-watch.ts', 'src/features/update.ts',
  'src/ui/extensions.ts', 'src/ui/guide.ts', 'src/ui/history.ts', 'src/ui/i18n.ts', 'src/ui/options.ts',
  'src/ui/popup.ts', 'src/ui/popup-i18n.ts', 'src/ui/popup-fixes.ts', 'src/ui/runtime.ts', 'src/ui/theme.ts',
];
const htmlFiles = ['popup.html', 'options.html', 'history.html', 'guide.html', 'extensions.html'];
const htmlSources = Object.fromEntries(htmlFiles.map((file) => [file, `src/ui/pages/${file}`]));
const requiredRefs = {
  'popup.html': ['runtime.js', 'theme.js', 'i18n.js', 'popup-i18n.js', 'popup.js', 'update.js', 'popup-fixes.js'],
  'options.html': ['runtime.js', 'theme.js', 'i18n.js', 'extension-storage.js', 'options.js'],
  'history.html': ['runtime.js', 'theme.js', 'i18n.js', 'history.js'],
  'guide.html': ['theme.js', 'guide.js'],
  'extensions.html': ['runtime.js', 'theme.js', 'i18n.js', 'extensions.js'],
};
const runtimeFiles = [
  'background.js', 'browser-capabilities.js', 'diagnostics.js', 'legacy-crypto.js', 'schema.js', 'storage.js', 'sync-core.js', 'types.js',
  'extension-storage.js', 'extension-storage-watch.js', 'update.js', 'extensions.js', 'guide.js', 'history.js', 'i18n.js', 'options.js', 'popup.js', 'popup-i18n.js', 'popup-fixes.js', 'runtime.js', 'theme.js',
];

for (const file of sourceFiles) if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing TypeScript source ${file}`);
for (const [file, source] of Object.entries(htmlSources)) if (!fs.existsSync(path.join(root, source))) throw new Error(`Missing HTML source ${source}`);
for (const file of ['src/ui/styles/ui.css', 'src/ui/styles/ui-system.css', 'src/ui/styles/ui-overrides.css']) if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing CSS source ${file}`);
if (!fs.existsSync(path.join(root, 'tsconfig.strict.json'))) throw new Error('Missing strict TypeScript configuration.');

for (const entry of fs.readdirSync(root)) {
  if (/\.(ts|tsx|html|css)$/i.test(entry)) throw new Error(`Extension source file must not live in repository root: ${entry}`);
}

const trackedJs = execFileSync('git', ['ls-files', '-z', '--', '*.js'], { cwd: root, encoding: 'utf8' });
if (trackedJs) throw new Error(`Tracked JavaScript source files are forbidden:\n${trackedJs.split('\0').filter(Boolean).join('\n')}`);

for (const html of htmlFiles) {
  const text = fs.readFileSync(path.join(root, htmlSources[html]), 'utf8');
  for (const script of requiredRefs[html]) if (!text.includes(`src="${script}"`)) throw new Error(`${html} is missing generated runtime reference ${script}`);
  if (/<script[^>]+src="(?:\.\/)?dist\//i.test(text)) throw new Error(`${html} must use extension-root runtime paths`);
}

for (const file of runtimeFiles) {
  const target = path.join(dist, file);
  if (!fs.existsSync(target)) throw new Error(`Missing generated dist runtime ${file}; run npm run build:extension first`);
  execFileSync(process.execPath, ['--check', target], { stdio: 'inherit' });
}

const distManifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
if (distManifest.background?.service_worker !== 'background.js') throw new Error('Built manifest background service worker must remain background.js');
for (const html of htmlFiles) {
  const text = fs.readFileSync(path.join(dist, html), 'utf8');
  for (const script of requiredRefs[html]) {
    if (!text.includes(`src="${script}"`)) throw new Error(`Built ${html} is missing script reference ${script}`);
    if (!fs.existsSync(path.join(dist, script))) throw new Error(`Built ${html} references missing runtime ${script}`);
  }
}

const scanFiles = ['src/runtime/background.ts', 'src/runtime/sync-core.ts', 'src/ui/popup.ts', 'src/ui/popup-fixes.ts', 'src/ui/guide.ts', 'README.md', 'src/ui/extensions.ts', 'src/ui/pages/extensions.html', 'src/ui/pages/options.html'];
for (const file of scanFiles) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  if (/extensionSettings|applyExtensionSettings|collectExtensionSettings|settingsSyncTimer|applyingRemoteExtensionSettings/.test(text)) throw new Error(`Legacy extension-settings synchronization residue found in ${file}`);
}

const bg = fs.readFileSync(path.join(root, 'src/runtime/background.ts'), 'utf8');
if (bg.includes(`[LEGACY_ENCRYPTED_FILE]:{content:null}`)) throw new Error('Invalid Gist PATCH payload: legacy encrypted file must be deleted with a null file value, not null content');
if (!bg.includes('if(Object.prototype.hasOwnProperty.call(existingFiles||{},LEGACY_ENCRYPTED_FILE))files[LEGACY_ENCRYPTED_FILE]=null;')) throw new Error('Missing legacy encrypted file cleanup guard');

const optionsHtml = fs.readFileSync(path.join(root, 'src/ui/pages/options.html'), 'utf8');
if (optionsHtml.includes('extension-storage-layout.js')) throw new Error('Obsolete extension storage layout shim is still loaded');
if (!optionsHtml.includes('id="extensionStorageNavLabel"')) throw new Error('Missing extension storage navigation label anchor');
if (!optionsHtml.includes('id="extensionStoragePanelTitle"')) throw new Error('Missing extension storage panel title anchor');
if (!optionsHtml.includes('id="extensionStoragePanelDescription"')) throw new Error('Missing extension storage panel description anchor');

const storage = fs.readFileSync(path.join(root, 'src/features/extension-storage.ts'), 'utf8');
for (const required of ['extensionBackupGithubToken', 'extensionBackupSelectedIds', 'githubInfo', 'selection.json', 'ccsyncExtensionPackageInput', 'sameStorageConfig', 'ccsync-ext-hidden', 'refreshLanguage']) if (!storage.includes(required)) throw new Error(`Extension storage is missing ${required}`);
if (!storage.includes('setHidden(el,!gh)')) throw new Error('GitHub extension-backup fields do not use explicit dynamic visibility');
if (!storage.includes('setHidden(el,!dv)')) throw new Error('WebDAV extension-backup fields do not use explicit dynamic visibility');
if (!storage.includes("if(!d.private)throw Error(t('privateRepo'))")) throw new Error('GitHub extension-backup storage does not enforce private repositories');
if (!storage.includes("if(d.permissions&&!d.permissions.push)throw Error(t('notWritable'))")) throw new Error('GitHub extension-backup storage does not enforce write access');
if (!storage.includes('String(a.token||\'\').trim()===String(b.token||\'\').trim()')) throw new Error('GitHub extension-backup selection matching does not include the Token');
if (!storage.includes('String(a.davPass||\'\')===String(b.davPass||\'\')')) throw new Error('WebDAV extension-backup selection matching does not include the password');

console.log(`Validation passed for organized TypeScript sources and generated runtime ${baseVersion}${versionName ? ` (${versionName})` : ''}`);
