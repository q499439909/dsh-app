import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { apply } from '../lib/index.js';

test('only authenticated same-origin UI decisions reach the trusted DJ route', async () => {
  const routes = new Map();
  let user = {userId:'alice'}, calls=0;
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options)=>{
    calls++;
    assert.equal(new URL(url).pathname,'/internal/plan-decision');
    assert.equal(options.headers['x-dsh-user-id'],'alice');
    assert.equal(JSON.parse(options.body).actor,undefined);
    return {status:200,json:async()=>({ok:true,approval:{actor:'alice'}})};
  };
  try {
    apply({effect:fn=>fn(),webServer:{register:r=>routes.set(r.path,r)},identityAccess:{currentPrincipal:()=>user,canAccessSession:(principal,id)=>principal.userId==='alice'&&id==='A'},djWorkflow:{list:()=>[{workspace_root:'D:/mine',task_id:'task_a',plan_version:'plan_v001',content_hash:'sha256:x'}],approve:async(actor,session,ref)=>{calls++;assert.equal(actor,'alice');assert.equal(session,'A');assert.equal(ref.actor,undefined);return {ok:true}}}});
    const invoke=async(origin)=>{
      const req=Readable.from([JSON.stringify({session_id:'A',workspace_root:'D:/mine',task_id:'task_a',plan_version:'plan_v001',content_hash:'sha256:x',decision_id:'id',actor:'bob'})]);
      Object.assign(req,{method:'POST',headers:{'content-type':'application/json',host:'localhost:57035',...(origin?{origin}:{})}});
      const res={setHeader(){},end(body){this.body=JSON.parse(body)}};
      await routes.get('/api/dj/plan-approval').handler(req,res);return res;
    };
    assert.equal((await invoke()).statusCode,403);
    assert.equal((await invoke('https://localhost:57035')).statusCode,403);
    assert.equal((await invoke('http://evil.test')).statusCode,403);
    user=null;assert.equal((await invoke('http://localhost:57035')).statusCode,403);
    user={userId:'alice'};assert.equal((await invoke('http://localhost:57035')).statusCode,200);
    assert.equal(calls,1);
  } finally {globalThis.fetch=originalFetch;}
});

test('session recovery cannot disclose another account or session',async()=>{
  const routes=new Map();let queried=0;
  apply({effect:fn=>fn(),webServer:{register:r=>routes.set(r.path,r)},identityAccess:{currentPrincipal:()=>({userId:'alice'}),canAccessSession:(actor,id)=>actor.userId==='alice'&&id==='own'},
    djWorkflow:{snapshot:async()=>{queried++;return [{task_id:'saved',workflow_state:'awaiting_approval'}]}}});
  const invoke=async id=>{const res={setHeader(){},end(body){this.body=JSON.parse(body)}};await routes.get('/api/dj/session-plans').handler({method:'GET',url:'/api/dj/session-plans?session_id='+id},res);return res};
  assert.equal((await invoke('other')).statusCode,403);assert.equal(queried,0);
  assert.equal((await invoke('own')).body.plans[0].task_id,'saved');assert.equal(queried,1);
});
