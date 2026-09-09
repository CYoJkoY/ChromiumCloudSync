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
      try { execFileSync(candidate, ['--version'], { stdio: 'ignore' }); return candidate; } catch {}
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
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`CDP socket is not open: ${method}`));
    const id = ++this.nextId;
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP command timed out: ${method}`)); }, CDP_COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params })); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error instanceof Error ? error : new Error(String(error))); }
    });
  }
}

function closeSocket(socket: WebSocket | undefined) {
  if (!socket) return;
  try { if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(); } catch {}
}

async function main() {
  if (!fs.existsSync(path.join(dist, 'manifest.json'))) throw new Error('dist/manifest.json is missing; run npm run build:extension first');
  const executable = chromiumExecutable();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-cloud-sync-smoke-'));
  const remoteDebuggingPort = 9223;
  const chromeArgs = [
    '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-background-networking', '--disable-default-apps', '--disable-popup-blocking',
    '--disable-features=Translate,OptimizationHints', '--disable-extensions-except=' + dist,
    '--load-extension=' + dist, `--remote-debugging-port=${remoteDebuggingPort}`, '--user-data-dir=' + userDataDir,
    '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', 'about:blank'
  ];
  const useXvfb = process.platform === 'linux' && process.env.CI === 'true';
  const launchCommand = useXvfb ? 'xvfb-run' : executable;
  const launchArgs = useXvfb ? ['-a', '-s', '-screen 0 1280x900x24', '--', executable, ...chromeArgs] : chromeArgs;

  let browserStderr = '';
  let browserSocket: WebSocket | undefined;
  let workerSocket: WebSocket | undefined;
  let popupSocket: WebSocket | undefined;
  const browser = spawn(launchCommand, launchArgs, { stdio: ['ignore', 'ignore', 'pipe'] });
  browser.stderr?.setEncoding('utf8');
  browser.stderr?.on('data', (chunk) => { browserStderr += String(chunk); });

  try {
    const browserInfo = await waitFor(async () => { try { return await json(`http://127.0.0.1:${remoteDebuggingPort}/json/version`); } catch { return null; } });
    const targets = await waitFor(async () => {
      const list = await json(`http://127.0.0.1:${remoteDebuggingPort}/json/list`);
      const serviceWorker = list.find((entry: any) => entry.type === 'service_worker' && String(entry.url).endsWith('/background.js'));
      return serviceWorker ? { list, serviceWorker } : null;
    });
    const extensionId = new URL(targets.serviceWorker.url).hostname;

    workerSocket = new WebSocket(targets.serviceWorker.webSocketDebuggerUrl);
    await waitFor(async () => workerSocket?.readyState === WebSocket.OPEN ? true : null, 5000);
    const workerCdp = new CdpClient(workerSocket);
    await workerCdp.command('Runtime.enable');
    const openPopup = await workerCdp.command('Runtime.evaluate', {
      expression: `(() => { if (typeof chrome.action?.openPopup !== 'function') throw new Error('chrome.action.openPopup is unavailable'); chrome.action.openPopup(); return true; })()`,
      returnByValue: true,
    });
    if (openPopup.exceptionDetails) throw new Error(openPopup.exceptionDetails.text || 'chrome.action.openPopup failed');

    const popupTarget = await waitFor(async () => {
      const list = await json(`http://127.0.0.1:${remoteDebuggingPort}/json/list`);
      return list.find((entry: any) => entry.type === 'page' && String(entry.url).startsWith(`chrome-extension://${extensionId}/popup.html`) && entry.webSocketDebuggerUrl) || null;
    }, 10000);
    popupSocket = new WebSocket(popupTarget.webSocketDebuggerUrl);
    await waitFor(async () => popupSocket?.readyState === WebSocket.OPEN ? true : null, 5000);
    const cdp = new CdpClient(popupSocket);
    await cdp.command('Runtime.enable');
    await cdp.command('Page.enable');

    const readiness = await waitFor(async () => {
      const result = await cdp.command('Runtime.evaluate', {
        expression: `(() => ({
          ready: document.readyState,
          href: location.href,
          sync: Boolean(document.getElementById('sync')),
          restore: Boolean(document.getElementById('restore')),
          options: Boolean(document.getElementById('options')),
          runtime: Boolean(window.CCSyncRuntime),
          request: typeof window.CCSyncRuntime?.request === 'function',
          i18n: Boolean(window.CCSyncI18n),
          theme: Boolean(window.CCSyncTheme),
          scripts: [...document.scripts].map(s => s.src)
        }))()`,
        returnByValue: true,
      });
      const value = result.result?.value;
      return value?.sync ? value : null;
    }, 10000);

    const missing = ['sync', 'restore', 'options', 'runtime', 'request', 'i18n', 'theme'].filter((key) => !readiness?.[key]);
    if (missing.length) throw new Error(`Popup runtime incomplete: ${JSON.stringify({ missing, readiness })}`);

    await cdp.command('Runtime.evaluate', { expression: `document.getElementById('sync').click()`, returnByValue: true });
    const handlerCheck = await waitFor(async () => {
      const result = await cdp.command('Runtime.evaluate', {
        expression: `(() => { const b=document.getElementById('sync'); return Boolean(b?.disabled && b?.getAttribute('aria-busy')==='true'); })()`,
        returnByValue: true,
      });
      return result.result?.value === true ? true : null;
    }, 3000);
    if (!handlerCheck) throw new Error('Popup bindAction handler did not run after click');

    console.log(`Browser smoke test passed for extension ${extensionId}`);
  } catch (error) {
    const detail = browserStderr.trim();
    throw detail ? new Error(`${error instanceof Error ? error.message : String(error)}\nChromium stderr:\n${detail}`) : error;
  } finally {
    closeSocket(popupSocket); closeSocket(workerSocket); closeSocket(browserSocket); browser.kill('SIGKILL');
    try { fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100); }
    catch (error) { console.warn(`Unable to remove Chromium smoke-test profile: ${error instanceof Error ? error.message : String(error)}`); }
  }
}

main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
