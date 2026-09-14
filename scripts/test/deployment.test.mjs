import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { resolveConfig, renderPatch, treeHash } from '../deployment-manifest.mjs';

const config = {schemaVersion:1,djRoot:'../dj',pythonExe:'../env/python.exe',workspaceRoot:'./business data',hfHome:'./cache',webPort:57035,djPort:8010,executionMode:'native',observability:false};

test('custom ports, source and workspace flow into one resolved deployment',()=>{
  const root = path.resolve('C:/deployment test');
  const resolved=resolveConfig(root,config,{djPort:8123});
  assert.equal(resolved.djPort,8123);
  assert.equal(resolved.workspaceRoot,path.resolve(root,'business data'));
  const template=fs.readFileSync(new URL('../../dj-dsh.patch.yml',import.meta.url),'utf8');
  const patch=renderPatch(template,resolved,root);
  assert.ok(!patch.includes(':8010'));
  assert.ok(!patch.includes('D:\\dsh-app'));
  assert.ok(patch.includes('transport: internal-http'));
  assert.ok(!patch.includes('/mcp'));
  assert.equal((patch.match(/127\.0\.0\.1:8123/g)||[]).length,4);
});

test('invalid deployment settings fail before launching processes',()=>{
  assert.throws(()=>resolveConfig('.',config,{djPort:57035}),/different ports/);
  assert.throws(()=>resolveConfig('.',config,{djPort:'8010'}),/Invalid djPort/);
  assert.throws(()=>resolveConfig('.',config,{publicOrigin:'https://app.test/path'}),/exact/);
  assert.throws(()=>resolveConfig('.',config,{executionMode:'unknown'}),/executionMode/);
});

test('skill or patch content edits change fingerprints without requiring a git commit',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dsh-deployment-test-'));
  try {
    const file=path.join(root,'SKILL.md');fs.writeFileSync(file,'before');
    const before=treeHash(root,['.md']);fs.writeFileSync(file,'after');
    assert.notEqual(treeHash(root,['.md']),before);
  } finally {
    const resolved=path.resolve(root);
    assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('dsh-deployment-test-'));
    fs.rmSync(resolved,{recursive:true});
  }
});
