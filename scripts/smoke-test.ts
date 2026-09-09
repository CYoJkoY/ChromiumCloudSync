import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dist = path.join(root, 'dist');
const port = 9223;
const commandTimeout = 10000;

function findChromium(): string {
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

async function getJson(url: string): Promise<any> {
  const response = await fetch(url);
  if (!response.ok) throw new Error('HTTP ' + response.status + ' from ' + url);
  return response.json();
}

async function waitFor<T>(reader: () => Promise<T | null>, timeoutMs: number): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await reader();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Timed out after ' + timeoutMs + 'ms');
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
  async command(method: string, params: Record<string, unknown> = {}): Promise<any> {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('CDP socket is not open: ' + method);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP command timed out: ' + method)); }, commandTimeout);
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

  const executable = findChromium();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-cloud-sync-smoke-'));
  const chromeArgs = [
    '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--disable-background-networking', '--disable-default-apps', '--disable-popup-blocking',
    '--disable-features=Translate,OptimizationHints', '--disable-extensions-except=' + dist,
    '--load-extension=' + dist, '--remote-debugging-port=' + port, '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', 'about:blank'
  ];
  const useXvfb = process.platform === 'linux' && process.env.CI === 'true';
  const command = useXvfb ? 'xvfb-run' : executable;
  const args = useXvfb ? ['-a', '-s', '-screen 0 1280x900x24', '--', executable, ...chromeArgs] : chromeArgs;

  let browserErrors = '';
  let browserSocket: WebSocket | undefined;
  let popupSocket: WebSocket | undefined;
  const browser = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  browser.stderr?.setEncoding('utf8');
  browser.stderr?.on('data', (chunk) => { browserErrors += String(chunk); });

  try {
    const browserInfo = await waitFor(async () => {
      try { return await getJson('http://127.0.0.1:' + port + '/json/version'); } catch { return null; }
    }, 15000);

    const serviceWorker = await waitFor(async () => {
      const list = await getJson('http://127.0.0.1:' + port + '/json/list');
      return list.find((item: any) => item.type === 'service_worker' && String(item.url).endsWith('/background.js')) || null;
    }, 15000);

    const extensionId = new URL(serviceWorker.url).hostname;
    browserSocket = new WebSocket(browserInfo.webSocketDebuggerUrl);
    await waitFor(async () => browserSocket?.readyState === WebSocket.OPEN ? true : null, 5000);
    const browserCdp = new CdpClient(browserSocket);
    const created = await browserCdp.command('Target.createTarget', {
      url: 'chrome-extension://' + extensionId + '/popup.html',
      newWindow: false,
      background: false,
    });
    if (!created.targetId) throw new Error('Chromium did not create extension popup target');

    const popupTarget = await waitFor(async () => {
      const list = await getJson('http://127.0.0.1:' + port + '/json/list');
      return list.find((item: any) => item.id === created.targetId && item.type === 'page' && item.webSocketDebuggerUrl) || null;
    }, 10000);

    popupSocket = new WebSocket(popupTarget.webSocketDebuggerUrl);
    await waitFor(async () => popupSocket?.readyState === WebSocket.OPEN ? true : null, 5000);
    const popup = new CdpClient(popupSocket);
    await popup.command('Runtime.enable');
    await popup.command('Page.enable');

    const initial = await popup.command('Runtime.evaluate', {
      expression: "(()=>({url:location.href,ready:document.readyState,bodyLength:document.body?.innerHTML.length||0,scriptCount:document.scripts.length,scripts:[...document.scripts].map(s=>s.src),sync:!!document.getElementById('sync'),runtime:!!window.CCSyncRuntime,request:typeof window.CCSyncRuntime?.request==='function',i18n:!!window.CCSyncI18n,theme:!!window.CCSyncTheme}))()",
      returnByValue: true,
    });

    await waitFor(async () => {
      const result = await popup.command('Runtime.evaluate', {
        expression: "(()=>({ready:document.readyState,bodyLength:document.body?.innerHTML.length||0,sync:!!document.getElementById('sync'),restore:!!document.getElementById('restore'),options:!!document.getElementById('options'),runtime:!!window.CCSyncRuntime,request:typeof window.CCSyncRuntime?.request==='function',i18n:!!window.CCSyncI18n,theme:!!window.CCSyncTheme}))()",
        returnByValue: true,
      });
      const value = result.result?.value;
      if (value?.sync && value?.restore && value?.options && value?.runtime && value?.request && value?.i18n && value?.theme) return value;
      return null;
    }, 10000);

    const clickResult = await popup.command('Runtime.evaluate', {
      expression: "(()=>{const b=document.getElementById('sync');b.click();return {disabled:b.disabled,busy:b.getAttribute('aria-busy')}})()",
      returnByValue: true,
    });
    const clickState = clickResult.result?.value;
    if (!clickState?.disabled || clickState.busy !== 'true') {
      throw new Error('Popup bindAction handler did not run: ' + JSON.stringify({ initial: initial.result?.value, clickState }));
    }

    console.log('Browser smoke test passed for extension ' + extensionId);
  } catch (error) {
    const detail = browserErrors.trim();
    throw detail ? new Error((error instanceof Error ? error.message : String(error)) + '\nChromium stderr:\n' + detail) : error;
  } finally {
    closeSocket(popupSocket);
    closeSocket(browserSocket);
    browser.kill('SIGKILL');
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    catch (error) { console.warn('Unable to remove Chromium smoke-test profile: ' + (error instanceof Error ? error.message : String(error))); }
  }
}

main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
