import assert from "node:assert/strict";
import test from "node:test";
import { installSessionAccess } from "../lib/session-access.js";

const ok = (request, value) => ({ rpcId: request.rpcId, result: { ok: true, value } });

function fixture(role = "user") {
  let current = { userId: "user-a", role };
  const owners = new Map([["owned", "user-a"], ["foreign", "user-b"]]);
  const identity = {
    currentPrincipal: () => current,
    canAccessSession: (principal, sessionId) => principal?.role === "admin" || owners.get(sessionId) === principal?.userId,
    bindSession: (sessionId, userId) => owners.set(sessionId, userId),
  };
  const passthrough = async request => ok(request, { accepted: true });
  const apiProxy = {
    sessions: {
      list: async request => ok(request, { items: [{ sessionId: "owned" }, { sessionId: "foreign" }] }),
      search: async request => ok(request, { items: [{ sessionId: "foreign" }, { sessionId: "owned" }] }),
      create: async request => ok(request, { sessionId: request.payload.sessionId ?? "new-session" }),
      fork: async request => ok(request, { sessionId: "forked" }),
      history: passthrough, models: passthrough, selectModel: passthrough, rename: passthrough,
      prompt: passthrough, attachment: passthrough, updateQueue: passthrough, cancel: passthrough,
    },
    events: {
      async *mux() {
        yield { payload: { type: "session/event", sessionId: "owned" } };
        yield { payload: { type: "session/event", sessionId: "foreign" } };
        yield { payload: { type: "host/connected" } };
      },
      async *host() {},
    },
    subagents: { list: passthrough, history: passthrough, prompt: passthrough, interrupt: passthrough },
    downloads: { sessionLog: async () => new Response("ok") },
    respond: async () => ({ accepted: true }),
  };
  return { apiProxy, owners, dispose: installSessionAccess(apiProxy, identity), setCurrent: value => { current = value; } };
}

test("list, direct access, creation and forks enforce the current owner", async () => {
  const app = fixture();
  try {
    const listed = await app.apiProxy.sessions.list({ rpcId: "1", payload: {} });
    assert.deepEqual(listed.result.value.items.map(item => item.sessionId), ["owned"]);
    const refused = await app.apiProxy.sessions.history({ rpcId: "2", payload: { sessionId: "foreign" } });
    assert.equal(refused.result.error.code, "session-forbidden");
    const created = await app.apiProxy.sessions.create({ rpcId: "3", payload: {} });
    assert.equal(app.owners.get(created.result.value.sessionId), "user-a");
    await app.apiProxy.sessions.fork({ rpcId: "4", payload: { sessionId: "owned" } });
    assert.equal(app.owners.get("forked"), "user-a");
  } finally { app.dispose(); }
});

test("event streams omit frames for sessions owned by other users", async () => {
  const app = fixture();
  try {
    const frames = [];
    for await (const frame of app.apiProxy.events.mux({}, new AbortController().signal)) frames.push(frame);
    assert.deepEqual(frames.map(frame => frame.payload.type), ["session/event", "host/connected"]);
    assert.equal(frames[0].payload.sessionId, "owned");
  } finally { app.dispose(); }
});

test("subagent controls, log downloads, and responses use the parent session boundary", async () => {
  const app = fixture();
  try {
    const refused = await app.apiProxy.subagents.list({ rpcId: "sub", payload: { parentSessionId: "foreign" } });
    assert.equal(refused.result.error.code, "session-forbidden");
    const download = await app.apiProxy.downloads.sessionLog({ sessionId: "foreign" });
    assert.equal(download.status, 403);
    const response = await app.apiProxy.respond({ rpcId: "answer", result: { ok: true, value: { sessionId: "foreign" } } });
    assert.deepEqual(response, { accepted: false, reason: "forbidden" });
  } finally { app.dispose(); }
});
