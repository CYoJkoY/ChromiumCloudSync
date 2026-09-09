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
  async command(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error('CDP socket is not open: ' + method);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP command timed out: ' + method)); }, commandTimeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        const message: Record<string, unknown> = { id, method, params };
        if (sessionId) message.sessionId = sessionId;
        this.socket.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
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
  let extensionsSocket: WebSocket | undefined;
  let popupSocket: WebSocket | undefined;
  const browser = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  browser.stderr?.setEncoding('utf8');
  browser.stderr?.on('data', (chunk) => { browserErrors += String(chunk); });

  try {
    const browserInfo = await waitFor(async () => {
      try { return await getJson('http://127.0.0.1:' + port + '/json/version'); } catch { return null; }
    }, 15000);

    browserSocket = new WebSocket(browserInfo.webSocketDebuggerUrl);
    await waitFor(async () => browserSocket?.readyState === WebSocket.OPEN ? true : null, 5000);
    const browserCdp = new CdpClient(browserSocket);

    const extensionsTarget = await browserCdp.command('Target.createTarget', {
      url: 'chrome://extensions/', newWindow: true, background: false,
    });
    if (!extensionsTarget.targetId) throw new Error('Chromium did not create chrome://extensions/ target');

    const attachedExtensions = await browserCdp.command('Target.attachToTarget', {
      targetId: extensionsTarget.targetId, flatten: true,
    });
    if (!attachedExtensions.sessionId) throw new Error('Chromium did not attach to chrome://extensions/');
    const extensionsSession = attachedExtensions.sessionId;
    await browserCdp.command('Runtime.enable', {}, extensionsSession);

    const extensionInfo = await waitFor(async () => {
      const result = await browserCdp.command('Runtime.evaluate', {
        expression: `(() => {
          const found = [];
          const seen = new Set();
          const visit = (node) => {
            if (!node || seen.has(node)) return;
            seen.add(node);
            if (node.nodeType === Node.ELEMENT_NODE) {
              const id = node.getAttribute('id');
              const extensionId = node.getAttribute('extension-id') || node.getAttribute('extensionid');
              const text = (node.textContent || '').trim();
              if ((extensionId || (id && /^[a-p]{32}$/.test(id))) && /Chromium Cloud Sync/i.test(text)) {
                found.push({ id: extensionId || id, text: text.slice(0, 200) });
              }
            }
            if (node.shadowRoot) visit(node.shadowRoot);
            for (const child of node.children || []) visit(child);
          };
          visit(document.documentElement);
          return { href: location.href, found };
        })()`,
        returnByValue: true,
      }, extensionsSession);
      const value = result.result?.result?.value;
      return value?.found?.length ? value.found[0] : null;
    }, 10000);

    const extensionId = extensionInfo.id;
    if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('Invalid extension ID discovered from chrome://extensions/: ' + extensionId);

    const popupTarget = await browserCdp.command('Target.createTarget', {
      url: 'chrome-extension://' + extensionId + '/popup.html', newWindow: true, background: false,
    });
    if (!popupTarget.targetId) throw new Error('Chromium did not create extension popup target');

    const attachedPopup = await browserCdp.command('Target.attachToTarget', {
      targetId: popupTarget.targetId, flatten: true,
    });
    if (!attachedPopup.sessionId) throw new Error('Chromium did not attach to extension popup');
    const popupSession = attachedPopup.sessionId;
    await browserCdp.command('Runtime.enable', {}, popupSession);

    const readiness = await waitFor(async () => {
      const result = await browserCdp.command('Runtime.evaluate', {
        expression: "(()=>({url:location.href,ready:document.readyState,bodyLength:document.body?.innerHTML.length||0,sync:!!document.getElementById('sync'),restore:!!document.getElementById('restore'),options:!!document.getElementById('options'),runtime:!!window.CCSyncRuntime,request:typeof window.CCSyncRuntime?.request==='function',i18n:!!window.CCSyncI18n,theme:!!window.CCSyncTheme,scripts:[...document.scripts].map(s=>s.src)}))()",
        returnByValue: true,
      }, popupSession);
      const value = result.result?.result?.value;
      const required = ['sync', 'restore', 'options', 'runtime', 'request', 'i18n', 'theme'];
      return required.every((key) => value?.[key]) ? value : null;
    }, 10000);

    const click = await browserCdp.command('Runtime.evaluate', {
      expression: "(()=>{const b=document.getElementById('sync');b.click();return {disabled:b.disabled,busy:b.getAttribute('aria-busy')}})()",
      returnByValue: true,
    }, popupSession);
    const clickState = click.result?.result?.value;
    if (!clickState?.disabled || clickState.busy !== 'true') throw new Error('Popup bindAction handler did not run after clicking Sync: ' + JSON.stringify({ readiness, clickState }));

    console.log('Browser smoke test passed for extension ' + extensionId);
  } catch (error) {
    const detail = browserErrors.trim();
    throw detail ? new Error((error instanceof Error ? error.message : String(error)) + '\nChromium stderr:\n' + detail) : error;
  } finally {
    closeSocket(popupSocket);
    closeSocket(extensionsSocket);
    closeSocket(browserSocket);
    browser.kill('SIGKILL');
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    catch (error) { console.warn('Unable to remove Chromium smoke-test profile: ' + (error instanceof Error ? error.message : String(error))); }
  }
}

main().catch((error) => { console.error(error?.stack || error); process.exitCode = 1; });
