import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error(`invalid manifest version ${manifest.version}`);
for (const f of fs.readdirSync(root).filter(x=>x.endsWith('.js'))) {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath,['--check',path.join(root,f)],{stdio:'inherit'});
}
for (const f of ['background.js','sync-core.js','legacy-crypto.js','options.js','popup.js','popup-i18n.js','extension-storage.js','extension-storage-layout.js','history.js','guide.js','i18n.js','runtime.js','theme.js']) {
  if (!fs.existsSync(path.join(root,f))) throw new Error(`Missing ${f}`);
}
const bg = fs.readFileSync(path.join(root,'background.js'),'utf8');
if (bg.includes(`[LEGACY_ENCRYPTED_FILE]:{content:null}`)) throw new Error('Invalid Gist PATCH payload: legacy encrypted file must be deleted with a null file value, not null content');
if (!bg.includes('if(Object.prototype.hasOwnProperty.call(existingFiles||{},LEGACY_ENCRYPTED_FILE))files[LEGACY_ENCRYPTED_FILE]=null;')) throw new Error('Missing legacy encrypted file cleanup guard');
console.log('Validation passed');
