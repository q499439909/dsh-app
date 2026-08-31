import assert from "node:assert/strict";
import test from "node:test";
import { RunOutputHttpAdapter } from "../lib/run-output-http.js";

const origin = {
  workspaceRoot: "D:\\workspace",
  taskId: "task_1",
  planVersion: "plan_v001",
  resultRef: "run_r001",
};

test("uses only the loopback internal route and authenticates every request", async () => {
  const calls = [];
  const adapter = new RunOutputHttpAdapter({
    baseUrl: "http://127.0.0.1:8010",
    token: "internal-secret",
    fetch: async (url, init) => {
      calls.push({ url: new URL(url), init });
      return new Response(JSON.stringify({ ok: true, eligible: true, assets: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  await adapter.inspect(origin);
  await adapter.delete(origin, "sha256:manifest");

  assert.equal(calls[0].url.pathname, "/internal/run-output");
  assert.equal(calls[0].url.searchParams.get("workspace_root"), "D:\\workspace");
  assert.equal(calls[0].init.headers["x-dsh-internal-token"], "internal-secret");
  assert.equal(calls[1].init.method, "DELETE");
  assert.equal(calls[1].init.headers["if-match"], "sha256:manifest");
});

test("returns an upstream asset response without buffering it", async () => {
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); } });
  const adapter = new RunOutputHttpAdapter({
    baseUrl: "http://localhost:8010",
    token: "internal-secret",
    fetch: async () => new Response(body, { status: 200, headers: { "content-type": "video/mp4", "content-length": "3" } }),
  });

  const response = await adapter.openAsset(origin, "asset_1", { range: "bytes=0-2", download: false });

  assert.equal(response.headers.get("content-type"), "video/mp4");
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
});

test("requests a cached archive for all or selected opaque asset ids", async () => {
  const calls = [];
  const adapter = new RunOutputHttpAdapter({
    baseUrl: "http://localhost:8010",
    token: "internal-secret",
    fetch: async (url, init) => {
      calls.push({ url: new URL(url), init });
      return new Response(new Uint8Array([80, 75]), { status: 200, headers: { "content-type": "application/zip" } });
    },
  });

  await adapter.openArchive(origin, []);
  await adapter.openArchive(origin, ["asset_1", "asset_2"]);

  assert.equal(calls[0].url.pathname, "/internal/run-archive");
  assert.equal(calls[0].url.searchParams.get("all"), "1");
  assert.deepEqual(calls[1].url.searchParams.getAll("asset_id"), ["asset_1", "asset_2"]);
  assert.equal(calls[1].init.headers["x-dsh-internal-token"], "internal-secret");
});

test("rejects non-loopback upstreams", () => {
  assert.throws(
    () => new RunOutputHttpAdapter({ baseUrl: "https://example.com", token: "secret" }),
    /loopback/,
  );
});
