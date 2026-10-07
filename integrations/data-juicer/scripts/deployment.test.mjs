import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveConfig, renderPatch, treeHash } from './deployment-manifest.mjs';

const config = {
  schemaVersion: 1,
  djRoot: '../dj',
  pythonExe: '../env/python.exe',
  workspaceRoot: './workspace',
  hfHome: './cache',
  webPort: 57535,
  djPort: 8010,
  executionMode: 'native',
  observability: false,
};

test('source integration paths and custom MCP port render deterministically', () => {
  const root = path.resolve('C:/deployment test');
  const resolved = resolveConfig(root, config, { djPort: 8123 });
  assert.equal(resolved.djPort, 8123);
  assert.equal(resolved.workspaceRoot, path.resolve(root, 'workspace'));
  const template = fs.readFileSync(new URL('../dj-dsh.patch.yml', import.meta.url), 'utf8');
  const patch = renderPatch(template, resolved, root);
  assert.ok(!patch.includes('__DJ_'));
  assert.ok(patch.includes('url: http://127.0.0.1:8123/mcp'));
  assert.ok(patch.includes('skills'));
});

test('invalid deployment settings fail before launching processes', () => {
  assert.throws(() => resolveConfig('.', config, { djPort: 57535 }), /different ports/);
  assert.throws(() => resolveConfig('.', config, { djPort: '8010' }), /Invalid djPort/);
  assert.throws(() => resolveConfig('.', config, { publicOrigin: 'https://app.test/path' }), /exact/);
  assert.throws(() => resolveConfig('.', config, { executionMode: 'unknown' }), /executionMode/);
});

test('content edits change fingerprints without requiring a git commit', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-dj-source-test-'));
  try {
    const file = path.join(root, 'SKILL.md');
    fs.writeFileSync(file, 'before');
    const before = treeHash(root, ['.md']);
    fs.writeFileSync(file, 'after');
    assert.notEqual(treeHash(root, ['.md']), before);
  } finally {
    fs.rmSync(root, { recursive: true });
  }
});
