import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { apply, datasetPluginInternals } from "../lib/index.js";

class MockResponse {
  headers = {};
  statusCode = 200;
  body = "";
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  writeHead(status, headers = {}) { this.statusCode = status; for (const [name, value] of Object.entries(headers)) this.setHeader(name, value); }
  write(chunk) { this.body += Buffer.from(chunk).toString("utf8"); return true; }
  end(body = "") { this.body += String(body); }
}

function request(method, path, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = path;
  req.headers = { host: "localhost:57035", origin: "http://localhost:57035", ...(body === undefined ? {} : { "content-type": "application/json" }) };
  return req;
}

function fixture() {
  const routes = new Map();
  const disposers = [];
  let principal = { userId: "usr_a", username: "A", role: "user", sessionId: "auth_a" };
  const identityAccess = {
    currentPrincipal: () => principal,
    sessionOwner: sessionId => sessionId === "session-a" ? "usr_a" : "usr_b",
    canAccessSession: (actor, sessionId) => actor.role === "admin" || (sessionId === "session-a" ? actor.userId === "usr_a" : actor.userId === "usr_b"),
  };
  const toolPayload = {
    ok: true,
    workspace_root: "D:\\private-workspace",
    task_id: "task_result",
    plan_version: "plan_v001",
    run: { run_id: "run_public", result_ref: "run_r001", status: "succeeded" },
  };
  const apiProxy = {
    sessions: {
      async list(request) { return { rpcId: request.rpcId, result: { ok: true, value: { items: [{ sessionId: "session-a" }] } } }; },
      async history(request) {
        return { rpcId: request.rpcId, result: { ok: true, value: { events: [{ message: { content: [{ type: "text", text: JSON.stringify(toolPayload) }] } }] } } };
      },
    },
  };
  const runOutputPort = {
    async inspect(origin) {
      return {
        eligible: true,
        taskId: origin.taskId,
        planVersion: origin.planVersion,
        internalRunId: origin.resultRef,
        title: "测试结果",
        status: "available",
        manifestHash: "sha256:manifest",
        fileCount: 1,
        totalBytes: 3,
        labels: { 保留: 1 },
        mediaTypes: { image: 1 },
        assets: [{ assetId: "asset_1", itemId: "item_1", name: "a.png", mediaType: "image/png", size: 3, labels: ["保留"], metrics: {} }],
      };
    },
    async delete() { return { deleted: true }; },
    async openAsset() { return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png", "content-length": "3" } }); },
  };
  const ctx = {
    identityAccess,
    apiProxy,
    webServer: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } },
    provide(name, value) { ctx[name] = value; },
    effect(factory) { const dispose = factory(); if (typeof dispose === "function") disposers.push(dispose); },
    on() {},
  };
  const root = mkdtempSync(join(tmpdir(), "dsh-datasets-plugin-"));
  apply(ctx, { databasePath: join(root, "datasets.sqlite"), runOutputPort });
  return {
    ctx,
    routes,
    setPrincipal(next) { principal = next; },
    async dispose() { for (const dispose of disposers.reverse()) await dispose(); },
  };
}

async function invoke(route, req) {
  const res = new MockResponse();
  await route.handler(req, res);
  return res;
}

test("discovers run origins from nested persisted tool results", () => {
  const origins = datasetPluginInternals.discoverRunOrigins({
    content: [{ type: "tool-result", content: [{ type: "text", text: JSON.stringify({
      ok: true,
      workspace_root: "D:\\workspace",
      task_id: "task_1",
      plan_version: "plan_v001",
      run: { result_ref: "run_r001" },
    }) }] }],
  });
  assert.deepEqual(origins, [{ workspaceRoot: "D:\\workspace", taskId: "task_1", planVersion: "plan_v001", resultRef: "run_r001" }]);
});

test("reconciles only accessible conversations and keeps paths out of public responses", async () => {
  const app = fixture();
  try {
    const reconcile = await invoke(app.routes.get("/api/dj/datasets/reconcile"), request("POST", "/api/dj/datasets/reconcile", {}));
    assert.equal(reconcile.statusCode, 200);
    assert.equal(JSON.parse(reconcile.body).registered, 1);

    const list = await invoke(app.routes.get("/api/dj/datasets"), request("GET", "/api/dj/datasets"));
    const payload = JSON.parse(list.body);
    assert.equal(payload.items.length, 1);
    assert.equal(JSON.stringify(payload).includes("private-workspace"), false);

    app.setPrincipal({ userId: "usr_b", username: "B", role: "user", sessionId: "auth_b" });
    const other = await invoke(app.routes.get("/api/dj/datasets"), request("GET", "/api/dj/datasets"));
    assert.deepEqual(JSON.parse(other.body).items, []);
  } finally {
    await app.dispose();
  }
});
