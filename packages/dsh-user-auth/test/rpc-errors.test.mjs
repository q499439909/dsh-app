import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {installWorkspaceAccess} from '../lib/workspace-access.js';
import {installSessionAccess} from '../lib/session-access.js';

const root=resolve('node_modules/.pnpm');
const installed=readdirSync(root).filter(name=>name.startsWith('@deepseek-ai+dsh-host-apipr'));
assert.ok(installed.length,'Test needs the installed host RPC schema');
for(const version of installed) {
  const schemaPath=join(root,version,'node_modules/@deepseek-ai/dsh-host-apiproxy/lib/types/api/rpc.schema.js');
  const {rpcResultSchema}=await import(pathToFileURL(schemaPath));
  const {z}=createRequire(schemaPath)('zod');
  const schema=rpcResultSchema(z.unknown());
  test(`access denials satisfy the real host/client RPC union (${version})`,async()=>{
    const identity={currentPrincipal:()=>({userId:'alice'}),canAccessSession:()=>false};
    const api={workspace:{list:async()=>({result:{ok:true,value:{items:[]}}}),create:async()=>{throw Error('must not reach host')}},sessions:{prompt:async()=>{throw Error('must not reach host')}}};
    const restoreWorkspace=installWorkspaceAccess(api,identity,async()=>false);
    const denied=await api.workspace.create({rpcId:'one',payload:{path:'D:/not-granted'}});
    const parsed=schema.safeParse(denied.result);
    assert.equal(parsed.success,true,JSON.stringify(parsed.error?.issues));
    assert.equal(denied.result.ok,false);
    restoreWorkspace();
    const restoreSession=installSessionAccess(api,identity);
    const session=await api.sessions.prompt({rpcId:'two',payload:{sessionId:'foreign'}});
    assert.equal(schema.safeParse(session.result).success,true);
    restoreSession();
  });
}
