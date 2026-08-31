export const name = "dj-plan-explorer";
export const inject = ["webServer"];

const DEFAULT_BASE_URL = "http://127.0.0.1:8010";
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

function loopbackBase(value) {
  const url = new URL(String(value || DEFAULT_BASE_URL));
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("plan-explorer: baseUrl must be a loopback HTTP URL");
  }
  return url;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-length", Buffer.byteLength(body));
  res.end(body);
}

export function apply(ctx, config = {}) {
  const baseUrl = loopbackBase(config.baseUrl);
  const timeoutMs = Math.max(1000, Math.min(Number(config.timeoutMs) || 10000, 60000));

  for (const route of ["plan-view", "run-steps"]) {
    const path = `/api/dj/${route}`;
    ctx.effect(
      () => ctx.webServer.register({
        kind: "exact",
        path,
        async handler(req, res) {
          if (req.method !== "GET") {
            res.setHeader("allow", "GET");
            sendJson(res, 405, { ok: false, error: "method_not_allowed" });
            return;
          }
          try {
            const incoming = new URL(req.url || path, "http://localhost");
            const upstream = new URL(`/${route}`, baseUrl);
            for (const [key, value] of incoming.searchParams) upstream.searchParams.append(key, value);
            const response = await fetch(upstream, {
              headers: { accept: "application/json" },
              signal: AbortSignal.timeout(timeoutMs),
            });
            const declaredLength = Number(response.headers.get("content-length") || 0);
            if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("response is too large");
            const text = await response.text();
            if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error("response is too large");
            const payload = JSON.parse(text);
            if (!payload || typeof payload.ok !== "boolean") throw new Error("invalid response shape");
            sendJson(res, response.status, payload);
          } catch (error) {
            sendJson(res, 502, {
              ok: false,
              error: "plan_service_unavailable",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        },
      }),
      `dj-plan-explorer: ${route} route`,
    );
  }
}
