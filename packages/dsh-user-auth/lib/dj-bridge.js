/** DJ definitions come from MCP; execution is forwarded with server-owned account context. */
export const name = "dj-account-tool-bridge";
export const inject = ["tools", "identityAccess"];

export function trustedHeaders(identity, exec, internalToken) {
  const sessionId = exec.agent?.id || exec.agent?.session?.id;
  const userId = (sessionId && identity.sessionOwner(sessionId)) ||
    (exec.agent?.session?.header?.origin === "subagent" && identity.sessionOwner(exec.agent.session.header.parentSession));
  if (!userId || !internalToken) throw new Error("DJ tools require an authenticated session owner and internal token");
  return { "content-type": "application/json", "x-dsh-internal-token": internalToken, "x-dsh-user-id": userId };
}

export async function apply(ctx, config = {}) {
  const endpoint = new URL("/internal/operator-tools", config.url || "http://127.0.0.1:8010");
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) {
    throw new Error("DJ account bridge requires loopback HTTP");
  }
  const internalToken = process.env.DSH_DJ_INTERNAL_TOKEN;
  if (!internalToken) throw new Error("DSH_DJ_INTERNAL_TOKEN is required");
  const response = await fetch(endpoint, { headers: { "x-dsh-internal-token": internalToken }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`DJ tool discovery failed: HTTP ${response.status}`);
  const { tools } = await response.json();
  for (const tool of tools) {
    ctx.effect(() => ctx.tools.register({
      name: `mcp__dj__${tool.name}`,
      description: tool.description || "",
      parameters: tool.inputSchema,
      output: { schema: {}, render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }] },
      async execute(args, exec) {
        const headers = trustedHeaders(ctx.identityAccess, exec, internalToken);
        const arguments_ = { ...args };
        if ("workspace_root" in arguments_) {
          const cwd = exec.agent?.session?.header?.cwd;
          if (!cwd) throw new Error("DJ workspace tools require an active session workspace");
          arguments_.workspace_root = cwd;
        }
        const result = await fetch(endpoint, {
          method: "POST", headers, body: JSON.stringify({ name: tool.name, arguments: arguments_ }),
          signal: AbortSignal.any([exec.signal, AbortSignal.timeout(config.toolCallTimeoutMs || 1800000)]),
        });
        const value = await result.json();
        if (!result.ok || value.ok === false) throw new Error(JSON.stringify(value.error || value));
        return value;
      },
    }), `dj-account-tool:${tool.name}`);
  }
}
