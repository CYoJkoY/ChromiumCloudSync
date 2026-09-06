import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const baseVersion = String(manifest.version || '').trim();
const versionName = String(manifest.version_name || '').trim();

if (!/^\d+\.\d+\.\d+$/.test(baseVersion)) throw new Error(`invalid manifest version ${baseVersion}; expected X.Y.Z`);
if (versionName && !/^\d+\.\d+\.\d+\.dev\d+$/.test(versionName)) throw new Error(`invalid manifest version_name ${versionName}; expected X.Y.Z.devN`);
if (versionName && !versionName.startsWith(`${baseVersion}.dev`)) throw new Error(`manifest version_name ${versionName} does not match manifest version ${baseVersion}`);
if (pkg.version !== baseVersion) throw new Error(`package.json version ${pkg.version} is not synchronized with manifest.version ${baseVersion}`);

const requiredFiles = ['background.js','sync-core.js','legacy-crypto.js','options.js','popup.js','popup-i18n.js','extension-storage.js','history.js','guide.js','i18n.js','runtime.js','theme.js','extensions.js'];
for (const f of requiredFiles) if (!fs.existsSync(path.join(root, f))) throw new Error(`Missing ${f}`);
for (const html of ['popup.html','options.html','history.html','guide.html','extensions.html']) if (!fs.existsSync(path.join(root, html))) throw new Error(`Missing ${html}`);

for (const f of fs.readdirSync(root).filter(x => x.endsWith('.js'))) execFileSync(process.execPath, ['--check', path.join(root, f)], {stdio: 'inherit'});

const filesToScan = ['background.js','sync-core.js','popup.js','popup-fixes.js','guide.js','README.md','extensions.js','extensions.html','options.html'];
for (const f of filesToScan) {
  const text = fs.readFileSync(path.join(root, f), 'utf8');
  if (/extensionSettings|applyExtensionSettings|collectExtensionSettings|settingsSyncTimer|applyingRemoteExtensionSettings/.test(text)) throw new Error(`Legacy extension-settings synchronization residue found in ${f}`);
}

const bg = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
if (bg.includes(`[LEGACY_ENCRYPTED_FILE]:{content:null}`)) throw new Error('Invalid Gist PATCH payload: legacy encrypted file must be deleted with a null file value, not null content');
if (!bg.includes('if(Object.prototype.hasOwnProperty.call(existingFiles||{},LEGACY_ENCRYPTED_FILE))files[LEGACY_ENCRYPTED_FILE]=null;')) throw new Error('Missing legacy encrypted file cleanup guard');

const optionsHtml = fs.readFileSync(path.join(root, 'options.html'), 'utf8');
if (optionsHtml.includes('extension-storage-layout.js')) throw new Error('Obsolete extension storage layout shim is still loaded');

const storage = fs.readFileSync(path.join(root, 'extension-storage.js'), 'utf8');
for (const required of ['extensionBackupGithubToken','extensionBackupSelectedIds','githubInfo','selection.json','ccsyncExtensionPackageInput']) {
  if (!storage.includes(required)) throw new Error(`Extension storage is missing ${required}`);
}
if (!storage.includes('token.l.hidden=!gh')) throw new Error('GitHub extension-backup token is not scoped to the GitHub backend UI');
if (!storage.includes("if(!d.private)throw Error(t('privateRepo'))")) throw new Error('GitHub extension-backup storage does not enforce private repositories');
if (!storage.includes("if(d.permissions&&!d.permissions.push)throw Error(t('notWritable'))")) throw new Error('GitHub extension-backup storage does not enforce write access');

console.log(`Validation passed for stable manifest ${baseVersion}${versionName ? ` (development name: ${versionName})` : ''}`);
