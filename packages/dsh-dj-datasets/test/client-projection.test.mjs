import assert from "node:assert/strict";
import test from "node:test";

let clientModule;
global.CustomEvent = class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };
global.window = {
  dispatchEvent() {},
  addEventListener() {},
  __ModuleLoader__: {
    load({ factory }) {
      clientModule = factory(id => {
        if (id === "react") return { createElement() {} };
        if (id === "@deepseek-ai/dsh-client-runtime/client") return { isAppendSurfaceEvent: event => event.data?.surfaceOp === "append" };
        throw new Error(`Unexpected dependency: ${id}`);
      });
    },
  },
};

await import("../lib/client.js");

test("parses an opaque result reference from the nested MCP tool result", () => {
  const payload = clientModule.payloadFrom({
    content: [{ type: "tool-result", content: [{ type: "text", text: JSON.stringify({
      ok: true,
      workspace_root: "D:\\workspace",
      task_id: "task_1",
      plan_version: "plan_v001",
      run: { run_id: "run_public", result_ref: "run_r001", status: "succeeded" },
    }) }] }],
  });
  assert.equal(payload.run.result_ref, "run_r001");
});

test("projects run tool results into a conversation-scoped result card", () => {
  const definition = clientModule.resultProjectionDefinition;
  let state = definition.start({}, { event: { data: { turn: 3 } } });
  state = definition.update({ state }, { event: { type: "tool/call", data: { callId: "call_1", name: "mcp_dj_run_plan" } } });
  state = definition.update({ state }, { event: { type: "tool/result", seq: 9, data: {
    message: { source: { callId: "call_1" }, content: [{ type: "text", text: JSON.stringify({
      ok: true,
      workspace_root: "D:\\workspace",
      task_id: "task_1",
      plan_version: "plan_v001",
      run: { result_ref: "run_r001", status: "succeeded" },
    }) }] },
    surfaceOp: "append",
  } } });
  assert.equal(state.runs.length, 1);
  assert.equal(state.runs[0].value.run.result_ref, "run_r001");
});

test("groups variants of one sample while keeping dataset files as attachments", () => {
  const presentation = clientModule.buildResultPresentation([
    { assetId: "mask_1", itemId: "mask_0001", sampleId: "0001", variant: "mask", name: "0001 mask.png", mediaType: "image/png", labels: ["蒙版"], metrics: { score: 0.8 } },
    { assetId: "overlay_1", itemId: "overlay_0001", sampleId: "0001", variant: "overlay", name: "0001 overlay.jpg", mediaType: "image/jpeg", labels: ["叠加预览"], metrics: { score: 0.8 } },
    { assetId: "manifest", itemId: "manifest", name: "manifest.json", mediaType: "application/json", labels: [], metrics: {} },
    { assetId: "embeddings", itemId: "embeddings", name: "embeddings.npz", mediaType: "application/octet-stream", labels: [], metrics: {} },
  ]);

  assert.equal(presentation.samples.length, 1);
  assert.equal(presentation.samples[0].sampleId, "0001");
  assert.deepEqual(presentation.samples[0].variants.map(item => item.variant), ["overlay", "mask"]);
  assert.deepEqual(presentation.attachments.map(item => item.name), ["manifest.json", "embeddings.npz"]);
});

test("offers only discriminating sample labels instead of common or variant labels", () => {
  const samples = [
    { sampleId: "1", labels: ["处理成功", "多人脸", "蒙版", "叠加预览"], variants: [{ variantLabel: "蒙版" }, { variantLabel: "叠加预览" }] },
    { sampleId: "2", labels: ["处理成功", "单人脸", "蒙版", "叠加预览"], variants: [{ variantLabel: "蒙版" }, { variantLabel: "叠加预览" }] },
  ];

  assert.deepEqual(clientModule.sampleLabelOptions(samples), ["多人脸", "单人脸"]);
});

test("paginates filtered samples with stable first, last, and requested pages", () => {
  const samples = Array.from({ length: 30 }, (_, index) => ({
    sampleId: String(index + 1).padStart(4, "0"),
    name: String(index + 1).padStart(4, "0"),
    labels: index % 2 ? ["多人脸"] : ["单人脸"],
    variants: [{ mediaType: "image/jpeg" }],
  }));

  const first = clientModule.filterAndPaginateSamples(samples, { page: 1, pageSize: 20 });
  const last = clientModule.filterAndPaginateSamples(samples, { page: 99, pageSize: 20 });
  const filtered = clientModule.filterAndPaginateSamples(samples, { label: "多人脸", page: 1, pageSize: 20 });
  assert.deepEqual([first.items.length, first.page, first.pageCount], [20, 1, 2]);
  assert.deepEqual([last.items.length, last.page, last.pageCount], [10, 2, 2]);
  assert.deepEqual([filtered.total, filtered.items.length], [15, 15]);
});
