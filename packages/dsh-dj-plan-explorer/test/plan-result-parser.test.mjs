import assert from "node:assert/strict";
import test from "node:test";

let clientModule;
global.CustomEvent = class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } };
global.window = {
  dispatchEvent() {},
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

test("keeps the latest plan scoped to the active conversation", () => {
  const first = { workspace_root: "D:\\one", task_id: "task-one", plan_version: "v1" };
  const second = { workspace_root: "D:\\two", task_id: "task-two", plan_version: "v1" };
  clientModule.planSessionState.registerPlan("session-one", first);
  clientModule.planSessionState.registerPlan("session-two", second);
  clientModule.planSessionState.setActiveSession("session-one");
  assert.equal(clientModule.planSessionState.activePlan(), first);
  clientModule.planSessionState.setActiveSession("session-two");
  assert.equal(clientModule.planSessionState.activePlan(), second);
  clientModule.planSessionState.setActiveSession("session-empty");
  assert.equal(clientModule.planSessionState.activePlan(), null);
});

test("publishes location data under the projection definition's owned kind", () => {
  const location = clientModule.projectionDefinition.buildLocationData({
    state: { turn: 1, plans: [], runs: [] },
  }, "turn");

  assert.equal(location.key, clientModule.projectionDefinition.kind);
});

test("registers a plan opened from the active conversation without the old argument mismatch", () => {
  const plan = { workspace_root: "D:\\active", task_id: "task-active", plan_version: "v1" };
  clientModule.planSessionState.setActiveSession("session-active");

  assert.doesNotThrow(() => clientModule.planSessionState.registerActivePlan(plan));
  assert.equal(clientModule.planSessionState.activePlan(), plan);
});

test("dismisses a plan card only in the conversation where it was closed", () => {
  const plan = { workspace_root: "D:\\shared", task_id: "task-shared", plan_version: "v1" };
  clientModule.planSessionState.dismissPlan("session-one", plan);

  assert.equal(clientModule.planSessionState.isPlanDismissed("session-one", plan), true);
  assert.equal(clientModule.planSessionState.isPlanDismissed("session-two", plan), false);
});
