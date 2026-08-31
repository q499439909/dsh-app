import { resolve } from "node:path";
import { DatasetCatalog, DatasetError } from "./dataset-catalog.js";
import { RunOutputHttpAdapter } from "./run-output-http.js";

export const name = "dj-datasets";
export const inject = ["webServer", "apiProxy", "identityAccess"];

const BODY_LIMIT = 32 * 1024;

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "private, no-store",
    "content-length": Buffer.byteLength(body),
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  if (!req.headers.host || new URL(origin).host !== req.headers.host) {
    throw new DatasetError("invalid_origin", "请求来源无效", 403);
  }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new DatasetError("body_too_large", "请求内容过大", 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch {
    throw new DatasetError("invalid_json", "请求格式无效", 400);
  }
}

function responseValue(response) {
  return response?.result?.ok === true ? response.result.value : undefined;
}

function discoverRunOrigins(root) {
  const results = new Map();
  const seen = new Set();
  const visit = (value, inherited = {}, depth = 0) => {
    if (depth > 14 || value === null || value === undefined) return;
    if (typeof value === "string") {
      const text = value.trim();
      if (text.length < 2 || text.length > 4 * 1024 * 1024 || !["{", "["].includes(text[0])) return;
      try { visit(JSON.parse(text), inherited, depth + 1); } catch {}
      return;
    }
    if (typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const context = {
      workspaceRoot: value.workspace_root ?? value.workspaceRoot ?? inherited.workspaceRoot,
      taskId: value.task_id ?? value.taskId ?? inherited.taskId,
      planVersion: value.plan_version ?? value.planVersion ?? inherited.planVersion,
    };
    const run = value.run && typeof value.run === "object" ? value.run : value;
    const resultRef = run.result_ref ?? run.resultRef ?? (String(run.run_id ?? "").startsWith("run_r") ? run.run_id : undefined);
    if (context.workspaceRoot && context.taskId && context.planVersion && resultRef) {
      const origin = {
        workspaceRoot: String(context.workspaceRoot),
        taskId: String(context.taskId),
        planVersion: String(context.planVersion),
        resultRef: String(resultRef),
      };
      results.set(`${origin.workspaceRoot}\0${origin.taskId}\0${origin.planVersion}\0${origin.resultRef}`, origin);
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) visit(child, context, depth + 1);
  };
  visit(root);
  return [...results.values()];
}

async function reconcileFromSessions(apiProxy, identityAccess, catalog, principal) {
  const listed = await apiProxy.sessions.list({ rpcId: `datasets-list-${Date.now()}`, payload: { limit: 200 } });
  const sessions = responseValue(listed)?.items ?? [];
  let discovered = 0;
  let registered = 0;
  const results = [];
  for (const item of sessions) {
    const sessionId = item?.sessionId;
    if (!sessionId || !identityAccess.canAccessSession(principal, sessionId)) continue;
    const history = await apiProxy.sessions.history({
      rpcId: `datasets-history-${sessionId}-${Date.now()}`,
      payload: { sessionId },
    });
    for (const origin of discoverRunOrigins(responseValue(history))) {
      discovered += 1;
      const result = await catalog.registerRunResult(principal, sessionId, origin);
      if (result) {
        registered += 1;
        results.push({ ...result, resultRef: origin.resultRef, sourceSessionId: String(sessionId) });
      }
    }
  }
  return { discovered, registered, results };
}

function registerRoute(ctx, path, methods, handler) {
  const allowed = Array.isArray(methods) ? methods : [methods];
  ctx.effect(
    () => ctx.webServer.register({
      kind: "exact",
      path,
      async handler(req, res) {
        if (!allowed.includes(req.method)) {
          res.setHeader("allow", allowed.join(", "));
          sendJson(res, 405, { ok: false, error: "method_not_allowed" });
          return;
        }
        try {
          if (req.method !== "GET") sameOrigin(req);
          await handler(req, res);
        } catch (error) {
          if (error instanceof DatasetError) {
            sendJson(res, error.status, { ok: false, error: error.code, message: error.message });
          } else {
            sendJson(res, 500, { ok: false, error: "internal_error", message: "结果中心暂时不可用" });
          }
        }
      },
    }),
    `dj-datasets: ${path}`,
  );
}

export function apply(ctx, config = {}) {
  const runOutputPort = config.runOutputPort ?? new RunOutputHttpAdapter({
    baseUrl: config.baseUrl || "http://127.0.0.1:8010",
    token: config.internalToken || process.env.DSH_DJ_INTERNAL_TOKEN,
    timeoutMs: config.timeoutMs,
  });
  const catalog = new DatasetCatalog({
    databasePath: resolve(config.databasePath || process.env.DSH_DATASET_DATABASE_PATH || ".dsh/datasets.sqlite"),
    identityAccess: ctx.identityAccess,
    runOutputPort,
  });
  ctx.provide("datasetCatalog", catalog);
  ctx.effect(() => () => catalog.close(), "dj-datasets: close catalog");
  const principal = () => ctx.identityAccess.currentPrincipal();

  registerRoute(ctx, "/api/dj/datasets", "GET", async (req, res) => {
    const url = new URL(req.url || "/api/dj/datasets", "http://localhost");
    const page = await catalog.list(principal(), {
      q: url.searchParams.get("q") || undefined,
      status: url.searchParams.get("status") || undefined,
      mediaType: url.searchParams.get("media_type") || undefined,
      ownerId: url.searchParams.get("owner_id") || undefined,
      limit: url.searchParams.get("limit") || undefined,
      offset: url.searchParams.get("offset") || undefined,
    });
    sendJson(res, 200, { ok: true, ...page });
  });

  registerRoute(ctx, "/api/dj/dataset", ["GET", "DELETE"], async (req, res) => {
    const url = new URL(req.url || "/api/dj/dataset", "http://localhost");
    const datasetId = url.searchParams.get("dataset_id");
    if (req.method === "DELETE") {
      const body = await readJson(req);
      const result = await catalog.delete(principal(), datasetId, body);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }
    sendJson(res, 200, { ok: true, dataset: await catalog.get(principal(), datasetId) });
  });

  registerRoute(ctx, "/api/dj/dataset-items", "GET", async (req, res) => {
    const url = new URL(req.url || "/api/dj/dataset-items", "http://localhost");
    const page = await catalog.listItems(principal(), url.searchParams.get("dataset_id"), {
      q: url.searchParams.get("q") || undefined,
      label: url.searchParams.get("label") || undefined,
      mediaType: url.searchParams.get("media_type") || undefined,
      limit: url.searchParams.get("limit") || undefined,
      offset: url.searchParams.get("offset") || undefined,
    });
    sendJson(res, 200, { ok: true, ...page });
  });

  registerRoute(ctx, "/api/dj/dataset-asset", "GET", async (req, res) => {
    const url = new URL(req.url || "/api/dj/dataset-asset", "http://localhost");
    const resolved = await catalog.getAsset(principal(), url.searchParams.get("dataset_id"), url.searchParams.get("asset_id"));
    const upstream = await runOutputPort.openAsset(resolved.origin, resolved.asset.assetId, {
      range: req.headers.range,
      download: url.searchParams.get("download") === "1",
    });
    res.statusCode = upstream.status;
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "content-disposition", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    res.setHeader("cache-control", "private, no-store");
    res.setHeader("x-content-type-options", "nosniff");
    if (upstream.body) for await (const chunk of upstream.body) res.write(Buffer.from(chunk));
    res.end();
  });

  registerRoute(ctx, "/api/dj/dataset-archive", "GET", async (req, res) => {
    const url = new URL(req.url || "/api/dj/dataset-archive", "http://localhost");
    const resolved = await catalog.getArchive(principal(), url.searchParams.get("dataset_id"), url.searchParams.getAll("asset_id"));
    const upstream = await runOutputPort.openArchive(resolved.origin, resolved.assetIds);
    res.statusCode = upstream.status;
    for (const name of ["content-type", "content-length", "content-disposition", "etag", "last-modified"]) {
      const value = upstream.headers.get(name);
      if (value) res.setHeader(name, value);
    }
    res.setHeader("cache-control", "private, no-store");
    res.setHeader("x-content-type-options", "nosniff");
    if (upstream.body) for await (const chunk of upstream.body) res.write(Buffer.from(chunk));
    res.end();
  });

  registerRoute(ctx, "/api/dj/datasets/reconcile", "POST", async (_req, res) => {
    const result = await reconcileFromSessions(ctx.apiProxy, ctx.identityAccess, catalog, principal());
    sendJson(res, 200, { ok: true, ...result });
  });
}

export { DatasetCatalog, DatasetError };
export const datasetPluginInternals = { discoverRunOrigins, reconcileFromSessions, responseValue };
