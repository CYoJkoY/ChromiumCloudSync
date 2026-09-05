import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const root = process.cwd();
const out = path.join(root,'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
const version = manifest.version;
fs.rmSync(out,{recursive:true,force:true});
fs.mkdirSync(out,{recursive:true});
const zip = path.join(out,`chromium-cloud-sync-v${version}.zip`);
const entries = [
  'manifest.json','background.js','legacy-crypto.js','sync-core.js','i18n.js','theme.js','runtime.js','update.js',
  'popup.html','popup.js','options.html','options.js','history.html','history.js','guide.html','guide.js','ui.css',
  '_locales','icons'
];
execFileSync('zip',['-qr',zip,...entries],{cwd:root,stdio:'inherit'});
console.log(zip);
