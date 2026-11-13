/** Backup use cases. Browser, native messaging and cloud providers implement ports. */
export const NATIVE_CHUNK = 256 * 1024;
export const CLOUD_CHUNK = 4 * 1024 * 1024;
export const MAX_ARCHIVE = 32 * 1024 * 1024 * 1024;
export const CATEGORIES = ["program", "local", "sync", "indexeddb", "localStorage", "files"] as const;
export type Category = typeof CATEGORIES[number];
export interface NativePort { call(request: Record<string, unknown>): Promise<unknown> }
export interface CloudPort {
  readonly destination: string;
  put(path: string, data: Uint8Array): Promise<void>;
  get(path: string): Promise<Uint8Array>;
  list(prefix: string): Promise<string[]>;
}
export interface StatePort { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> }
export interface BackupJob { id: string; kind: string; state: string; size: number; sha256: string; error: string; plan: { profileId: string; extensionIds: string[]; categories: string[] }; createdAt: number }
export interface BackupRecord {
  format: "ccsync.extension-cloud.v1"; id: string; size: number; sha256: string; createdAt: number;
  extensionIds: string[]; categories: Category[]; chunks: { size: number; sha256: string }[];
}
export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const snapshotId = (v: unknown): v is string => typeof v === "string" && /^\d+-\d+-\d+$/.test(v);
const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string");
const unique = (v: string[]) => new Set(v).size === v.length;
const validIds = (v: string[]) => v.length <= 128 && unique(v) && v.every(id => /^[a-p]{32}$/.test(id));
const validCategories = (v: string[]) => unique(v) && v.every(c => CATEGORIES.includes(c as Category));
export function parseJob(v: unknown): BackupJob {
  if (!isObject(v) || !snapshotId(v.id) || typeof v.kind !== "string" || typeof v.state !== "string" || typeof v.error !== "string" || typeof v.size !== "number" || !Number.isSafeInteger(v.size) || v.size < 0 || v.size > MAX_ARCHIVE || typeof v.sha256 !== "string" || typeof v.createdAt !== "number" || !isObject(v.plan) || typeof v.plan.profileId !== "string" || !strings(v.plan.extensionIds) || !strings(v.plan.categories)) throw Error("Invalid native task response");
  if (!["backup", "restore", "rollback"].includes(v.kind) || !["waiting", "running", "recovering", "receiving", "preview", "ready", "uploaded", "restored", "rolledBack", "failed", "timedOut", "cancelled"].includes(v.state) || !Number.isSafeInteger(v.createdAt) || v.createdAt < 0 || (v.sha256 !== "" && !hash(v.sha256)) || !validIds(v.plan.extensionIds) || !validCategories(v.plan.categories)) throw Error("Invalid native task contract");
  return v as unknown as BackupJob;
}
export function parseRecord(v: unknown): BackupRecord {
  if (!isObject(v) || v.format !== "ccsync.extension-cloud.v1" || !snapshotId(v.id) || typeof v.size !== "number" || !Number.isSafeInteger(v.size) || v.size <= 0 || v.size > MAX_ARCHIVE || !hash(v.sha256) || typeof v.createdAt !== "number" || !strings(v.extensionIds) || v.extensionIds.length === 0 || v.extensionIds.some(id => !/^[a-p]{32}$/.test(id)) || !strings(v.categories) || v.categories.length === 0 || v.categories.some(c => !CATEGORIES.includes(c as Category)) || !Array.isArray(v.chunks) || v.chunks.length !== Math.ceil(v.size / CLOUD_CHUNK)) throw Error("Invalid cloud backup record");
  if (!Number.isSafeInteger(v.createdAt) || v.createdAt < 0 || !validIds(v.extensionIds) || !validCategories(v.categories)) throw Error("Invalid cloud selection");
  let total = 0;
  for (let i = 0; i < v.chunks.length; i++) {
    const chunk: unknown = v.chunks[i];
    if (!isObject(chunk) || !hash(chunk.sha256) || typeof chunk.size !== "number" || !Number.isInteger(chunk.size) || chunk.size < 1 || chunk.size > CLOUD_CHUNK || (i < v.chunks.length - 1 && chunk.size !== CLOUD_CHUNK)) throw Error("Invalid cloud chunk");
    total += chunk.size;
  }
  if (total !== v.size) throw Error("Cloud size mismatch");
  return v as unknown as BackupRecord;
}
export function encode64(bytes: Uint8Array): string {
  let text = ""; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export function decode64(value: string): Uint8Array { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); }
