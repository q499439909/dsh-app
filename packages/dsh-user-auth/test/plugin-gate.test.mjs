import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { apply, IdentityAccess } from "../lib/index.js";

const fastParameters = { memory: 8192, passes: 1, parallelism: 1, tagLength: 32 };

class MockResponse {
  headers = {};
  statusCode = 200;
  body = "";

  setHeader(name, value) {
    this.headers[name.toLowerCase()] = value;
  }

  writeHead(status, headers = {}) {
    this.statusCode = status;
    for (const [name, value] of Object.entries(headers)) this.setHeader(name, value);
  }

  end(body = "") {
    this.body += String(body);
  }
}

function request(method, path, body, cookie) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = path;
  req.headers = {
    host: "localhost:57035",
    ...(body === undefined ? {} : { "content-type": "application/json" }),
    ...(cookie ? { cookie } : {}),
  };
  return req;
}

function fixture() {
  const routes = new Map();
  const guards = [];
  const disposers = [];
  const listeners = new Map();
  const ctx = {
    apiProxy: {
      sessions: Object.fromEntries(["list", "search", "create", "history", "models", "selectModel", "rename", "fork", "prompt", "attachment", "updateQueue", "cancel"].map(key => [key, async request => ({ rpcId: request.rpcId, result: { ok: true, value: key === "list" || key === "search" ? { items: [] } : {} } })])),
      events: { async *mux() {}, async *host() {} },
      subagents: Object.fromEntries(["list", "history", "prompt", "interrupt"].map(key => [key, async request => ({ rpcId: request.rpcId, result: { ok: true, value: {} } })])),
      downloads: { sessionLog: async () => new Response("ok") },
      respond: async () => ({ accepted: true }),
    },
    webServer: {
      register(route) {
        routes.set(route.path, route);
        return () => routes.delete(route.path);
      },
      registerRequestGuard(guard) {
        guards.push(guard);
        return () => guards.splice(guards.indexOf(guard), 1);
      },
    },
    provide(name, value) {
      ctx[name] = value;
    },
    effect(factory) {
      const dispose = factory();
      if (typeof dispose === "function") disposers.push(dispose);
    },
    on(name, listener) {
      listeners.set(name, listener);
    },
  };
  const root = mkdtempSync(join(tmpdir(), "dsh-user-auth-plugin-"));
  apply(ctx, {
    enabled: true,
    databasePath: join(root, "auth.sqlite"),
    inviteHash: IdentityAccess.hashInviteCode("test-invite", fastParameters),
    passwordParameters: fastParameters,
    secureCookie: false,
  });
  return {
    ctx,
    routes,
    guards,
    listeners,
    async dispose() {
      for (const dispose of disposers.reverse()) await dispose();
    },
  };
}

async function invoke(route, req) {
  const res = new MockResponse();
  await route.handler(req, res);
  return res;
}

test("registration issues a server cookie that opens the global API guard", async () => {
  const app = fixture();
  try {
    const register = await invoke(
      app.routes.get("/auth/register"),
      request("POST", "/auth/register", {
        username: "gate-user",
        password: "a sufficiently long password",
        inviteCode: "test-invite",
      }),
    );
    assert.equal(register.statusCode, 201);
    const cookie = register.headers["set-cookie"].split(";", 1)[0];
    assert.equal(await app.guards[0](request("POST", "/api/host.describe"), "http"), false);
    assert.equal(await app.guards[0](request("POST", "/api/host.describe", undefined, cookie), "http"), true);
    assert.equal(await app.guards[0](request("GET", "/", undefined), "http"), true);
    assert.equal(await app.guards[0](request("GET", "/api/events.mux", undefined), "upgrade"), false);

    const session = await invoke(
      app.routes.get("/auth/session"),
      request("GET", "/auth/session", undefined, cookie),
    );
    assert.equal(JSON.parse(session.body).authenticated, true);
  } finally {
    await app.dispose();
  }
});

test("auth UI is injected while secrets stay out of the boot payload", async () => {
  const app = fixture();
  try {
    const table = [];
    app.listeners.get("webserver/index-inject")(table);
    assert.deepEqual(table.map(row => row.kind), ["style", "script"]);
    assert.equal(JSON.stringify(table).includes("test-invite"), false);
  } finally {
    await app.dispose();
  }
});
