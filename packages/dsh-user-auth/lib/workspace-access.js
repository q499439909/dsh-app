import { accessDenied } from './rpc-errors.js';
/** Application workspace grants. OS-level isolation remains a deployment boundary. */
export function installWorkspaceAccess(api, identity, authorizePath) {
  const restores = [];
  const value = response => response?.result?.ok ? response.result.value : null;
  const deny = request => accessDenied(request, 'workspace-forbidden', '该工作区尚未授权给当前账号，请先登记工作区归属。');
  const wrap = (object, key, fn) => {
    if (typeof object?.[key] !== "function") return;
    const original = object[key];
    object[key] = fn(original);
    restores.push(() => { object[key] = original; });
  };
  const rawList = api.workspace?.list?.bind(api.workspace);
  const rows = async () => value(await rawList?.({rpcId:"workspace-access",payload:{}}))?.items || [];
  const allowed = async path => {
    const actor = identity.currentPrincipal();
    if (!actor || !path) return false;
    try { return await authorizePath(actor, path); } catch { return false; }
  };
  const sessionAllowed = async id => {
    if (!identity.canAccessSession(identity.currentPrincipal(), id)) return false;
    const workspace = (await rows()).find(row => row.sessionIds?.includes(id));
    if (workspace) return allowed(workspace.path);
    let cursor;
    do {
      const page = value(await api.sessions.list({rpcId:"session-workspace-access",payload:{limit:200,...(cursor ? {cursor} : {})}}));
      const session = page?.items?.find(item => item.sessionId === id);
      if (session) return allowed(session.cwd);
      cursor = page?.nextCursor;
    } while (cursor);
    return false;
  };
  wrap(api.sessions, "create", original => async function(request, ...rest) {
    const payload = request?.payload || {};
    const path = payload.workspaceId ? (await rows()).find(row => row.workspaceId === payload.workspaceId)?.path : payload.cwd || process.cwd();
    return await allowed(path) ? original.call(this, request, ...rest) : deny(request);
  });
  for (const key of ["prompt", "fork", "attachment"]) wrap(api.sessions,key,original=>async function(request,...rest){
    return await sessionAllowed(request?.payload?.sessionId) ? original.call(this,request,...rest) : deny(request);
  });
  wrap(api.subagents, "prompt", original => async function(request, ...rest) {
    return await sessionAllowed(request?.payload?.parentSessionId) ? original.call(this, request, ...rest) : deny(request);
  });
  wrap(api.workspace,"list",original=>async function(request,...rest){
    const response=await original.call(this,request,...rest), data=value(response);
    if(data?.items){const filtered=[];for(const row of data.items)if(await allowed(row.path))filtered.push({...row,sessionIds:row.sessionIds.filter(id=>identity.canAccessSession(identity.currentPrincipal(),id))});data.items=filtered;data.archivedSessionIds=(data.archivedSessionIds||[]).filter(id=>identity.canAccessSession(identity.currentPrincipal(),id));}
    return response;
  });
  for(const key of ["create","rename","delete","insertBefore","insertSessionBefore","archiveSession"])wrap(api.workspace,key,original=>async function(request,...rest){
    const payload=request?.payload||{};
    if(payload.sessionId&&!await sessionAllowed(payload.sessionId))return deny(request);
    const all=await rows();
    for(const id of [payload.workspaceId,payload.beforeWorkspaceId])if(id&&!await allowed(all.find(row=>row.workspaceId===id)?.path))return deny(request);
    if(key==="create"&&!await allowed(payload.path))return deny(request);
    if(payload.beforeSessionId&&!await sessionAllowed(payload.beforeSessionId))return deny(request);
    return original.call(this,request,...rest);
  });
  return () => { for (const restore of restores.reverse()) restore(); };
}
