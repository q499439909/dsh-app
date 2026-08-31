import assert from "node:assert/strict";
import test from "node:test";

let clientModule;
global.window = {
  __ModuleLoader__: {
    load({ factory }) {
      clientModule = factory(id => {
        if (id === "react") return {};
        if (id === "@deepseek-ai/dsh-client-runtime/client") {
          return { isAppendSurfaceEvent: event => event.surfaceOp === "append" };
        }
        throw new Error(`Unexpected test dependency: ${id}`);
      });
    },
  },
};

await import("../lib/client.js");

test("parses the nested MCP tool-result shape persisted by DSH", () => {
  const message = {
    source: { kind: "tool", callId: "call_prepare" },
    content: [
      {
        type: "tool-result",
        toolCallId: "call_prepare",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              ok: true,
              workspace_root: "D:\\shishi",
              task_id: "task_92fd63783d2b",
              plan_version: "plan_v001",
              content_hash: "sha256:40a3",
              view: { groups: [], steps: [] },
            }),
          },
        ],
        isError: false,
      },
    ],
  };

  const payload = clientModule.payloadFrom(message);

  assert.equal(payload?.task_id, "task_92fd63783d2b");
  assert.equal(payload?.plan_version, "plan_v001");
});

test("continues to parse a flat text result", () => {
  const payload = clientModule.payloadFrom({
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ok: true,
          workspace_root: "D:\\shishi",
          task_id: "task_flat",
          plan_version: "plan_v002",
          content_hash: "sha256:flat",
        }),
      },
    ],
  });

  assert.equal(payload?.task_id, "task_flat");
  assert.equal(payload?.plan_version, "plan_v002");
});

test("matches the persisted append marker nested in tool-result data", () => {
  const match = clientModule.projectionDefinition.match({
    type: "tool/result",
    seq: 16989,
    data: {
      turn: 1,
      step: 11,
      message: { source: { kind: "tool", callId: "call_prepare" }, content: [] },
      sourceEventSeqs: [16988],
      surfaceOp: "append",
    },
  });

  assert.deepEqual(match, { id: "1", role: "update" });
});
