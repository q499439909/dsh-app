import { resolve } from "node:path";
import { AuthError, IdentityAccess } from "./identity-access.js";
import { authScript, authStyles } from "./client-inline.js";
import { installSessionAccess } from "./session-access.js";

export const name = "dsh-user-auth";
export const inject = ["webServer", "apiProxy"];

const BODY_LIMIT = 16 * 1024;

function sendJson(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    ...headers,
  });
  res.end(body);
}

async function readJson(req) {
  const declared = Number(req.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > BODY_LIMIT) {
    throw new AuthError("body_too_large", "请求内容过大", 413);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > BODY_LIMIT) throw new AuthError("body_too_large", "请求内容过大", 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AuthError("invalid_json", "请求格式无效", 400);
  }
}

function verifySameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  const host = req.headers.host;
  if (!host) throw new AuthError("invalid_origin", "请求来源无效", 403);
  let authority;
  try {
    authority = new URL(origin).host;
  } catch {
    throw new AuthError("invalid_origin", "请求来源无效", 403);
  }
  if (authority !== host) throw new AuthError("invalid_origin", "请求来源无效", 403);
}

function errorResponse(res, error) {
  if (error instanceof AuthError) {
    sendJson(res, error.status, { ok: false, error: error.code, message: error.message });
    return;
  }
  sendJson(res, 500, { ok: false, error: "internal_error", message: "服务器暂时不可用" });
}

function exactRoute(ctx, path, method, handler) {
  ctx.effect(
    () => ctx.webServer.register({
      kind: "exact",
      path,
      async handler(req, res) {
        if (req.method !== method) {
          res.setHeader("allow", method);
          sendJson(res, 405, { ok: false, error: "method_not_allowed" });
          return;
        }
        try {
          if (method !== "GET") verifySameOrigin(req);
          await handler(req, res);
        } catch (error) {
          errorResponse(res, error);
        }
      },
    }),
    `dsh-user-auth: ${path}`,
  );
}

export function apply(ctx, config = {}) {
  if (config.enabled !== true) return;
  const inviteHash = config.inviteHash || process.env.DSH_REGISTRATION_INVITE_HASH;
  if (!inviteHash) throw new Error("dsh-user-auth: inviteHash or DSH_REGISTRATION_INVITE_HASH is required");
  const databasePath = resolve(config.databasePath || process.env.DSH_AUTH_DATABASE_PATH || ".dsh/auth.sqlite");
  const secureCookie = config.secureCookie ?? process.env.DSH_AUTH_SECURE_COOKIE !== "false";
  const identity = new IdentityAccess({
    databasePath,
    inviteHash,
    secureCookie,
    ...(config.passwordParameters ? { passwordParameters: config.passwordParameters } : {}),
  });

  ctx.provide("identityAccess", identity);
  ctx.effect(() => () => identity.close(), "dsh-user-auth: close database");
  ctx.effect(
    () => ctx.webServer.registerRequestGuard(async (req, kind) => {
      if (kind === "http") {
        const path = new URL(req.url || "/", "http://localhost").pathname;
        if (!path.startsWith("/api")) return true;
      }
      return identity.enterRequest(req) !== null;
    }),
    "dsh-user-auth: global request guard",
  );
  ctx.effect(() => installSessionAccess(ctx.apiProxy, identity), "dsh-user-auth: session ownership boundary");

  exactRoute(ctx, "/auth/session", "GET", async (req, res) => {
    const principal = identity.authenticateRequest(req);
    sendJson(res, 200, principal
      ? { ok: true, authenticated: true, user: { userId: principal.userId, username: principal.username, role: principal.role } }
      : { ok: true, authenticated: false });
  });

  for (const action of ["login", "register"]) {
    exactRoute(ctx, `/auth/${action}`, "POST", async (req, res) => {
      const input = await readJson(req);
      const session = identity[action](input);
      sendJson(res, action === "register" ? 201 : 200, {
        ok: true,
        user: session.user,
      }, { "set-cookie": identity.sessionCookie(session.token) });
    });
  }

  exactRoute(ctx, "/auth/logout", "POST", async (req, res) => {
    identity.logoutRequest(req);
    sendJson(res, 200, { ok: true }, { "set-cookie": identity.clearSessionCookie() });
  });

  ctx.on("webserver/index-inject", table => {
    table.push(
      { kind: "style", text: authStyles },
      { kind: "script", placement: "body", text: authScript },
    );
  });
}

export { AuthError, IdentityAccess };
