import assert from "node:assert/strict";
import { BackupService, CloudNotFound, CLOUD_CHUNK, NATIVE_CHUNK, digest, encode64, parseJob, parseRecord, type BackupJob, type CloudPort } from "../src/features/full-backup.ts";
import { createBackupCloud } from "../src/features/full-backup-cloud.ts";

const data = new Uint8Array(CLOUD_CHUNK + 37); data.fill(73);
const job: BackupJob = { id: "1-2-3", kind: "backup", state: "ready", size: data.length, sha256: await digest(data), error: "", createdAt: 1, plan: { profileId: "profile", extensionIds: ["a".repeat(32)], categories: ["local"] } };
const objects = new Map<string, Uint8Array>(); const events: string[] = []; const state = new Map<string, unknown>();
const cloud: CloudPort = { destination: "test", async put(path, value) { events.push(path); objects.set(path, value.slice()); }, async get(path) { const value = objects.get(path); if (!value) throw Error("Missing fixture"); return value; }, async list(prefix) { return prefix === "extension-backups/v1" ? job.plan.extensionIds : [job.id]; } };
const received: Uint8Array[] = [];
const native = { async call(request: Record<string, unknown>): Promise<unknown> {
  if (request.op === "readChunk") { const part = data.subarray(Number(request.index) * NATIVE_CHUNK, (Number(request.index) + 1) * NATIVE_CHUNK); return { data: encode64(part), sha256: await digest(part) }; }
  if (request.op === "commitUpload") { events.push("committed"); return {}; }
  if (request.op === "beginRestore") return { ...job, kind: "restore", state: "receiving" };
  if (request.op === "writeChunk") { received.push(Uint8Array.from(atob(String(request.data)), c => c.charCodeAt(0))); return {}; }
  if (request.op === "planRestore") return { ...job, kind: "restore", state: "preview" };
  throw Error("Unexpected fixture operation");
} };
const backup = new BackupService(native, cloud, { async get(key) { return state.get(key); }, async set(key, value) { state.set(key, value); } });
await backup.upload(job);
const snapshotPath = "extension-backups/v1/" + job.plan.extensionIds[0] + "/1-2-3";
assert.equal(events.at(-1), "committed"); assert.equal(events.at(-2), snapshotPath + "/record.json");
await state.set('fullBackupUpload:' + job.id, { destination: 'test', chunks: (await backup.records())[0]!.chunks });
events.length = 0;
await backup.upload(job);
assert.deepEqual(events, [snapshotPath + '/record.json', 'committed']);
const records = await backup.records(); assert.equal(records.length, 1);
await backup.download(records[0]!, "profile", job.plan.extensionIds, ["local"]);
assert.equal(received.reduce((n, chunk) => n + chunk.length, 0), data.length);
assert.equal(await digest(Buffer.concat(received)), job.sha256);
objects.get(snapshotPath + "/part-1")![0] = 0;
await assert.rejects(() => backup.download(records[0]!, "profile", job.plan.extensionIds, ["local"]), /integrity/);
await state.set('fullBackupUpload:' + job.id, { destination: 'test', chunks: records[0]!.chunks });
events.length = 0;
await backup.upload(job);
assert.deepEqual(events, [snapshotPath + '/part-1', snapshotPath + '/record.json', 'committed']);
const controller = new AbortController();
const paused = new BackupService(native, cloud, { async get(key) { return state.get(key); }, async set(key, value) { state.set(key, value); } }, { signal: controller.signal, async progress(_phase, completed) { if (completed === 0) controller.abort(); } });
events.length = 0;
await assert.rejects(() => paused.upload(job), /abort/i);
assert.equal(events.includes(snapshotPath + '/record.json'), false);
assert.equal(events.includes('committed'), false);
assert.throws(() => parseRecord({ ...records[0], chunks: [] }), /Invalid/);
assert.throws(() => parseRecord({ ...records[0], categories: ["local", "local"] }), /selection/);
assert.throws(() => parseJob({ ...job, state: "unknown" }), /contract/);
assert.throws(() => parseJob({ ...job, plan: { ...job.plan, extensionIds: ["../escape"] } }), /contract/);
for (const status of [401, 405, 500]) {
  const adapter = await createBackupCloud({ settings: async () => ({ extensionBackupBackend: "webdav", extensionBackupWebdavUrl: "https://fixture.invalid" }), token: async () => "", fetch: async () => new Response("failure", { status }) });
  await assert.rejects(() => adapter.get("extension-backups/v1/1-2-3/part-0"), /HTTP/);
}
const huge = await createBackupCloud({ settings: async () => ({ extensionBackupBackend: "webdav", extensionBackupWebdavUrl: "https://fixture.invalid" }), token: async () => "", fetch: async () => new Response(new Uint8Array(CLOUD_CHUNK + 1)) });
await assert.rejects(() => huge.get("extension-backups/v1/1-2-3/part-0"), /limit/);
console.log("Full backup transfer and cloud boundary tests passed.");
// Every provider runs the same read contract; provider discovery stays in fixtures.
for (const backend of ['github', 'webdav', 'gdrive']) {
  let mode: 'ok' | 'missing' | 'huge' = 'ok';
  const adapter = await createBackupCloud({
    settings: async () => ({ extensionBackupBackend: backend, extensionBackupGithubRepo: 'fixture/private', extensionBackupGithubToken: 'fixture', extensionBackupWebdavUrl: 'https://fixture.invalid' }),
    token: async () => 'fixture',
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/repos/fixture/private') return Response.json({ private: true });
      if (url.searchParams.has('q')) {
        const query = url.searchParams.get('q')!;
        const name = /name='([^']+)'/.exec(query)?.[1];
        return Response.json({ files: [{ id: name ?? 'fixture', name, mimeType: name?.startsWith('part-') ? 'application/octet-stream' : 'application/vnd.google-apps.folder' }] });
      }
      if (mode === 'missing') return new Response('missing', { status: 404 });
      if (mode === 'huge') return new Response(new Uint8Array(CLOUD_CHUNK + 1));
      return new Response(new Uint8Array([1, 2, 3]));
    },
  });
  const path = snapshotPath + '/part-0';
  assert.deepEqual(await adapter.get(path), new Uint8Array([1, 2, 3]), backend);
  await assert.rejects(() => adapter.get('../escape'), /Unsafe/, backend);
  mode = 'missing';
  await assert.rejects(() => adapter.get(path), CloudNotFound, backend);
  mode = 'huge';
  await assert.rejects(() => adapter.get(path), /limit/, backend);
}
console.log('Shared GitHub, WebDAV and Drive read contracts passed.');
