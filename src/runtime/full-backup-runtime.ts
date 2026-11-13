import { BackupService, isObject, parseJob, parseRecord, type NativePort } from "../features/full-backup.js";
import { createBackupCloud } from "../features/full-backup-cloud.js";

export const NATIVE_HOST = "org.chromiumcloudsync.backup";
let activePort: chrome.runtime.Port | undefined;
const pending = new Map<string, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
async function nativeSession<T>(run: () => Promise<T>): Promise<T> {
  const port = chrome.runtime.connectNative(NATIVE_HOST);
  activePort = port;
  port.onMessage.addListener((response: unknown) => {
    if (!isObject(response) || typeof response.requestId !== "string") return;
    const request = pending.get(response.requestId); if (!request) return;
    pending.delete(response.requestId); clearTimeout(request.timer); request.resolve(response);
  });
  port.onDisconnect.addListener(() => {
    const message = chrome.runtime.lastError?.message ?? "Native helper disconnected";
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(Error(message)); }
    pending.clear(); if (activePort === port) activePort = undefined;
  });
  try { return await run(); } finally { activePort = undefined; port.disconnect(); }
}
const native: NativePort = {
  async call(request) {
    const requestId = crypto.randomUUID();
    const port = activePort; if (!port) throw Error("Native helper is not connected");
    const response: unknown = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(Error("Native request timed out; inspect task state before retrying")); }, 120_000);
      pending.set(requestId, { resolve, reject, timer });
      try { port.postMessage({ ...request, protocol: 1, requestId }); } catch (error) { clearTimeout(timer); pending.delete(requestId); reject(error); }
    });
    if (!isObject(response) || response.protocol !== 1 || response.requestId !== requestId) throw Error("Native helper protocol mismatch. Rebuild and register the helper; see native/README.md.");
    if (response.ok !== true) throw Error(isObject(response.error) && typeof response.error.message === "string" ? response.error.message : "Native helper operation failed");
    return response.value;
  },
};
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run, run); queue = next.catch(() => undefined); return next;
}
async function service(token: () => Promise<string>): Promise<BackupService> {
  const settings = await chrome.storage.local.get(null);
  if (settings.extensionBackupBackend === "webdav") {
    const url = new URL(String(settings.extensionBackupWebdavUrl));
    if (!await chrome.permissions.contains({ origins: [url.origin + "/*"] })) throw Error("Grant access to the WebDAV server using the storage backend settings first.");
  }
  return new BackupService(native, await createBackupCloud({ settings: async () => settings, token, fetch }), {
    async get(key) { return (await chrome.storage.local.get(key))[key] as unknown; },
    async set(key, value) { if (value === null) await chrome.storage.local.remove(key); else await chrome.storage.local.set({ [key]: value }); },
  }, {
    signal: transferController?.signal,
    async progress(phase, completed, total) { await chrome.storage.local.set({ fullBackupProgress: { phase, completed, total } }); },
  });
}
let transferController: AbortController | undefined;
const operations = new Set(["hello", "profiles", "registerProfile", "plan", "scheduleBackup", "jobs", "scheduleRestore", "retry", "rollback", "cancel"]);
export function handleFullBackup(message: Record<string, unknown>, token: () => Promise<string>): Promise<unknown> {
  if (message.action === "cancelTransfer") {
    transferController?.abort(Error("Transfer paused. Retry to resume verified chunks."));
    return Promise.resolve({ ok: true });
  }
  if (message.action === "records") return service(token).then(backup => backup.records());
  return serial(async () => {
    transferController = new AbortController();
    try { return await nativeSession(async () => {
    if (message.action === "native") {
      if (!isObject(message.request) || typeof message.request.op !== "string" || !operations.has(message.request.op)) throw Error("Unsupported backup operation");
      return native.call(message.request);
    }
    const backup = await service(token);
    if (message.action === "download") {
      if (typeof message.profileId !== "string" || !Array.isArray(message.extensionIds) || !message.extensionIds.every(x => typeof x === "string") || !Array.isArray(message.categories) || !message.categories.every(x => typeof x === "string")) throw Error("Invalid restore selection");
      return backup.download(parseRecord(message.record), message.profileId, message.extensionIds, message.categories);
    }
    if (message.action === "upload") {
      const jobs: unknown = await native.call({ op: "jobs" });
      if (!Array.isArray(jobs)) throw Error("Invalid native jobs");
      for (const value of jobs) { const job = parseJob(value); if (job.state === "ready") await backup.upload(job); }
      return { ok: true };
    }
    throw Error("Unknown backup action");
    }); } finally { transferController = undefined; await chrome.storage.local.remove("fullBackupProgress"); }
  });
}
export function startFullBackup(token: () => Promise<string>): void {
  const upload = async () => {
    if ((await chrome.storage.local.get("fullBackupEnabled")).fullBackupEnabled !== true) return;
    try {
      await handleFullBackup({ action: "upload" }, token);
      await chrome.storage.local.remove("fullBackupLastError");
    } catch (error) { await chrome.storage.local.set({ fullBackupLastError: error instanceof Error ? error.message : String(error) }); }
  };
  chrome.runtime.onStartup.addListener(() => { void upload(); });
  chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === "extension-full-backup") void upload(); });
  void chrome.alarms.create("extension-full-backup", { periodInMinutes: 5 });
}
