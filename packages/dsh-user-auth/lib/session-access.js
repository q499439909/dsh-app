function denied(request) {
  return {
    rpcId: request?.rpcId,
    result: {
      ok: false,
      error: {
        code: "session-forbidden",
        message: "You do not have access to this session.",
        details: {},
      },
    },
  };
}

function responseValue(response) {
  return response?.result?.ok === true ? response.result.value : undefined;
}

function frameSessionId(frame) {
  return frame?.payload?.sessionId ?? frame?.sessionId;
}

async function* filterFrames(iterable, identity, principal, responseSessions = new Map()) {
  for await (const frame of iterable) {
    const sessionId = frameSessionId(frame);
    if (sessionId !== undefined && frame?.rpcId !== undefined) responseSessions.set(frame.rpcId, sessionId);
    if (sessionId === undefined || identity.canAccessSession(principal, sessionId)) yield frame;
  }
}

export function installSessionAccess(apiProxy, identity) {
  const originals = [];
  const responseSessions = new Map();
  const replace = (object, key, next) => {
    const original = object[key];
    originals.push(() => { object[key] = original; });
    object[key] = next(original);
  };
  const principal = () => identity.currentPrincipal();
  const authorize = request => identity.canAccessSession(principal(), request?.payload?.sessionId);

  replace(apiProxy.sessions, "list", original => async function(request, ...rest) {
    const actor = principal();
    if (!actor) return denied(request);
    const response = await original.call(this, request, ...rest);
    const value = responseValue(response);
    if (value?.items) value.items = value.items.filter(item => identity.canAccessSession(actor, item.sessionId));
    return response;
  });
  replace(apiProxy.sessions, "search", original => async function(request, ...rest) {
    const actor = principal();
    if (!actor) return denied(request);
    const response = await original.call(this, request, ...rest);
    const value = responseValue(response);
    if (value?.items) value.items = value.items.filter(item => identity.canAccessSession(actor, item.sessionId));
    return response;
  });
  replace(apiProxy.sessions, "create", original => async function(request, ...rest) {
    const actor = principal();
    if (!actor) return denied(request);
    if (request?.payload?.sessionId !== undefined && !identity.canAccessSession(actor, request.payload.sessionId)) return denied(request);
    const response = await original.call(this, request, ...rest);
    const sessionId = responseValue(response)?.sessionId;
    if (sessionId !== undefined) identity.bindSession(sessionId, actor.userId);
    return response;
  });
  replace(apiProxy.sessions, "fork", original => async function(request, ...rest) {
    const actor = principal();
    if (!identity.canAccessSession(actor, request?.payload?.sessionId)) return denied(request);
    const response = await original.call(this, request, ...rest);
    const sessionId = responseValue(response)?.sessionId;
    if (sessionId !== undefined) identity.bindSession(sessionId, actor.userId);
    return response;
  });
  for (const key of ["history", "models", "selectModel", "rename", "prompt", "attachment", "updateQueue", "cancel"]) {
    replace(apiProxy.sessions, key, original => function(request, ...rest) {
      return authorize(request) ? original.call(this, request, ...rest) : Promise.resolve(denied(request));
    });
  }
  for (const key of ["list", "history", "prompt", "interrupt"]) {
    if (typeof apiProxy.subagents?.[key] !== "function") continue;
    replace(apiProxy.subagents, key, original => function(request, ...rest) {
      const sessionId = request?.payload?.parentSessionId;
      return identity.canAccessSession(principal(), sessionId) ? original.call(this, request, ...rest) : Promise.resolve(denied(request));
    });
  }
  if (typeof apiProxy.downloads?.sessionLog === "function") {
    replace(apiProxy.downloads, "sessionLog", original => function(request, ...rest) {
      return identity.canAccessSession(principal(), request?.sessionId)
        ? original.call(this, request, ...rest)
        : Promise.resolve(new Response("forbidden", { status: 403 }));
    });
  }
  for (const key of ["mux", "host"]) {
    if (typeof apiProxy.events?.[key] !== "function") continue;
    replace(apiProxy.events, key, original => function(request, ...rest) {
      const actor = principal();
      if (!actor) return filterFrames([], identity, actor);
      return filterFrames(original.call(this, request, ...rest), identity, actor, responseSessions);
    });
  }
  if (typeof apiProxy.respond === "function") {
    replace(apiProxy, "respond", original => function(message, ...rest) {
      const sessionId = message?.result?.value?.sessionId ?? responseSessions.get(message?.rpcId);
      if (!identity.canAccessSession(principal(), sessionId)) return Promise.resolve({ accepted: false, reason: "forbidden" });
      return original.call(this, message, ...rest);
    });
  }
  return () => { for (const restore of originals.reverse()) restore(); };
}

export const sessionAccessInternals = { denied, frameSessionId, filterFrames };
