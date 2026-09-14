import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlanWorkflow } from '../lib/plan-workflow.js';

const ref={workspace_root:'D:/mine',task_id:'task_a',plan_version:'plan_v001',content_hash:'sha256:abc'};
function fixture(t, options={}) {
  const dir=mkdtempSync(join(tmpdir(),'dj-workflow-'));const calls=[];
  const invoke=async(user,name,args)=>{
    calls.push({user,name,args});
    if(name==='get_plan')return {ok:true,...ref,valid:true,validation:{ok:true},plan:{user_intent:'Filter images'},runtime_assessment:{blocking_issues:[]}};
    if(name==='run_plan')return {ok:true,run:{run_id:'run_1',plan_version:ref.plan_version,status:'starting'}};
    if(name==='get_run')return {ok:true,run:{run_id:args.run_id,status:'starting'}};
    return {ok:true};
  };
  const file=join(dir,'workflow.sqlite');
  const workflow=new PlanWorkflow({databasePath:file,invoke,...options});
  t.after(()=>{workflow.close();rmSync(dir,{recursive:true,force:true})});
  return {workflow,calls,file,invoke};
}
test('a real question answer queues an exact plan and dispatches once',async t=>{
  const {workflow,calls}=fixture(t);
  const ask=async request=>({answers:[{id:request.questions[0].id,selected:['批准并运行']}]});
  const result=await workflow.confirm('alice','session_a',ref,ask);
  await workflow.drain();
  assert.equal(result.ok,true);
  assert.equal(calls.filter(c=>c.name==='approve_plan').length,1);
  assert.equal(calls.filter(c=>c.name==='run_plan').length,1);
  assert.equal(workflow.list('alice','session_a')[0].run.run_id,'run_1');
  assert.deepEqual(workflow.list('bob','session_a'),[]);
});
test('terminal failure is persisted, shown accurately and not polled again',async t=>{
  const {workflow,invoke}=fixture(t);let reads=0;
  workflow.invoke=async(user,name,args)=>name==='get_run'?(reads++,{ok:true,run:{run_id:args.run_id,status:'failed',error:'cache incomplete',error_code:'MODEL_FILE_MISSING'}}):invoke(user,name,args);
  await workflow.approve('alice','s',ref);
  const first=(await workflow.snapshot('alice','s'))[0];await workflow.snapshot('alice','s');
  assert.equal(first.workflow_state,'failed');assert.equal(first.error,'cache incomplete');assert.equal(reads,1);
  const again=await workflow.confirm('alice','s',ref,()=>assert.fail('repeat approval'));
  assert.equal(again.run.status,'failed');
});
test('an explicit retry creates one new attempt; repeated requests replay it',async t=>{
  const {workflow,invoke}=fixture(t);const ids=[];
  workflow.invoke=async(user,name,args)=>{
    if(name==='get_run')return {ok:true,run:{run_id:args.run_id,status:'failed',cleanup_pending:false}};
    if(name==='run_plan'){ids.push(args.request_id);return {ok:true,run:{run_id:'run_'+ids.length,status:'starting'}}}
    return invoke(user,name,args);
  };
  await workflow.approve('alice','s',ref);
  const replies=await Promise.all([workflow.retry('alice','s',ref,'run_1'),workflow.retry('alice','s',ref,'run_1')]);
  await workflow.drain();
  assert.equal(ids.length,2);assert.notEqual(ids[0],ids[1]);
  const replay=await workflow.retry('alice','s',ref,'run_1');assert.equal(replay.run.run_id,'run_2');
  assert.equal(ids.length,2);assert.equal(workflow.list('alice','s')[0].run.run_id,'run_2');
});
test('gap acceptance is explicit and reaches the trusted approval',async t=>{
  const {workflow,invoke,calls}=fixture(t);
  workflow.invoke=async(user,name,args)=>name==='get_plan'?{ok:true,...ref,valid:true,plan:{coverage:[{id:'clarity',requirement:'清晰度',status:'gap'}]}}:invoke(user,name,args);
  await workflow.confirm('alice','s',ref,async r=>{
    assert.equal(r.questions[0].options[0].label,'接受缺口并运行');
    return {answers:[{id:r.questions[0].id,selected:['接受缺口并运行']}]};
  });
  assert.deepEqual(calls.find(c=>c.name==='approve_plan').args.accepted_gaps,['clarity']);
});
test('custom text and decline never count as approval',async t=>{
  const {workflow,calls}=fixture(t);
  await workflow.confirm('alice','session_a',ref,async r=>({answers:[{id:r.questions[0].id,selected:[],custom:'yes approve'}]}));
  await workflow.drain();
  assert.equal(calls.filter(c=>c.name==='approve_plan'||c.name==='run_plan').length,0);
});
test('a newer plan invalidates an outstanding question',async t=>{
  let newer=false;
  const {workflow}=fixture(t,{invoke:async(_user,name)=>{
    assert.equal(name,'get_plan');return {ok:true,...ref,plan_version:newer?'plan_v002':ref.plan_version,validation:{ok:true},plan:{}};
  }});
  await assert.rejects(workflow.confirm('alice','session_a',ref,async r=>{newer=true;return {answers:[{id:r.questions[0].id,selected:['批准并运行']}]}}),/PLAN_SUPERSEDED/);
});
test('lost run response survives reopening with the same request id',async t=>{
  const ids=[];let fail=true;
  const {workflow,file,invoke}=fixture(t);
  workflow.invoke=async(user,name,args)=>{
    if(name==='run_plan'){ids.push(args.request_id);if(fail)throw new Error('connection lost')}
    return invoke(user,name,args);
  };
  await workflow.approve('alice','session_a',ref);
  assert.equal(ids.length,1);
  workflow.close();fail=false;
  const reopened=new PlanWorkflow({databasePath:file,invoke:workflow.invoke});
  try {
    await reopened.drain({force:true});
    assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);
    assert.equal(reopened.list('alice','session_a')[0].run.run_id,'run_1');
  } finally { reopened.close(); }
});

