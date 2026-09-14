import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { PlanWorkflow } from './plan-workflow.js';
import { observeTransport } from './runtime-diagnostics.js';
/** Internal HTTP adapter; the mcp__dj__ tool prefix is retained for conversation compatibility. */
export const name = "dj-http-tool-gateway";
export const inject = ["tools", "identityAccess", "userQuestions"];

export function trustedHeaders(identity, exec, internalToken) {
  const sessionId = exec.agent?.id || exec.agent?.session?.id;
  const userId = (sessionId && identity.sessionOwner(sessionId)) ||
    (exec.agent?.session?.header?.origin === "subagent" && identity.sessionOwner(exec.agent.session.header.parentSession));
  if (!userId || !internalToken) throw new Error("DJ tools require an authenticated session owner and internal token");
  return { "content-type": "application/json", "x-dsh-internal-token": internalToken, "x-dsh-user-id": userId };
}

const REQUIRED_FEATURES = ["trusted-ui-approval", "owned-workspaces", "run-idempotency", "input-profile-v1", "rank-merge-v1"];

export function verifyContract(payload, expectedBuild) {
  if (payload?.protocol?.name !== "dsh-dj-internal-http" || payload.protocol.version !== 1 ||
      !REQUIRED_FEATURES.every(feature => payload.protocol.features?.includes(feature)) || !payload.instance_id) {
    throw new Error("DJ gateway protocol is incompatible; upgrade DSH and DJ together");
  }
  if (expectedBuild && Object.entries(expectedBuild).some(([key, value]) => payload.build?.[key] !== value)) {
    throw new Error("DJ running build differs from the deployment manifest; restart with the expected source/runtime");
  }
  return payload;
}

