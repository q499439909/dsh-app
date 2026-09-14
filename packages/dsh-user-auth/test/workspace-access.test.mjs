import test from 'node:test';
import assert from 'node:assert/strict';
import { installWorkspaceAccess } from '../lib/workspace-access.js';

test('workspace and session creation are checked before host actions',async()=>{
  let calls=0;
  const ok=value=>({result:{ok:true,value}});
  const api={workspace:{list:async()=>ok({items:[{workspaceId:'a',path:'D:/alice',sessionIds:['sa']},{workspaceId:'b',path:'D:/bob',sessionIds:['sb']}],archivedSessionIds:['sb']}),create:async()=>{calls++;return ok({})},rename:async()=>{calls++;return ok({})}},sessions:{create:async()=>{calls++;return ok({})},prompt:async()=>{calls++;return ok({})},list:async()=>ok({items:[]})}};
  const identity={currentPrincipal:()=>({userId:'alice'}),canAccessSession:(_p,id)=>id==='sa'};
  const restore=installWorkspaceAccess(api,identity,async(_actor,path)=>path==='D:/alice');
  try{
    assert.equal((await api.sessions.create({payload:{cwd:'D:/bob'}})).result.ok,false);
    assert.equal((await api.sessions.create({payload:{workspaceId:'b'}})).result.ok,false);
    assert.equal((await api.workspace.create({payload:{path:'D:/bob'}})).result.ok,false);
    assert.equal((await api.workspace.rename({payload:{workspaceId:'b'}})).result.ok,false);
    assert.equal(calls,0);
    assert.equal((await api.sessions.create({payload:{workspaceId:'a'}})).result.ok,true);
    assert.equal((await api.sessions.prompt({payload:{sessionId:'sa'}})).result.ok,true);
    const page=(await api.workspace.list({payload:{}})).result.value;
    assert.deepEqual(page.items.map(x=>x.workspaceId),['a']);assert.deepEqual(page.archivedSessionIds,[]);
  }finally{restore()}
});
