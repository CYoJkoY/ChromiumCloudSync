import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const CDP_COMMAND_TIMEOUT_MS = 10000;

function chromiumExecutable() {
  const candidates = process.platform === 'win32'
    ? [process.env.CHROME_PATH, 'chrome.exe', 'msedge.exe']
    : process.platform === 'darwin'
      ? [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
      : [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable'];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (fs.existsSync(candidate)) return candidate;
    } else {
      try {
        execFileSync(candidate, ['--version'], { stdio: 'ignore' });
        return candidate;
      } catch {}
    }
  }
  throw new Error('Chromium/Chrome executable not found. Set CHROME_PATH or install Chromium.');
}

async function waitFor<T>(read: () => Promise<T | null>, timeoutMs = 15000): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await read();
    if (value != null) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

async function json(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json();
}

class CdpClient {
  private nextId = 0;
  private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message || 'CDP command failed'));
      else pending.resolve(message.result);
    });

    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('CDP WebSocket closed'));
      }
      this.pending.clear();
    });
  }

  command(method: string, params: Record<string, unknown> = {}) {
    const id = ++this.nextId;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, CDP_COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function main() {
  if (!fs.existsSync(path.join(dist, 'manifest.json'))) {
    throw new Error('dist/manifest.json is missing; run npm run build:extension first');
  }

  const executable = chromiumExecutable();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-cloud-sync-smoke-'));
  const remoteDebuggingPort = 9223;
  let browserStderr = '';
  const browser = spawn(executable, [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-popup-blocking',
    '--disable-features=Translate,OptimizationHints',
    '--disable-extensions-except=' + dist,
    '--load-extension=' + dist,
    `--remote-debugging-port=${remoteDebuggingPort}`,
    '--user-data-dir=' + userDataDir,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  browser.stderr?.setEncoding('utf8');
  browser.stderr?.on('data', (chunk) => { browserStderr += String(chunk); });

  try {
    await waitFor(async () => {
      try {
        return await json(`http://127.0.0.1:${remoteDebuggingPort}/json/version`);
      } catch {
        return null;
      }
    });

    const targets = await waitFor(async () => {
      const list = await json(`http://127.0.0.1:${remoteDebuggingPort}/json/list`);
      const serviceWorker = list.find((entry: any) => entry.type === 'service_worker' && String(entry.url).endsWith('/background.js'));
      return serviceWorker ? { list, serviceWorker } : null;
    });

    const extensionId = new URL(targets.serviceWorker.url).hostname;
    if (!extensionId) throw new Error('Unable to determine extension ID from background service worker');

    const pageTarget = targets.list.find((entry: any) => entry.type === 'page' && entry.url === 'about:blank');
    if (!pageTarget?.webSocketDebuggerUrl) throw new Error('No controllable Chromium page target found');

    const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
    await waitFor(async () => socket.readyState === WebSocket.OPEN ? true : null, 5000);
    const cdp = new CdpClient(socket);
    await cdp.command('Runtime.enable');
    await cdp.command('Page.enable');
    await cdp.command('Page.navigate', { url: `chrome-extension://${extensionId}/popup.html` });

    await waitFor(async () => {
      const result = await cdp.command('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
      return result.result?.value === 'complete' ? true : null;
    });

    const checks = await cdp.command('Runtime.evaluate', {
      expression: `(() => ({
        title: document.title,
        sync: Boolean(document.getElementById('sync')),
        restore: Boolean(document.getElementById('restore')),
        options: Boolean(document.getElementById('options')),
        runtime: Boolean(window.CCSyncRuntime),
        request: typeof window.CCSyncRuntime?.request === 'function',
        i18n: Boolean(window.CCSyncI18n),
        theme: Boolean(window.CCSyncTheme),
      }))()`,
      returnByValue: true,
    });

    const value = checks.result?.value;
    for (const key of ['sync', 'restore', 'options', 'runtime', 'request', 'i18n', 'theme']) {
      if (!value?.[key]) throw new Error(`Popup smoke test failed: ${key} is unavailable`);
    }

    const clickCheck = await cdp.command('Runtime.evaluate', {
      expression: `(() => {
        const button = document.getElementById('sync');
        if (!button) return false;
        let received = false;
        button.addEventListener('click', () => { received = true; }, { once: true });
        button.click();
        return received;
      })()`,
      returnByValue: true,
    });
    if (clickCheck.result?.value !== true) throw new Error('Popup click event smoke test failed');

    socket.close();
    console.log(`Browser smoke test passed for extension ${extensionId}`);
  } catch (error) {
    const detail = browserStderr.trim();
    throw detail ? new Error(`${error instanceof Error ? error.message : String(error)}\nChromium stderr:\n${detail}`) : error;
  } finally {
    browser.kill('SIGTERM');
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