export async function apply(ctx, config = {}) {
  if (config.transport && config.transport !== "internal-http") throw new Error("dj-bridge uses internal-http, not standard MCP transport");
  if (config.serverName && config.serverName !== "dj") throw new Error("The compatibility tool namespace is dj");
  const base = new URL(config.baseUrl || config.url || process.env.DSH_DJ_BASE_URL || "http://127.0.0.1:8010");
  if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.username || base.password) {
    throw new Error("DJ account bridge requires loopback HTTP without URL credentials");
  }
  if (!["", "/"].includes(base.pathname) || base.search || base.hash) throw new Error("Use a gateway baseUrl without /mcp, query or fragment");
  const endpoint = new URL("/internal/operator-tools", base);
  const internalToken = process.env.DSH_DJ_INTERNAL_TOKEN;
  if (!internalToken) throw new Error("DSH_DJ_INTERNAL_TOKEN is required");
  const expectedBuild = process.env.DSH_DJ_EXPECTED_BUILD ? JSON.parse(process.env.DSH_DJ_EXPECTED_BUILD) : null;
  const discover = async () => {
    const response = await fetch(endpoint, { headers: { "x-dsh-internal-token": internalToken }, signal: AbortSignal.timeout(config.startupTimeoutMs || 10000) });
    if (!response.ok) throw new Error(`DJ tool discovery failed: HTTP ${response.status}`);
    return verifyContract(await response.json(), expectedBuild);
  };
  let contract;
  try { contract = await discover(); }
  catch (error) {
    if (config.failOnStartupError !== false) throw error;
    ctx.logger?.warn?.(`DJ gateway unavailable; no DJ tools registered: ${error.message}`);
    return;
  }
  const tools = contract.tools;
  if (!Array.isArray(tools)) throw new Error("DJ gateway returned no tool definitions");
  const definitions = JSON.stringify(tools);
  const invoke = async (user, name, args, signal, timeout = 30000) => {
    const approval = name === 'approve_plan';
    const call = () => fetch(approval ? new URL('/internal/plan-decision', base) : endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-dsh-internal-token': internalToken,
        'x-dsh-user-id': user, 'x-dsh-dj-protocol': '1', 'x-dsh-dj-instance': contract.instance_id },
      body: JSON.stringify(approval ? args : {name, arguments: args}),
      signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeout)]),
    });
    let response = await call(), value = await response.json();
    if (response.status === 409 && value.error?.code === 'SERVICE_RESTARTED') {
      const refreshed = await discover();
      if (JSON.stringify(refreshed.tools) !== definitions) throw new Error('DJ tool definitions changed; restart DSH to register the new schemas');
      contract = refreshed; response = await call(); value = await response.json();
    }
    if (!response.ok || value.ok === false) throw Object.assign(new Error(JSON.stringify(value.error || value)), {code:value.error?.code});
    return value;
  };
  const workflow = new PlanWorkflow({databasePath:config.workflowDatabasePath === ':memory:' ? ':memory:' : resolve(config.workflowDatabasePath || '.dsh/dj-workflow.sqlite'), invoke});
  ctx.provide('djWorkflow', workflow);
  ctx.effect(()=>{
    const dir=resolve('.dsh/diagnostics/runtime');mkdirSync(dir,{recursive:true});
    const record=(event,extra={})=>{try{appendFileSync(resolve(dir,'dsh-process.jsonl'),JSON.stringify({at:new Date().toISOString(),event,pid:process.pid,...extra})+'\n')}catch{/* Diagnostics must not change process behavior. */}};
    const crash=(error,origin)=>record('uncaught_exception',{origin,name:error?.name,code:error?.code});
    const exit=code=>record('exit',{exit_code:code});record('started');
    const stopTransport=observeTransport(record);
    process.on('uncaughtExceptionMonitor',crash);process.on('exit',exit);
    return ()=>{stopTransport();record('plugin_disposed');process.off('uncaughtExceptionMonitor',crash);process.off('exit',exit)};
  },'dj-workflow: process diagnostics');
  // Observe the standard agent without changing its model configuration or retry policy.
  const planning=new Map();
  ctx.on?.('agent/request',async(payload,next)=>{
    const session=payload.agent.id,user=ctx.identityAccess.sessionOwner(session);
    if(user){const key=session+':'+payload.turn;let stage=planning.get(key);if(!stage){stage={started:Date.now(),requests:0};planning.set(key,stage);if(planning.size>200)planning.delete(planning.keys().next().value)}stage.requests++;
      workflow.record(user,session,'model_request',{turn:payload.turn,step:payload.step,elapsed_ms:Date.now()-stage.started,requests:stage.requests,pid:process.pid});}
    return next();
  });
  ctx.on?.('agent/request-error',async(payload,next)=>{
    const session=payload.agent.id,user=ctx.identityAccess.sessionOwner(session),failure=payload.failure||{};
    if(user)workflow.record(user,session,'model_request_failed',{turn:payload.turn,step:payload.step,provider:payload.provider,pid:process.pid,code:failure.code||'MODEL_REQUEST_FAILED',status:failure.status,request_id:failure.requestId,provider_retry_after_ms:failure.providerRetryAfterMs});
    return next();
  });
  ctx.effect(() => {
    const timer = setInterval(() => workflow.drain().then(()=>workflow.pollActive()).catch(error => ctx.logger?.warn?.(`DJ outbox: ${error.code||'SYNC_FAILED'}`)), 5000);
    timer.unref();
    return async () => { clearInterval(timer); while(workflow.draining||workflow.polling) await new Promise(r => setTimeout(r, 50)); workflow.close(); };
  }, 'dj-workflow: recovery');
  const register = (name, description, parameters, execute) => ctx.effect(() => ctx.tools.register({
    name:`mcp__dj__${name}`, description, parameters,
    output:{schema:{},render:(_args,value)=>[...(name==='confirm_plan'&&value.decision_id?[{type:'text',text:value.run?`审批已保存。${value.run.run_id}：${value.workflow_state}。任务状态将自动更新。`:'审批已保存，服务正在派发任务。'}]:[]),{type:'text',text:JSON.stringify(value)}]},
    execute:async(args,exec)=>JSON.parse(JSON.stringify(await execute(args,exec))),
  }), `dj-account-tool:${name}`);
  register('confirm_plan', 'Show the host structured approval question for an exact saved Plan. A real user approval is persisted and automatically starts one Run; do not call run_plan afterward. Ordinary ask_user_question answers are clarification only. First show the complete plan, gaps and costs.', {
    type:'object', properties:{task_id:{type:'string'},plan_version:{type:'string'},content_hash:{type:'string'},retry_of:{type:'string',description:'Failed or cancelled Run ID. Requests a real user choice before one new attempt.'}},
    required:['task_id','plan_version','content_hash'],additionalProperties:false,
  }, async(args,exec) => {
    const user=trustedHeaders(ctx.identityAccess,exec,internalToken)['x-dsh-user-id'];
    const session=exec.agent?.id || exec.agent?.session?.id, cwd=exec.agent?.session?.header?.cwd;
    if(!cwd)throw new Error('DJ workspace tools require an active session workspace');
    const result=await workflow.confirm(user,session,{workspace_root:cwd,task_id:args.task_id,plan_version:args.plan_version,content_hash:args.content_hash,...(args.retry_of?{retry_of:args.retry_of}:{})},
      request=>ctx.userQuestions.ask({...request,agent:exec.agent,signal:exec.signal}));
    if(result.decision_id&&(result.run||['queued','submitted'].includes(result.workflow_state)))exec.concludeTurn?.();
    return result;
  });
  register('get_workflow_status', 'Recover this session’s saved Plans, pending approvals, durable dispatch and Run status without creating a new Plan or inspecting task files.', {type:'object',properties:{},additionalProperties:false}, async(_args,exec)=>{
    const user=trustedHeaders(ctx.identityAccess,exec,internalToken)['x-dsh-user-id'];
    const session=exec.agent?.id || exec.agent?.session?.id;
    return {ok:true,plans:await workflow.snapshot(user,session),activity:workflow.activity(user,session)};
  });
  for (const tool of tools) {
    if (tool.name === "approve_plan") continue; // Only the authenticated UI decision route can approve.
    ctx.effect(() => ctx.tools.register({
      name: `mcp__dj__${tool.name}`,
      description: tool.description || "",
      parameters: tool.inputSchema,
      output: { schema: {}, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] },
      async execute(args, exec) {
        const headers = trustedHeaders(ctx.identityAccess, exec, internalToken);
        const arguments_ = { ...args };
        if (["prepare_plan", "run_plan", "develop_custom_operator", "validate_custom_operator"].includes(tool.name)) {
          if (!exec.callId) throw new Error("A persistent tool call id is required");
          arguments_.request_id = `${exec.agent?.id || exec.agent?.session?.id}:${exec.callId}`;
          if (["develop_custom_operator", "validate_custom_operator"].includes(tool.name)) arguments_.task_id = String(exec.agent?.id || exec.agent?.session?.id);
        }
        if ("workspace_root" in arguments_) {
          const cwd = exec.agent?.session?.header?.cwd;
          if (!cwd) throw new Error("DJ workspace tools require an active session workspace");
          arguments_.workspace_root = cwd;
        }
        if(tool.name==='run_plan'){
          const prior=(await workflow.snapshot(headers['x-dsh-user-id'],exec.agent?.id || exec.agent?.session?.id))
            .find(p=>p.task_id===arguments_.task_id&&p.plan_version===arguments_.plan_version&&p.decision_id);
          if(prior)return {ok:true,...prior,recovery_actions:[{action:['failed','cancelled'].includes(prior.run?.status)?'confirm_retry':'get_workflow_status',tool:['failed','cancelled'].includes(prior.run?.status)?'mcp__dj__confirm_plan':'mcp__dj__get_workflow_status',retry_of:prior.run?.run_id,message:'Reuse this Run. A failed Run can be retried only after an explicit host user choice, using confirm_plan with retry_of.'}]};
        }
        const user=headers['x-dsh-user-id'],session=exec.agent?.id || exec.agent?.session?.id;
        const fingerprint=createHash('sha256').update(JSON.stringify([tool.name,args])).digest('hex');
        const started=Date.now();
        workflow.record(user,session,'tool_started',{tool:tool.name,call_id:exec.callId,fingerprint});
        let value;
        try{value=await invoke(user,tool.name,arguments_,exec.signal,config.toolCallTimeoutMs || 1800000);}
        catch(error){workflow.record(user,session,'tool_failed',{tool:tool.name,call_id:exec.callId,code:error.code||'TOOL_ERROR',duration_ms:Date.now()-started,fingerprint});throw error}
        workflow.record(user,session,'tool_completed',{tool:tool.name,call_id:exec.callId,duration_ms:Date.now()-started,output_bytes:Buffer.byteLength(JSON.stringify(value)),fingerprint,task_id:value.task_id,plan_version:value.plan_version});
        const repeated=workflow.activity(user,session).filter(e=>e.event==='tool_completed'&&e.summary.fingerprint===fingerprint).length;
        if(repeated>=3)value={...value,progress_hint:'This DJ request has repeated without changed arguments. Reuse the evidence; prepare/confirm an existing Plan or state the exact unresolved gap before further exploration.'};
        const recent=workflow.activity(user,session),request=recent.find(e=>e.event==='model_request');
        if(request?.summary.elapsed_ms>120000 && ['search_capabilities','get_capability_schemas','get_plan_contract'].includes(tool.name))value={...value,progress_hint:'Planning has exceeded 120 seconds. Use the available public contract to prepare a concise draft now, or ask about the specific unresolved requirement. Do not explore implementation without a concrete contract failure.'};
        if(['prepare_plan','get_plan'].includes(tool.name) && value.content_hash)workflow.remember(headers['x-dsh-user-id'],exec.agent?.id || exec.agent?.session?.id,{
          workspace_root:arguments_.workspace_root,task_id:value.task_id,plan_version:value.plan_version,content_hash:value.content_hash,
          title:value.plan?.user_intent,valid:value.valid ?? value.validation?.ok,
          gaps:(value.plan?.coverage||[]).filter(c=>c.status==='gap').map(c=>({id:c.id||c.requirement,requirement:c.requirement})),
          step_count:value.view?.steps?.length,stage_count:value.view?.groups?.length,
          workflow_state:value.validation?.ok===false||value.runtime_assessment?.blocking_issues?.length?'blocked':'awaiting_approval',
          error:[...(value.validation?.errors||[]),...(value.runtime_assessment?.blocking_issues||[])].map(e=>`${e.code}: ${e.message}`).join('\n'),
        });
        return value;
      },
    }), `dj-account-tool:${tool.name}`);
  }
}
