import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const extensionPath = path.join(root, 'dist');
const manifestPath = path.join(extensionPath, 'manifest.json');
const STAGE_TIMEOUT = 15_000;
const MESSAGE_TIMEOUT = 5_000;

if (!fs.existsSync(manifestPath)) throw new Error('Smoke test requires dist/. Run npm run build:extension first.');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

function withTimeout<T>(promise: Promise<T>, timeout: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeout} ms.`)), timeout);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-cloud-sync-smoke-'));
let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | undefined;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  context.setDefaultTimeout(STAGE_TIMEOUT);

  const existingWorker = context.serviceWorkers().find((worker) => worker.url().startsWith('chrome-extension://'));
  const serviceWorker = existingWorker ?? await withTimeout(
    context.waitForEvent('serviceworker'),
    STAGE_TIMEOUT,
    'MV3 service worker startup',
  );
  const workerUrl = serviceWorker.url();
  if (!workerUrl.startsWith('chrome-extension://')) throw new Error(`Unexpected service worker URL: ${workerUrl}`);
  const extensionId = workerUrl.split('/')[2];
  if (!extensionId) throw new Error('Could not resolve the extension ID from the service worker URL.');

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'commit', timeout: STAGE_TIMEOUT });
  await page.locator('.popup-shell').waitFor({ state: 'attached', timeout: STAGE_TIMEOUT });

  const response = await withTimeout(
    page.evaluate(() => new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('runtime.sendMessage timed out.')), MESSAGE_TIMEOUT);
      chrome.runtime.sendMessage({ type: 'ping' }, (result) => {
        clearTimeout(timer);
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(result);
      });
    })),
    MESSAGE_TIMEOUT,
    'Extension runtime message',
  ) as { ok?: boolean; version?: number; capabilities?: { storage?: boolean } } | null;

  if (!response?.ok) throw new Error(`Service worker ping failed: ${JSON.stringify(response)}`);
  if (response.version !== 10) throw new Error(`Unexpected sync schema version from service worker: ${response.version}`);
  if (!response.capabilities || typeof response.capabilities.storage !== 'boolean') throw new Error('Capability detection payload is missing.');

  console.log(`Extension smoke test passed for ${manifest.version_name || manifest.version}.`);
} finally {
  await context?.close().catch(() => undefined);
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
