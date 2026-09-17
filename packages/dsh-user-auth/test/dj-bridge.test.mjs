import test from "node:test";
import assert from "node:assert/strict";
import { inject, trustedHeaders, apply as applyBridge, runReportPrompt, verifyContract, wakeRunReport } from "../lib/dj-bridge.js";


const cleanups=[];
const apply=(ctx,config={})=>applyBridge({userQuestions:{ask:async()=>({answers:[]})},provide(_key,value){cleanups.push(()=>value.close())},...ctx}, {...config,workflowDatabasePath:':memory:'});
test.afterEach(()=>{for(const cleanup of cleanups.splice(0))cleanup()});
const contract = {protocol:{name:'dsh-dj-internal-http',version:1,features:['trusted-ui-approval','owned-workspaces','run-idempotency','input-profile-v1','rank-merge-v1']},instance_id:'test-instance',build:{source_sha256:'fixture'}};

test("account headers come only from the execution session owner", () => {
  const identity = { sessionOwner: id => ({ A: "usr_A", B: "usr_B" })[id] };
  const exec = { agent: { session: { id: "A" } }, arguments: { user_id: "usr_B" } };
  assert.equal(trustedHeaders(identity, exec, "test-token")["x-dsh-user-id"], "usr_A");
  assert.throws(() => trustedHeaders(identity, {}, "test-token"));
  assert.throws(() => trustedHeaders(identity, exec, ""));
});

test("bridge replaces model workspace with trusted active-session workspace", async () => {
  const originalFetch = globalThis.fetch;
  const token = process.env.DSH_DJ_INTERNAL_TOKEN;
  process.env.DSH_DJ_INTERNAL_TOKEN = "test-only";
  const definitions = [];
  let sent;
  globalThis.fetch = async (_url, options) => {
    if (!options.method) return { ok: true, json: async () => ({ ...contract, tools: [
      { name: "prepare_plan", inputSchema: { type: "object" } },
      { name: "get_custom_operator_authoring_spec", inputSchema: { type: "object" } },
      { name: "approve_plan", inputSchema: { type: "object" } },
    ] }) };
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => ({ ok: true }) };
  };
  try {
    await apply({ effect: fn => fn(), identityAccess: { sessionOwner: () => "usr_A" }, tools: { register: def => definitions.push(def) } });
    assert.deepEqual(definitions.map(def => def.name), [
      "mcp__dj__confirm_plan",
      "mcp__dj__get_workflow_status",
      "mcp__dj__prepare_plan",
      "mcp__dj__get_custom_operator_authoring_spec",
    ]);
    await definitions.find(d=>d.name==="mcp__dj__prepare_plan").execute({ workspace_root: "D:/other", plan: {} }, {
      callId:'prepare-one', signal: new AbortController().signal, agent: { session: { id: "A", header: { cwd: "D:/mine" } } },
    });
    assert.equal(sent.arguments.workspace_root, "D:/mine");
  } finally {
    globalThis.fetch = originalFetch;
    if (token === undefined) delete process.env.DSH_DJ_INTERNAL_TOKEN;
    else process.env.DSH_DJ_INTERNAL_TOKEN = token;
  }
});

test('run request identity is derived from the host call, not model arguments', async()=>{
  const originalFetch=globalThis.fetch, old=process.env.DSH_DJ_INTERNAL_TOKEN;
  process.env.DSH_DJ_INTERNAL_TOKEN='test';let definition,sent;
  globalThis.fetch=async(_url,options)=>{if(!options.method)return {ok:true,json:async()=>({...contract,tools:[{name:'run_plan',inputSchema:{type:'object'}}]})};sent=JSON.parse(options.body);return {ok:true,json:async()=>({ok:true})}};
  try{
    await apply({effect:fn=>fn(),identityAccess:{sessionOwner:()=> 'alice'},tools:{register:def=>{definition=def}}});
    const exec={callId:'call-1',signal:new AbortController().signal,agent:{session:{id:'session-a',header:{cwd:'D:/alice'}}}};
    await definition.execute({workspace_root:'D:/bob',request_id:'forged'},exec);
    assert.equal(sent.arguments.request_id,'session-a:call-1');
    await definition.execute({workspace_root:'D:/bob'},exec);assert.equal(sent.arguments.request_id,'session-a:call-1');
  }finally{globalThis.fetch=originalFetch;if(old===undefined)delete process.env.DSH_DJ_INTERNAL_TOKEN;else process.env.DSH_DJ_INTERNAL_TOKEN=old}
});


test('gateway rejects incompatible protocols, builds and misleading transport config', async()=>{
  assert.throws(()=>verifyContract({...contract,protocol:{...contract.protocol,version:2}}),/incompatible/);
  assert.throws(()=>verifyContract({...contract,protocol:{...contract.protocol,features:[]}}),/incompatible/);
  assert.throws(()=>verifyContract(contract,{source_sha256:'other'}),/differs/);
  assert.equal(verifyContract(contract,{source_sha256:'fixture'}),contract);
  await assert.rejects(apply({}, {transport:'streamable-http'}), /internal-http/);
});

