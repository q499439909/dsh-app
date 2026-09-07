import test from "node:test";
import assert from "node:assert/strict";
import { trustedHeaders, apply } from "../lib/dj-bridge.js";

test("account headers come only from the execution session owner", () => {
  const identity = { sessionOwner: id => ({ A: "usr_A", B: "usr_B" })[id] };
  const exec = { agent: { session: { id: "A" } }, arguments: { user_id: "usr_B" } };
  assert.equal(trustedHeaders(identity, exec, "test-token")["x-dsh-user-id"], "usr_A");
  assert.throws(() => trustedHeaders(identity, {}, "test-token"));
  assert.throws(() => trustedHeaders(identity, exec, ""));
});

test("bridge replaces model workspace with trusted active-session workspace", async () => {
  const originalFetch = globalThis.fetch;
  const token = process.env.DSH_DJ_INTERNAL_TOKEN;
  process.env.DSH_DJ_INTERNAL_TOKEN = "test-only";
  const definitions = [];
  let sent;
  globalThis.fetch = async (_url, options) => {
    if (!options.method) return { ok: true, json: async () => ({ tools: [
      { name: "prepare_plan", inputSchema: { type: "object" } },
      { name: "get_custom_operator_authoring_spec", inputSchema: { type: "object" } },
    ] }) };
    sent = JSON.parse(options.body);
    return { ok: true, json: async () => ({ ok: true }) };
  };
  try {
    await apply({ effect: fn => fn(), identityAccess: { sessionOwner: () => "usr_A" }, tools: { register: def => definitions.push(def) } });
    assert.deepEqual(definitions.map(def => def.name), [
      "mcp__dj__prepare_plan",
      "mcp__dj__get_custom_operator_authoring_spec",
    ]);
    await definitions[0].execute({ workspace_root: "D:/other", plan: {} }, {
      signal: new AbortController().signal, agent: { session: { id: "A", header: { cwd: "D:/mine" } } },
    });
    assert.equal(sent.arguments.workspace_root, "D:/mine");
  } finally {
    globalThis.fetch = originalFetch;
    if (token === undefined) delete process.env.DSH_DJ_INTERNAL_TOKEN;
    else process.env.DSH_DJ_INTERNAL_TOKEN = token;
  }
});
