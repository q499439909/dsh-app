import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sha = value => 'sha256:' + crypto.createHash('sha256').update(value).digest('hex');
const fileHash = file => fs.existsSync(file) ? sha(fs.readFileSync(file)) : null;

export function treeHash(root, extensions) {
  const entries = [];
  const walk = dir => {
    for (const item of fs.readdirSync(dir, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (['node_modules','.git','__pycache__'].includes(item.name) || item.isSymbolicLink()) continue;
      const target = path.join(dir,item.name);
      if (item.isDirectory()) walk(target);
      else if (extensions.includes(path.extname(item.name))) entries.push([path.relative(root,target).replaceAll('\\','/'),fileHash(target)]);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return sha(JSON.stringify(entries));
}

export function resolveConfig(root, config, overrides={}) {
  if (config.schemaVersion !== 1) throw new Error('Unsupported deployment schemaVersion');
  const value = {...config,...Object.fromEntries(Object.entries(overrides).filter(([,v])=>v!==undefined))};
  for (const key of ['djRoot','pythonExe','workspaceRoot','hfHome']) {
    if (typeof value[key] !== 'string' || !value[key]) throw new Error(`Missing ${key}`);
    value[key] = path.resolve(root,value[key]);
  }
  for (const key of ['webPort','djPort']) if (!Number.isInteger(value[key]) || value[key]<1 || value[key]>65535) throw new Error(`Invalid ${key}`);
  if (value.webPort === value.djPort) throw new Error('Web and DJ must use different ports');
  if (!['native','broker'].includes(value.executionMode)) throw new Error('Invalid executionMode');
  if (value.publicOrigin) {
    const url = new URL(value.publicOrigin);
    if (!['http:','https:'].includes(url.protocol) || url.origin !== value.publicOrigin) throw new Error('publicOrigin must be an exact HTTP(S) origin');
  }
  if (typeof value.observability !== 'boolean') throw new Error('observability must be boolean');
  return value;
}

export function renderPatch(template, config, root) {
  // Only the checked-in template's deployment slots are substituted; no secrets.
  const skillPath = path.join(root,'.dsh','skills').replaceAll('\\','/');
  let patch = template.replace(/http:\/\/127\.0\.0\.1:8010/g,`http://127.0.0.1:${config.djPort}`)
    .replace(/- D:\\dsh-app\\\.dsh\\skills/g,`- ${JSON.stringify(skillPath)}`);
  if (config.publicOrigin) patch = patch.replace(/(id: dj-plan-explorer[\s\S]*?baseUrl:[^\n]*)/,`$1\n        publicOrigin: ${JSON.stringify(config.publicOrigin)}`);
  return patch;
}

export function createManifest(root, config, probe) {
  const dshPackage = JSON.parse(fs.readFileSync(path.join(root,'node_modules/@deepseek-ai/dsh/package.json'),'utf8'));
  const dj = probe || JSON.parse(execFileSync(config.pythonExe,['-X','utf8','-m','data_juicer.tools.plan_flow.deployment'],
    {cwd:config.djRoot,env:{...process.env,PYTHONPATH:config.djRoot},encoding:'utf8',timeout:60000,windowsHide:true,maxBuffer:4*1024*1024}));
  const manifest = {schemaVersion:1, config,
    dsh:{version:dshPackage.version,node:process.version,lockSha256:fileHash(path.join(root,'pnpm-lock.yaml')),
      patchesSha256:treeHash(path.join(root,'patches'),['.patch']),pluginsSha256:treeHash(path.join(root,'packages'),['.js','.json']),
      skillsSha256:treeHash(path.join(root,'.dsh','skills'),['.md','.yaml','.yml','.py','.json'])},
    dj,patchSha256:sha(renderPatch(fs.readFileSync(path.join(root,'dj-dsh.patch.yml'),'utf8'),config,root))};
  return {...manifest, deploymentId:sha(JSON.stringify(manifest)), generatedAt:new Date().toISOString()};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const args = process.argv.slice(2).filter(arg=>arg!=='--write');
  const configPath = args[0] || path.join(root,'dsh-deployment.json');
  const overrides = JSON.parse(process.env.DSH_DEPLOYMENT_OVERRIDES || args[1] || '{}');
  const config = resolveConfig(root,JSON.parse(fs.readFileSync(configPath,'utf8').replace(/^\uFEFF/,'')),overrides);
  const manifest = createManifest(root,config);
  if (process.argv.includes('--write')) {
    const output = path.join(root,'.dsh','deployment'); fs.mkdirSync(output,{recursive:true});
    fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    fs.writeFileSync(path.join(output,'dj.patch.yml'),renderPatch(fs.readFileSync(path.join(root,'dj-dsh.patch.yml'),'utf8'),config,root));
  }
  process.stdout.write(JSON.stringify(manifest));
}
