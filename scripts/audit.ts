import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const manifestPath = path.join(dist, 'manifest.json');

if (!fs.existsSync(manifestPath)) throw new Error('Security audit requires a built dist/ directory.');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const files = [];
function walk(dir, prefix = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, rel);
    else files.push(rel.replaceAll('\\', '/'));
  }
}
walk(dist);

const forbiddenArtifactPatterns = [/\.map$/i, /(^|\/)node_modules(\/|$)/i, /\.ts$/i];
for (const file of files) {
  if (forbiddenArtifactPatterns.some((pattern) => pattern.test(file))) {
    throw new Error(`Forbidden production artifact: ${file}`);
  }
}

const runtimeFiles = files.filter((file) => file.endsWith('.js'));
const runtimeCode = runtimeFiles.map((file) => fs.readFileSync(path.join(dist, file), 'utf8')).join('\n');
const forbiddenCode = [
  [/\beval\s*\(/, 'eval()'],
  [/\bnew\s+Function\s*\(/, 'new Function()'],
  [/from\s*["']https?:\/\//i, 'remote module import'],
];
for (const [pattern, label] of forbiddenCode) {
  if (pattern.test(runtimeCode)) throw new Error(`Forbidden runtime construct detected: ${label}`);
}

const htmlFiles = files.filter((file) => file.endsWith('.html'));
for (const file of htmlFiles) {
  const html = fs.readFileSync(path.join(dist, file), 'utf8');
  if (/<script[^>]+src=["']https?:\/\//i.test(html)) throw new Error(`Remote script reference in ${file}`);
  if (/<script[^>]*>[^<]+<\/script>/i.test(html)) throw new Error(`Inline script detected in ${file}`);
}

const allowedPermissions = new Set(['tabs', 'management', 'storage', 'alarms', 'bookmarks', 'tabGroups', 'downloads']);
for (const permission of manifest.permissions ?? []) {
  if (!allowedPermissions.has(permission)) throw new Error(`Unexpected extension permission: ${permission}`);
}
const allowedHosts = new Set(['https://api.github.com/*', 'https://gist.githubusercontent.com/*']);
for (const host of manifest.host_permissions ?? []) {
  if (!allowedHosts.has(host)) throw new Error(`Unexpected host permission: ${host}`);
}
if (manifest.background?.service_worker !== 'background.js') throw new Error('Manifest service worker must be background.js.');
if (manifest.background?.type !== 'module') throw new Error('Manifest service worker must remain an ES module.');

console.log(`Security audit passed: ${files.length} dist files, ${runtimeFiles.length} JavaScript runtime files.`);
