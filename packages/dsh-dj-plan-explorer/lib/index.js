export const name = "dj-plan-explorer";
export const inject = ["webServer", "identityAccess", "djWorkflow"];

const DEFAULT_BASE_URL = "http://127.0.0.1:8010";
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function loopbackBase(value) {
  const url = new URL(String(value || DEFAULT_BASE_URL));
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("plan-explorer: baseUrl must be a loopback HTTP URL");
  }
  return url;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-length", Buffer.byteLength(body));
  res.end(body);
}

export function apply(ctx, config = {}) {
  const baseUrl = loopbackBase(config.baseUrl);
  const timeoutMs = Math.max(1000, Math.min(Number(config.timeoutMs) || 10000, 60000));
  ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/api/dj/ui-event',async handler(req,res){
    const principal=ctx.identityAccess.currentPrincipal();
    const expected=config.publicOrigin||`${req.socket?.encrypted?'https':'http'}://${req.headers.host}`;
    if(req.method!=='POST'||!principal||req.headers.origin!==expected)return sendJson(res,403,{ok:false});
    try{
      let raw='';for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>4096)throw new Error('Event too large')}
      const value=JSON.parse(raw);
      if(!ctx.identityAccess.canAccessSession(principal,value.session_id)||!['plugin_ready','plan_received','card_rendered','render_failed','connection_failed','connection_restored'].includes(value.event))return sendJson(res,403,{ok:false});
      ctx.djWorkflow.record(principal.userId,value.session_id,value.event,{plugin_version:'plan-workflow-v2',task_id:String(value.task_id||'').slice(0,100),plan_version:String(value.plan_version||'').slice(0,40),code:String(value.code||'').slice(0,60),request_id:String(value.request_id||'').slice(0,60),client_time:Number(value.client_time)||undefined});
      sendJson(res,200,{ok:true});
    }catch{sendJson(res,400,{ok:false})}
  }}),'dj-plan-explorer: UI telemetry');
  ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/api/dj/session-plans',async handler(req,res){
    if(req.method!=='GET')return sendJson(res,405,{ok:false,error:'method_not_allowed'});
    const user=ctx.identityAccess.currentPrincipal()?.userId;
    const session=new URL(req.url,'http://localhost').searchParams.get('session_id');
    if(!user)return sendJson(res,401,{ok:false,error:'authentication_required'});
    if(!session||!ctx.identityAccess.canAccessSession({userId:user},session))return sendJson(res,403,{ok:false,error:'session_forbidden'});
    try {sendJson(res,200,{ok:true,plans:await ctx.djWorkflow.snapshot(user,session),activity:ctx.djWorkflow.activity?.(user,session)||[],plugin_version:'plan-workflow-v2'});}
    catch(error){sendJson(res,503,{ok:false,error:'workflow_unavailable',message:String(error.message||error),recovery_actions:[{action:'retry_session_plans'}]})}
  }}),'dj-plan-explorer: session recovery');

  for(const route of ['plan-approval','run-retry'])ctx.effect(() => ctx.webServer.register({
    kind: "exact", path: `/api/dj/${route}`,
    async handler(req, res) {
      if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "method_not_allowed" });
      const userId = ctx.identityAccess?.currentPrincipal()?.userId;
      let origin;
      try { origin = new URL(req.headers.origin); } catch { /* Missing Origin is not a trusted UI event. */ }
      const expectedOrigin = config.publicOrigin || `${req.socket?.encrypted ? "https" : "http"}://${req.headers.host}`;
      if (!userId || !origin || origin.origin !== expectedOrigin || req.headers["sec-fetch-site"] === "cross-site") {
        return sendJson(res, 403, { ok: false, error: "untrusted_user_decision" });
      }
      if (!(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) return sendJson(res, 415, { ok: false, error: "json_required" });
      try {
        let raw = "";
        for await (const chunk of req) {
          raw += chunk;
          if (Buffer.byteLength(raw) > 16384) throw new Error("Decision too large");
        }
        const { workspace_root, task_id, plan_version, content_hash, session_id, retry_of } = JSON.parse(raw);
        if(!session_id||!ctx.identityAccess.canAccessSession({userId},session_id))return sendJson(res,403,{ok:false,error:'session_forbidden'});
        const ref=ctx.djWorkflow.list(userId,session_id).find(p=>p.workspace_root===workspace_root&&p.task_id===task_id&&p.plan_version===plan_version&&p.content_hash===content_hash);
        if(!ref)return sendJson(res,403,{ok:false,error:'plan_not_in_session'});
        if(route==='run-retry'&&(typeof retry_of!=='string'||!retry_of))return sendJson(res,400,{ok:false,error:'retry_run_required'});
        const exact={workspace_root,task_id,plan_version,content_hash};
        sendJson(res,200,route==='run-retry'?await ctx.djWorkflow.retry(userId,session_id,exact,retry_of):await ctx.djWorkflow.approve(userId,session_id,exact));
      } catch (error) { sendJson(res, 502, { ok: false, error: "approval_failed", message: String(error) }); }
    },
  }), `dj-plan-explorer: trusted ${route}`);

  for (const route of ["plan-view", "run-steps"]) {
    const path = `/api/dj/${route}`;
    ctx.effect(
      () => ctx.webServer.register({
        kind: "exact",
        path,
        async handler(req, res) {
          if (req.method !== "GET") {
            res.setHeader("allow", "GET");
            sendJson(res, 405, { ok: false, error: "method_not_allowed" });
            return;
          }
          try {
            const incoming = new URL(req.url || path, "http://localhost");
            const upstream = new URL(`/${route}`, baseUrl);
            for (const [key, value] of incoming.searchParams) upstream.searchParams.append(key, value);
            const response = await fetch(upstream, {
              headers: { accept: "application/json", "x-dsh-internal-token": process.env.DSH_DJ_INTERNAL_TOKEN || "",
                "x-dsh-user-id": ctx.identityAccess?.currentPrincipal()?.userId || "" },
              signal: AbortSignal.timeout(timeoutMs),
            });
            const declaredLength = Number(response.headers.get("content-length") || 0);
            if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("response is too large");
            const text = await response.text();
            if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error("response is too large");
            const payload = JSON.parse(text);
            if (!payload || typeof payload.ok !== "boolean") throw new Error("invalid response shape");
            sendJson(res, response.status, payload);
          } catch (error) {
            sendJson(res, 502, {
              ok: false,
              error: "plan_service_unavailable",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        },
      }),
      `dj-plan-explorer: ${route} route`,
    );
  }
}
