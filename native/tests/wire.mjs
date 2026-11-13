import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const binary = path.resolve(process.argv[2] || 'native/target/debug/ccsync-native' + (process.platform === 'win32' ? '.exe' : ''));
assert.ok(fs.statSync(binary).isFile(), 'Build the native helper before wire tests');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsync-wire-'));
const origin = 'chrome-extension://' + 'a'.repeat(32) + '/';
fs.writeFileSync(path.join(root, 'allowed-origins.json'), JSON.stringify([origin]));
function frame(value) {
  const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  const header = Buffer.alloc(4); header.writeUInt32LE(bytes.length); return Buffer.concat([header, bytes]);
}
async function exchange(input, caller = origin) {
  const child = spawn(binary, [caller], { env: { ...process.env, CCSYNC_HOME: root }, windowsHide: true });
  const output = []; const errors = [];
  child.stdout.on('data', bytes => output.push(bytes)); child.stderr.on('data', bytes => errors.push(bytes));
  child.stdin.on('error', error => { if (error.code !== 'EPIPE' && error.code !== 'EOF') throw error; });
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(Error('Native fixture timed out')); }, 10_000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, bytes: Buffer.concat(output), error: Buffer.concat(errors).toString() }); });
  });
  // Fragment the length prefix to exercise read_exact after a short header read.
  child.stdin.write(input.subarray(0, 2));
  setTimeout(() => child.stdin.end(input.subarray(2)), 5);
  return result;
}
try {
  const result = await exchange(Buffer.concat([
    frame({ protocol: 1, requestId: 'wire-1', op: 'hello' }),
    frame('{invalid'),
    frame({ protocol: 2, requestId: 'wire-2', op: 'hello' }),
  ]));
  assert.equal(result.code, 0, result.error);
  const responses = []; let offset = 0;
  while (offset < result.bytes.length) {
    const size = result.bytes.readUInt32LE(offset); offset += 4;
    assert.ok(size > 0 && size < 900 * 1024);
    responses.push(JSON.parse(result.bytes.subarray(offset, offset + size).toString())); offset += size;
  }
  assert.equal(responses.length, 3);
  assert.equal(responses[0].requestId, 'wire-1'); assert.equal(responses[0].ok, true);
  assert.equal(responses[1].error.code, 'INVALID_JSON'); assert.equal(responses[2].ok, false);
  const unauthorized = await exchange(frame({ protocol: 1, requestId: 'wire-3', op: 'hello' }), 'chrome-extension://' + 'b'.repeat(32) + '/');
  assert.equal(unauthorized.code, 1); assert.equal(unauthorized.bytes.length, 0);
  assert.match(unauthorized.error, /not authorized/);
  const oversized = Buffer.alloc(4); oversized.writeUInt32LE(768 * 1024 + 1);
  assert.equal((await exchange(oversized)).code, 1);
  console.log('Native wire framing, request correlation, malformed JSON, size and origin checks passed.');
} finally {
  assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
  fs.rmSync(root, { recursive: true });
}
