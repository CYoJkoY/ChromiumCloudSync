import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from '../registration.mjs';
for (const platform of ['win32', 'darwin', 'linux']) test(platform + ' registration and removal stay inside fixtures', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsync-registration-'));
  try {
    const binary = path.join(root, 'native-binary'); fs.writeFileSync(binary, 'fixture');
    const commands = []; let registeredPath = '';
    const execute = (command, args) => {
      assert.equal(command, 'reg.exe'); commands.push(args);
      if (args[0] === 'add') registeredPath = args[args.indexOf('/d') + 1];
      if (args[0] === 'query') { if (!registeredPath) { const error = Error('Not found'); error.status = 1; throw error; } return 'REG_SZ    ' + registeredPath; }
      return '';
    };
    const settings = { platform, env: { LOCALAPPDATA: root, XDG_STATE_HOME: path.join(root, 'state'), XDG_CONFIG_HOME: path.join(root, 'config') }, userHome: root, execute, binaryArgument: binary };
    const a = 'a'.repeat(32), b = 'b'.repeat(32);
    const result = register({ ...settings, extensionId: a });
    register({ ...settings, extensionId: a });
    register({ ...settings, extensionId: b });
    for (const file of result.manifests) {
      assert.ok(path.resolve(file).startsWith(path.resolve(root) + path.sep));
      const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.equal(manifest.allowed_origins.length, 2); assert.equal(manifest.path, fs.realpathSync(binary));
    }
    register({ ...settings, extensionId: a, remove: true });
    assert.equal(JSON.parse(fs.readFileSync(result.manifests[0], 'utf8')).allowed_origins.length, 1);
    register({ ...settings, extensionId: b, remove: true });
    for (const file of result.manifests) assert.equal(fs.existsSync(file), false);
    assert.equal(fs.readFileSync(binary, 'utf8'), 'fixture');
    if (platform === 'win32') assert.ok(commands.some(args => args[0] === 'delete'));
    else assert.equal(commands.length, 0);
    assert.equal(register({ ...settings, extensionId: b, remove: true }).changed, false);
  } finally {
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep));
    fs.rmSync(root, { recursive: true });
  }
});