test('blocked dispatch recovery asks once and reuses its request identity',async t=>{
 const {workflow,invoke}=fixture(t);let blocked=true;const requests=[];
 workflow.invoke=async(u,n,a)=>{if(n==='run_plan'){requests.push(a.request_id);if(blocked)throw new Error('RUNTIME_PREFLIGHT_FAILED')}return invoke(u,n,a)};
 await workflow.approve('alice','s',ref);assert.equal(workflow.list('alice','s')[0].workflow_state,'blocked');blocked=false;
 await workflow.confirm('alice','s',ref,async r=>({answers:[{id:r.questions[0].id,selected:[r.questions[0].options[0].label]}]}));
 assert.equal(requests.length,2);assert.equal(requests[0],requests[1]);
});

test('legacy approval with unaccepted gaps requires explicit acceptance on retry',async t=>{
 const {workflow,invoke}=fixture(t);await workflow.approve('alice','s',ref);
 workflow.invoke=async(u,n,a)=>n==='get_plan'?{ok:true,...ref,valid:true,plan:{coverage:[{id:'clarity',requirement:'clear face',status:'gap'}]}}:n==='get_run'?{ok:true,run:{run_id:a.run_id,status:'failed'}}:invoke(u,n,a);
 await assert.rejects(workflow.retry('alice','s',ref,'run_1'),/GAP_ACCEPTANCE_REQUIRED/);
 await workflow.confirm('alice','s',{...ref,retry_of:'run_1'},async r=>{
 assert.equal(r.questions[0].options[0].label,'接受缺口并重试');return {answers:[{id:r.questions[0].id,selected:['接受缺口并重试']}]};
 });
 assert.deepEqual(JSON.parse(workflow.decision('alice','s',ref).ref).accepted_gaps,['clarity']);
});

test('terminal status with pending cleanup keeps refreshing until retry is safe',async t=>{
 const {workflow,invoke}=fixture(t);let pending=true,reads=0;
 workflow.invoke=async(u,n,a)=>n==='get_run'?(reads++,{ok:true,run:{run_id:a.run_id,status:'cancelled',cleanup_pending:pending}}):invoke(u,n,a);
 await workflow.approve('alice','s',ref);let item=(await workflow.snapshot('alice','s'))[0];assert.equal(item.run.cleanup_pending,true);
 pending=false;item=await workflow.refresh('alice','s',item,{force:true});assert.equal(item.run.cleanup_pending,false);
 await workflow.refresh('alice','s',item,{force:true});assert.equal(reads,2);
});