test('a restarted compatible server is renegotiated before replaying the same request',async()=>{
  const originalFetch=globalThis.fetch, old=process.env.DSH_DJ_INTERNAL_TOKEN;
  process.env.DSH_DJ_INTERNAL_TOKEN='test';let definition,discoveries=0,calls=0;const ids=[];
  globalThis.fetch=async(_url,options)=>{
    if(!options.method){discoveries++;return {ok:true,json:async()=>({...contract,instance_id:String(discoveries),tools:[{name:'run_plan',inputSchema:{type:'object'}}]})};}
    calls++;ids.push(JSON.parse(options.body).arguments.request_id);
    if(calls===1)return {ok:false,status:409,json:async()=>({ok:false,error:{code:'SERVICE_RESTARTED'}})};
    assert.equal(options.headers['x-dsh-dj-instance'],'2');
    return {ok:true,json:async()=>({ok:true})};
  };
  try {
    await apply({effect:fn=>fn(),identityAccess:{sessionOwner:()=> 'alice'},tools:{register:def=>{definition=def}}});
    await definition.execute({workspace_root:'ignored'}, {callId:'one',signal:new AbortController().signal,agent:{session:{id:'a',header:{cwd:'D:/alice'}}}});
    assert.deepEqual(ids,['a:one','a:one']);assert.equal(discoveries,2);
  } finally {globalThis.fetch=originalFetch;if(old===undefined)delete process.env.DSH_DJ_INTERNAL_TOKEN;else process.env.DSH_DJ_INTERNAL_TOKEN=old;}
});

test('terminal reports wake the owning Agent as a plugin follow-up',()=>{
  assert.ok(inject.includes('agents'),'Cordis must authorize access to the Agent registry');
  let message;
  const ctx={identityAccess:{sessionOwner:id=>id==='session_a'?'alice':undefined},agents:{get:id=>id==='session_a'?{followup:value=>{message=value}}:undefined}};
  const report={event:'dj_run_completed',task_id:'task_a',run:{run_id:'run_1',status:'succeeded',progress:{processed:10,total:10}}};
  wakeRunReport(ctx,'alice','session_a',report);
  assert.equal(message.role,'user');
  assert.equal(message.source.kind,'plugin');
  assert.match(message.content[0].text,/directly to the user/);
  assert.match(runReportPrompt(report),/"status":"succeeded"/);
  assert.throws(()=>wakeRunReport(ctx,'bob','session_a',report),/owner changed/);
});

test('structured confirmation forwards the live caller and automatically dispatches, ordinary text cannot approve',async()=>{
  const originalFetch=globalThis.fetch,old=process.env.DSH_DJ_INTERNAL_TOKEN;
  process.env.DSH_DJ_INTERNAL_TOKEN='test';
  const definitions=[],calls=[];
  const ref={workspace_root:'D:/alice',task_id:'task_a',plan_version:'plan_v001',content_hash:'sha256:abc'};
  const agent={id:'session_a',session:{header:{cwd:ref.workspace_root}}};
  globalThis.fetch=async(url,options)=>{
    if(!options.method)return {ok:true,json:async()=>({...contract,tools:[]})};
    const payload=JSON.parse(options.body);calls.push({path:new URL(url).pathname,payload,actor:options.headers['x-dsh-user-id']});
    const value=payload.name==='get_plan'?{ok:true,...ref,valid:true,plan:{user_intent:'test'}}:
      payload.name==='run_plan'?{ok:true,run:{run_id:'run_1',plan_version:ref.plan_version,status:'starting'}}:{ok:true};
    return {ok:true,json:async()=>value};
  };
  try{
    await apply({effect:fn=>fn(),identityAccess:{sessionOwner:()=> 'alice'},tools:{register:d=>definitions.push(d)},
      userQuestions:{ask:async request=>{assert.equal(request.agent,agent);assert.match(request.questions[0].detail,/sha256:abc/);return {answers:[{id:request.questions[0].id,selected:['批准并运行']}]}}}});
    let concluded=false;
    const result=await definitions.find(d=>d.name==='mcp__dj__confirm_plan').execute({...ref,actor:'bob'},{agent,signal:new AbortController().signal,concludeTurn(){concluded=true}});
    assert.equal(result.run.run_id,'run_1');
    assert.deepEqual(result,JSON.parse(JSON.stringify(result)),'Host tool output must be lossless JSON, with no undefined fields');
    assert.equal(concluded,true,'Approved dispatch must not depend on another model request');
    assert.equal(calls.filter(c=>c.path==='/internal/plan-decision').length,1);
    assert.equal(calls.filter(c=>c.payload.name==='run_plan').length,1);
    assert.ok(calls.every(c=>c.actor==='alice'));
  }finally{globalThis.fetch=originalFetch;if(old===undefined)delete process.env.DSH_DJ_INTERNAL_TOKEN;else process.env.DSH_DJ_INTERNAL_TOKEN=old}
});
