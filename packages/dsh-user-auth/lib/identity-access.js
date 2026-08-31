import {
  argon2Sync,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

const USERNAME_PATTERN = /^[\p{L}\p{N}_-]{3,32}$/u;
const DEFAULT_PASSWORD_PARAMETERS = Object.freeze({
  memory: 65536,
  passes: 3,
  parallelism: 1,
  tagLength: 32,
});
const DEFAULT_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export class AuthError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
  }
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function fromBase64url(value) {
  return Buffer.from(value, "base64url");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeUsername(value) {
  const display = String(value ?? "").trim().normalize("NFKC");
  if (!USERNAME_PATTERN.test(display)) {
    throw new AuthError(
      "invalid_username",
      "用户名必须为 3–32 个中文、字母、数字、下划线或短横线",
    );
  }
  return { display, normalized: display.toLocaleLowerCase("und") };
}

function validatePassword(value) {
  const password = String(value ?? "");
  const length = [...password].length;
  if (length < 10 || length > 128) {
    throw new AuthError("invalid_password", "密码长度必须为 10–128 个字符");
  }
  return password;
}

function serializeSecret(secret, parameters = DEFAULT_PASSWORD_PARAMETERS) {
  const salt = randomBytes(16);
  const tag = argon2Sync("argon2id", {
    message: Buffer.from(secret, "utf8"),
    nonce: salt,
    memory: parameters.memory,
    passes: parameters.passes,
    parallelism: parameters.parallelism,
    tagLength: parameters.tagLength,
  });
  return [
    "argon2id",
    "v=19",
    `m=${parameters.memory},t=${parameters.passes},p=${parameters.parallelism},l=${parameters.tagLength}`,
    base64url(salt),
    base64url(tag),
  ].join("$");
}

function parseParameters(value) {
  const entries = Object.fromEntries(value.split(",").map(item => item.split("=", 2)));
  const parameters = {
    memory: Number(entries.m),
    passes: Number(entries.t),
    parallelism: Number(entries.p),
    tagLength: Number(entries.l),
  };
  if (Object.values(parameters).some(item => !Number.isSafeInteger(item) || item <= 0)) {
    throw new Error("invalid Argon2 parameter block");
  }
  return parameters;
}

function verifySecret(secret, encoded) {
  try {
    const [algorithm, version, rawParameters, rawSalt, rawExpected, extra] = String(encoded).split("$");
    if (algorithm !== "argon2id" || version !== "v=19" || extra !== undefined) return false;
    const parameters = parseParameters(rawParameters);
    const expected = fromBase64url(rawExpected);
    if (expected.length !== parameters.tagLength) return false;
    const actual = argon2Sync("argon2id", {
      message: Buffer.from(String(secret), "utf8"),
      nonce: fromBase64url(rawSalt),
      ...parameters,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function parseCookies(header) {
  const result = new Map();
  for (const part of String(header ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at <= 0) continue;
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key && !result.has(key)) result.set(key, value);
  }
  return result;
}

function rowToUser(row) {
  return {
    userId: row.user_id,
    username: row.username_display,
    role: row.role,
    status: row.status,
  };
}

function isUniqueConstraint(error) {
  if (!error || typeof error !== "object") return false;
  return Number(error.errcode) === 2067 || String(error.errstr ?? "").toLowerCase().includes("constraint");
}

export class IdentityAccess {
  constructor(options) {
    if (!options?.databasePath) throw new Error("identity-access: databasePath is required");
    if (!options?.inviteHash) throw new Error("identity-access: inviteHash is required");
    this.now = options.now ?? (() => Date.now());
    this.inviteHash = options.inviteHash;
    this.passwordParameters = options.passwordParameters ?? DEFAULT_PASSWORD_PARAMETERS;
    this.idleTtlMs = options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS;
    this.absoluteTtlMs = options.absoluteTtlMs ?? DEFAULT_ABSOLUTE_TTL_MS;
    this.secureCookie = options.secureCookie ?? true;
    this.cookieName = options.cookieName ?? (this.secureCookie ? "__Host-dsh_session" : "dsh_session");
    this.requestContext = new AsyncLocalStorage();
    mkdirSync(dirname(options.databasePath), { recursive: true });
    this.db = new DatabaseSync(options.databasePath);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  static hashInviteCode(value, parameters = DEFAULT_PASSWORD_PARAMETERS) {
    if (String(value ?? "").length < 6) throw new Error("invite code must contain at least 6 characters");
    return serializeSecret(String(value), parameters);
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY,
        username_normalized TEXT NOT NULL UNIQUE,
        username_display TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user')),
        status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
        password_version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_login_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS auth_sessions (
        session_id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        password_version INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        idle_expires_at INTEGER NOT NULL,
        absolute_expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS auth_sessions_user_id ON auth_sessions(user_id);
      CREATE TABLE IF NOT EXISTS auth_audit_events (
        event_id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
        event_type TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        detail_json TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS session_owners (
        session_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS session_owners_user_id ON session_owners(user_id);
    `);
  }

  close() {
    this.db.close();
  }

  register(input) {
    const username = normalizeUsername(input?.username);
    const password = validatePassword(input?.password);
    if (!verifySecret(input?.inviteCode ?? "", this.inviteHash)) {
      throw new AuthError("invalid_invite", "邀请码无效", 403);
    }
    const now = this.now();
    const userId = `usr_${base64url(randomBytes(18))}`;
    const passwordHash = serializeSecret(password, this.passwordParameters);
    try {
      this.db.prepare(`
        INSERT INTO users (
          user_id, username_normalized, username_display, password_hash,
          role, status, password_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'user', 'active', 1, ?, ?)
      `).run(userId, username.normalized, username.display, passwordHash, now, now);
    } catch (error) {
      if (isUniqueConstraint(error)) {
        throw new AuthError("username_taken", "用户名已存在", 409);
      }
      throw error;
    }
    const user = { userId, username: username.display, role: "user", status: "active" };
    this.audit("register", userId);
    return this.createSession(userId);
  }

  login(input) {
    let username;
    try {
      username = normalizeUsername(input?.username);
    } catch {
      throw new AuthError("invalid_credentials", "用户名或密码错误", 401);
    }
    const row = this.db.prepare("SELECT * FROM users WHERE username_normalized = ?").get(username.normalized);
    const passwordMatches = row ? verifySecret(input?.password ?? "", row.password_hash) : false;
    if (!row || !passwordMatches || row.status !== "active") {
      this.audit("login_failed", row?.user_id ?? null);
      throw new AuthError("invalid_credentials", "用户名或密码错误", 401);
    }
    const now = this.now();
    this.db.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE user_id = ?")
      .run(now, now, row.user_id);
    this.audit("login", row.user_id);
    return this.createSession(row.user_id);
  }

  createSession(userId) {
    const user = this.db.prepare("SELECT * FROM users WHERE user_id = ?").get(userId);
    if (!user || user.status !== "active") throw new AuthError("account_unavailable", "账号不可用", 403);
    const now = this.now();
    const token = base64url(randomBytes(32));
    const sessionId = `ses_${base64url(randomBytes(18))}`;
    this.db.prepare(`
      INSERT INTO auth_sessions (
        session_id, token_hash, user_id, password_version, created_at,
        last_seen_at, idle_expires_at, absolute_expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      sessionId,
      sha256(token),
      userId,
      user.password_version,
      now,
      now,
      now + this.idleTtlMs,
      now + this.absoluteTtlMs,
    );
    return { token, sessionId, user: rowToUser(user) };
  }

  authenticateToken(token) {
    if (!token) return null;
    const now = this.now();
    const row = this.db.prepare(`
      SELECT s.*, u.username_display, u.role, u.status, u.password_version AS current_password_version
      FROM auth_sessions s
      JOIN users u ON u.user_id = s.user_id
      WHERE s.token_hash = ?
    `).get(sha256(token));
    if (!row || row.revoked_at !== null || row.status !== "active") return null;
    if (row.password_version !== row.current_password_version) return null;
    if (row.idle_expires_at <= now || row.absolute_expires_at <= now) return null;
    const nextIdleExpiry = Math.min(now + this.idleTtlMs, row.absolute_expires_at);
    this.db.prepare("UPDATE auth_sessions SET last_seen_at = ?, idle_expires_at = ? WHERE session_id = ?")
      .run(now, nextIdleExpiry, row.session_id);
    return {
      userId: row.user_id,
      username: row.username_display,
      role: row.role,
      sessionId: row.session_id,
    };
  }

  authenticateRequest(req) {
    return this.authenticateToken(parseCookies(req?.headers?.cookie).get(this.cookieName));
  }

  enterRequest(req) {
    const principal = this.authenticateRequest(req);
    if (principal !== null) this.requestContext.enterWith(principal);
    return principal;
  }

  currentPrincipal() {
    return this.requestContext.getStore() ?? null;
  }

  sessionOwner(sessionId) {
    return this.db.prepare("SELECT user_id FROM session_owners WHERE session_id = ?").get(String(sessionId))?.user_id ?? null;
  }

  canAccessSession(principal, sessionId) {
    if (!principal) return false;
    if (principal.role === "admin") return true;
    return this.sessionOwner(sessionId) === principal.userId;
  }

  bindSession(sessionId, userId) {
    const id = String(sessionId);
    const existing = this.sessionOwner(id);
    if (existing !== null && existing !== userId) {
      throw new AuthError("session_owned", "该对话属于其他用户", 403);
    }
    this.db.prepare("INSERT OR IGNORE INTO session_owners (session_id, user_id, created_at) VALUES (?, ?, ?)")
      .run(id, userId, this.now());
  }

  claimSessions(userId, sessionIds) {
    const insert = this.db.prepare("INSERT OR IGNORE INTO session_owners (session_id, user_id, created_at) VALUES (?, ?, ?)");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const sessionId of new Set(sessionIds.map(String))) insert.run(sessionId, userId, this.now());
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  sessionsFor(principal, sessionIds) {
    if (!principal) return [];
    if (principal.role === "admin") return [...sessionIds];
    return sessionIds.filter(sessionId => this.sessionOwner(sessionId) === principal.userId);
  }

  setUserRole(userId, role) {
    if (role !== "admin" && role !== "user") throw new Error("invalid role");
    const result = this.db.prepare("UPDATE users SET role = ?, updated_at = ? WHERE user_id = ?")
      .run(role, this.now(), userId);
    if (result.changes !== 1) throw new Error(`unknown user: ${userId}`);
  }

  logoutToken(token) {
    if (!token) return;
    this.db.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
      .run(this.now(), sha256(token));
  }

  logoutRequest(req) {
    this.logoutToken(parseCookies(req?.headers?.cookie).get(this.cookieName));
  }

  sessionCookie(token) {
    const parts = [
      `${this.cookieName}=${token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${Math.floor(this.idleTtlMs / 1000)}`,
    ];
    if (this.secureCookie) parts.push("Secure");
    return parts.join("; ");
  }

  clearSessionCookie() {
    const parts = [
      `${this.cookieName}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=0",
    ];
    if (this.secureCookie) parts.push("Secure");
    return parts.join("; ");
  }

  audit(type, userId, detail = {}) {
    this.db.prepare(`
      INSERT INTO auth_audit_events (event_id, user_id, event_type, created_at, detail_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(`evt_${base64url(randomBytes(18))}`, userId, type, this.now(), JSON.stringify(detail));
  }
}

export const identityAccessInternals = {
  normalizeUsername,
  serializeSecret,
  verifySecret,
};
