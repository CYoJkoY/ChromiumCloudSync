import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const extensionPath = path.join(root, 'dist');
const manifestPath = path.join(extensionPath, 'manifest.json');
if (!fs.existsSync(manifestPath)) throw new Error('Smoke test requires dist/. Run npm run build:extension first.');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chromium-cloud-sync-smoke-'));
let context;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  const serviceWorker = context.serviceWorkers().find((worker) => worker.url().startsWith('chrome-extension://'))
    ?? await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extensionId = serviceWorker.url().split('/')[2];
  if (!extensionId) throw new Error('Could not resolve the extension ID from the service worker URL.');

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForLoadState('domcontentloaded');
  if (!(await page.locator('.popup-shell').count())) throw new Error('Popup did not render.');

  const response = await page.evaluate(async () => chrome.runtime.sendMessage({ type: 'ping' }));
  if (!response?.ok) throw new Error(`Service worker ping failed: ${JSON.stringify(response)}`);
  if (response.version !== 10) throw new Error(`Unexpected sync schema version from service worker: ${response.version}`);
  if (!response.capabilities || typeof response.capabilities.storage !== 'boolean') throw new Error('Capability detection payload is missing.');

  console.log(`Extension smoke test passed for ${manifest.version_name || manifest.version}.`);
} finally {
  await context?.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