export async function digest(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>))].map(b => b.toString(16).padStart(2, "0")).join("");
}
const root = 'extension-backups/v1';
const base = (id: string, extensionIds: string[]) => {
  if (!snapshotId(id) || !extensionIds.length || !validIds(extensionIds)) throw Error("Invalid snapshot selection");
  // A multi-extension archive is owned by its first sorted ID; the record lists every ID.
  return root + '/' + [...extensionIds].sort()[0] + '/' + id;
};
export class BackupService {
  constructor(private native: NativePort, private cloud: CloudPort, private state: StatePort,
    private transfer: { signal?: AbortSignal; progress?(phase: string, completed: number, total: number): Promise<void> } = {}) {}
  private async progress(phase: string, completed: number, total: number): Promise<void> {
    this.transfer.signal?.throwIfAborted();
    await this.transfer.progress?.(phase, completed, total);
  }
  async upload(job: BackupJob): Promise<void> {
    if (job.state !== "ready" || !hash(job.sha256) || job.size <= 0) throw Error("Backup is not ready for upload");
    const key = 'fullBackupUpload:' + job.id;
    const saved = await this.state.get(key);
    const chunks: BackupRecord["chunks"] = isObject(saved) && saved.destination === this.cloud.destination && Array.isArray(saved.chunks) ? saved.chunks as BackupRecord["chunks"] : [];
    for (let offset = 0, index = 0; offset < job.size; offset += CLOUD_CHUNK, index++) {
      await this.progress('upload', offset, job.size);
      const bytes = new Uint8Array(Math.min(CLOUD_CHUNK, job.size - offset));
      for (let pos = 0; pos < bytes.length; pos += NATIVE_CHUNK) {
        const response = await this.native.call({ op: "readChunk", jobId: job.id, index: (offset + pos) / NATIVE_CHUNK });
        if (!isObject(response) || typeof response.data !== "string" || !hash(response.sha256)) throw Error("Invalid native chunk");
        const data = decode64(response.data);
        if (data.length !== Math.min(NATIVE_CHUNK, bytes.length - pos) || await digest(data) !== response.sha256) throw Error("Native chunk integrity failure");
        bytes.set(data, pos);
      }
      const meta = { size: bytes.length, sha256: await digest(bytes) };
      const path = base(job.id, job.plan.extensionIds) + '/part-' + index;
      let reusable = false;
      const checkpoint: unknown = chunks[index];
      if (isObject(checkpoint) && checkpoint.sha256 === meta.sha256 && checkpoint.size === meta.size) {
        try {
          const remote = await this.cloud.get(path);
          reusable = remote.length === meta.size && await digest(remote) === meta.sha256;
        } catch (error) { if (!(error instanceof CloudNotFound)) throw error; }
      }
      if (!reusable) await this.cloud.put(path, bytes);
      chunks[index] = meta;
      await this.state.set(key, { destination: this.cloud.destination, chunks });
    }
    const record = parseRecord({ format: "ccsync.extension-cloud.v1", id: job.id, size: job.size, sha256: job.sha256, createdAt: job.createdAt, extensionIds: job.plan.extensionIds, categories: job.plan.categories, chunks });
    // Publish last: an interrupted upload never appears as a restorable snapshot.
    await this.progress('upload', job.size, job.size);
    await this.cloud.put(base(job.id, job.plan.extensionIds) + '/record.json', new TextEncoder().encode(JSON.stringify(record)));
    await this.native.call({ op: "commitUpload", jobId: job.id });
    await this.state.set(key, null);
  }
  async records(): Promise<BackupRecord[]> {
    const out: BackupRecord[] = [];
    for (const extensionId of await this.cloud.list(root)) {
      if (!/^[a-p]{32}$/.test(extensionId)) continue;
      for (const id of await this.cloud.list(root + '/' + extensionId)) {
      if (!snapshotId(id)) continue;
      let bytes: Uint8Array;
      try { bytes = await this.cloud.get(base(id, [extensionId]) + '/record.json'); }
      catch (e) { if (e instanceof CloudNotFound) continue; throw e; }
      if (bytes.length > 2 * 1024 * 1024) throw Error("Cloud record exceeds limit");
      const record = parseRecord(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
      if (record.id !== id || [...record.extensionIds].sort()[0] !== extensionId) throw Error("Cloud snapshot owner or ID mismatch");
      out.push(record);
      }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }
  async download(record: BackupRecord, profileId: string, extensionIds: string[], categories: string[]): Promise<BackupJob> {
    parseRecord(record);
    const key = 'fullBackupDownload:' + record.id;
    const saved = await this.state.get(key);
    let job: BackupJob;
    if (isObject(saved) && saved.destination === this.cloud.destination && snapshotId(saved.jobId)) {
      const all = await this.native.call({ op: "jobs" });
      const existing = Array.isArray(all) ? all.map(parseJob).find(j => j.id === saved.jobId && j.state === "receiving") : undefined;
      job = existing ?? parseJob(await this.native.call({ op: "beginRestore", size: record.size, sha256: record.sha256 }));
    } else job = parseJob(await this.native.call({ op: "beginRestore", size: record.size, sha256: record.sha256 }));
    await this.state.set(key, { destination: this.cloud.destination, jobId: job.id });
    for (let index = 0, offset = 0; index < record.chunks.length; index++) {
      await this.progress('download', offset, record.size);
      const chunk = record.chunks[index]; if (!chunk) throw Error("Missing cloud chunk");
      const bytes = await this.cloud.get(base(record.id, record.extensionIds) + '/part-' + index);
      if (bytes.length !== chunk.size || await digest(bytes) !== chunk.sha256) throw Error('Cloud chunk integrity failure: ' + index);
      for (let pos = 0; pos < bytes.length; pos += NATIVE_CHUNK) await this.native.call({ op: "writeChunk", jobId: job.id, index: (offset + pos) / NATIVE_CHUNK, data: encode64(bytes.subarray(pos, pos + NATIVE_CHUNK)) });
      offset += bytes.length;
    }
    await this.progress('download', record.size, record.size);
    const preview = parseJob(await this.native.call({ op: "planRestore", jobId: job.id, profileId, extensionIds, categories }));
    await this.state.set(key, null); return preview;
  }
}
export class CloudNotFound extends Error {}
