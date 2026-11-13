import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const host = 'org.chromiumcloudsync.backup';
const windowsBrowsers = ['Google/Chrome', 'Microsoft/Edge', 'Chromium'];
const registryKey = browser => ['HKCU', 'Software', ...browser.split('/'), 'NativeMessagingHosts', host].join(String.fromCharCode(92));
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = file + '.new';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}
export function register({ extensionId, binaryArgument, remove = false, platform = process.platform, env = process.env, userHome = os.homedir(), execute = execFileSync }) {
  if (!/^[a-p]{32}$/.test(extensionId ?? '') || (!remove && !binaryArgument)) throw Error('Usage: node native/register.mjs EXTENSION_ID BINARY; node native/unregister.mjs EXTENSION_ID');
  if (!['win32', 'darwin', 'linux'].includes(platform)) throw Error('Unsupported OS');
  if (platform === 'win32' && !env.LOCALAPPDATA) throw Error('LOCALAPPDATA is required');
  const home = platform === 'win32' ? path.join(env.LOCALAPPDATA, 'ChromiumCloudSync') : platform === 'darwin' ? path.join(userHome, 'Library/Application Support/ChromiumCloudSync') : path.join(env.XDG_STATE_HOME || path.join(userHome, '.local/state'), 'ChromiumCloudSync');
  const allowFile = path.join(home, 'allowed-origins.json');
  const origins = fs.existsSync(allowFile) ? JSON.parse(fs.readFileSync(allowFile, 'utf8')) : [];
  if (!Array.isArray(origins) || !origins.every(x => typeof x === 'string' && new RegExp('^chrome-extension://[a-p]{32}/$').test(x))) throw Error('Invalid origin allowlist');
  const origin = 'chrome-extension://' + extensionId + '/';
  if (remove && !origins.includes(origin)) return { changed: false, manifests: [] };
  const allowedOrigins = remove ? origins.filter(x => x !== origin) : [...new Set([...origins, origin])];
  const base = platform === 'darwin' ? path.join(userHome, 'Library/Application Support') : (env.XDG_CONFIG_HOME || path.join(userHome, '.config'));
  const browsers = platform === 'darwin' ? ['Google/Chrome', 'Microsoft Edge', 'Chromium'] : ['google-chrome', 'microsoft-edge', 'chromium'];
  const manifests = platform === 'win32' ? [path.join(home, host + '.json')] : browsers.map(browser => path.join(base, browser, 'NativeMessagingHosts', host + '.json'));
  let binary;
  if (!remove) { binary = fs.realpathSync(binaryArgument); if (!fs.statSync(binary).isFile()) throw Error('Native binary must be a file'); }
  else if (fs.existsSync(manifests[0])) binary = JSON.parse(fs.readFileSync(manifests[0], 'utf8')).path;
  if (allowedOrigins.length && typeof binary !== 'string') throw Error('Cannot preserve remaining registrations without a native binary path');
  for (const file of manifests) if (fs.existsSync(file)) {
    const current = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (current.name !== host) throw Error('Refusing to replace a foreign native manifest');
  }
  if (platform === 'win32') for (const browser of windowsBrowsers) {
    const key = registryKey(browser);
    let current;
    try { current = String(execute('reg.exe', ['query', key, '/ve'], { encoding: 'utf8', windowsHide: true })); }
    catch (error) { if (error.status === 1) continue; throw error; }
    const value = current.match(/REG_SZ\s+([^\r\n]+)/)?.[1]?.trim();
    if (value !== manifests[0]) throw Error('Refusing to replace or delete another native registration');
  }
  if (!remove && platform !== 'win32') fs.chmodSync(binary, 0o700);
  if (allowedOrigins.length) {
    const manifest = { name: host, description: 'Chromium Cloud Sync offline extension backup', path: binary, type: 'stdio', allowed_origins: allowedOrigins };
    for (const file of manifests) write(file, manifest);
    write(allowFile, allowedOrigins);
    if (platform === 'win32') for (const browser of windowsBrowsers) execute('reg.exe', ['add', registryKey(browser), '/ve', '/t', 'REG_SZ', '/d', manifests[0], '/f'], { stdio: 'inherit', windowsHide: true });
  } else {
    if (platform === 'win32') for (const browser of windowsBrowsers) {
      try { execute('reg.exe', ['delete', registryKey(browser), '/ve', '/f'], { stdio: 'pipe', windowsHide: true }); }
      catch (error) { if (error.status !== 1) throw error; }
    }
    for (const file of [...manifests, allowFile]) if (fs.existsSync(file)) fs.unlinkSync(file);
  }
  return { changed: true, manifests };
}
