export const name = "dj-operator-library";
export const inject = ["webServer"];

const DEFAULT_CATALOG_URL = "http://127.0.0.1:8010/operator-catalog";
const CATALOG_ROUTE_PATH = "/api/dj/operator-catalog";
const DETAIL_ROUTE_PATH = "/api/dj/operator-detail";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function resolveLoopbackUrl(value, label) {
  const url = new URL(String(value || DEFAULT_CATALOG_URL));
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error(`operator-library: ${label} must be a loopback HTTP URL`);
  }
  return url;
}

function detailUrlFromCatalog(catalogUrl, configuredValue) {
  if (configuredValue) return resolveLoopbackUrl(configuredValue, "detailUrl");
  const url = new URL(catalogUrl);
  url.pathname = url.pathname.replace(/\/operator-catalog\/?$/, "/operator-detail");
  if (url.pathname === catalogUrl.pathname) url.pathname = "/operator-detail";
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
  const catalogUrl = resolveLoopbackUrl(config.catalogUrl || DEFAULT_CATALOG_URL, "catalogUrl");
  const detailUrl = detailUrlFromCatalog(catalogUrl, config.detailUrl);
  const timeoutMs = Math.max(1000, Math.min(Number(config.timeoutMs) || 10000, 60000));

  async function proxyJson(res, upstreamUrl, validate) {
    try {
      const upstream = await fetch(upstreamUrl, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const declaredLength = Number(upstream.headers.get("content-length") || 0);
      if (declaredLength > MAX_RESPONSE_BYTES) throw new Error("operator response is too large");
      const responseText = await upstream.text();
      if (Buffer.byteLength(responseText) > MAX_RESPONSE_BYTES) throw new Error("operator response is too large");
      const payload = JSON.parse(responseText);
      if (!validate(payload)) throw new Error("operator response has an invalid shape");
      sendJson(res, upstream.status, payload);
    } catch (error) {
      sendJson(res, 502, {
        ok: false,
        error: "operator_service_unavailable",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  ctx.effect(
    () => ctx.webServer.register({
      kind: "exact",
      path: CATALOG_ROUTE_PATH,
      async handler(req, res) {
        if (req.method !== "GET") {
          res.setHeader("allow", "GET");
          sendJson(res, 405, { ok: false, error: "method_not_allowed" });
          return;
        }
        await proxyJson(res, catalogUrl, payload => payload?.ok === true && Array.isArray(payload.operators));
      },
    }),
    "dj-operator-library: same-origin catalog route",
  );

  ctx.effect(
    () => ctx.webServer.register({
      kind: "exact",
      path: DETAIL_ROUTE_PATH,
      async handler(req, res) {
        if (req.method !== "GET") {
          res.setHeader("allow", "GET");
          sendJson(res, 405, { ok: false, error: "method_not_allowed" });
          return;
        }
        const requestUrl = new URL(req.url || DETAIL_ROUTE_PATH, "http://localhost");
        const name = String(requestUrl.searchParams.get("name") || "").trim();
        if (!name || name.length > 200) {
          sendJson(res, 400, { ok: false, error: "invalid_operator_name" });
          return;
        }
        const upstreamUrl = new URL(detailUrl);
        upstreamUrl.searchParams.set("name", name);
        await proxyJson(
          res,
          upstreamUrl,
          payload => payload && typeof payload.ok === "boolean" && (payload.ok === false || payload.operator?.name === name),
        );
      },
    }),
    "dj-operator-library: same-origin detail route",
  );
}
