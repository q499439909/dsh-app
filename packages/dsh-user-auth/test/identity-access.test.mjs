import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AuthError, IdentityAccess } from "../lib/identity-access.js";

const fastParameters = { memory: 8192, passes: 1, parallelism: 1, tagLength: 32 };

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dsh-user-auth-"));
  let now = Date.UTC(2026, 7, 31);
  const inviteHash = IdentityAccess.hashInviteCode("test-invite", fastParameters);
  const identity = new IdentityAccess({
    databasePath: join(root, "auth.sqlite"),
    inviteHash,
    passwordParameters: fastParameters,
    secureCookie: false,
    cookieName: "dsh_session",
    idleTtlMs: 1000,
    absoluteTtlMs: 5000,
    now: () => now,
  });
  return { identity, advance: milliseconds => { now += milliseconds; } };
}

test("register creates a private server session and authenticates its cookie", () => {
  const { identity } = fixture();
  try {
    const session = identity.register({
      username: "测试用户",
      password: "a sufficiently long password",
      inviteCode: "test-invite",
    });
    assert.equal(session.user.username, "测试用户");
    assert.equal(session.user.role, "user");
    const principal = identity.authenticateRequest({
      headers: { cookie: `other=x; dsh_session=${session.token}` },
    });
    assert.equal(principal.userId, session.user.userId);
    assert.equal(principal.sessionId, session.sessionId);
  } finally {
    identity.close();
  }
});

test("registration rejects a wrong invite and duplicate normalized username", () => {
  const { identity } = fixture();
  try {
    assert.throws(
      () => identity.register({ username: "sample-user", password: "long enough password", inviteCode: "wrong-code" }),
      error => error instanceof AuthError && error.code === "invalid_invite",
    );
    identity.register({ username: "Sample-User", password: "long enough password", inviteCode: "test-invite" });
    assert.throws(
      () => identity.register({ username: "sample-user", password: "another long password", inviteCode: "test-invite" }),
      error => error instanceof AuthError && error.code === "username_taken",
    );
  } finally {
    identity.close();
  }
});

test("login uses one error for missing users and wrong passwords", () => {
  const { identity } = fixture();
  try {
    identity.register({ username: "sample-user", password: "correct horse battery", inviteCode: "test-invite" });
    for (const input of [
      { username: "missing-user", password: "correct horse battery" },
      { username: "sample-user", password: "wrong horse battery" },
    ]) {
      assert.throws(
        () => identity.login(input),
        error => error instanceof AuthError && error.code === "invalid_credentials" && error.status === 401,
      );
    }
  } finally {
    identity.close();
  }
});

test("logout and idle expiry invalidate the server-side session", () => {
  const first = fixture();
  try {
    const session = first.identity.register({ username: "first-user", password: "correct horse battery", inviteCode: "test-invite" });
    first.identity.logoutToken(session.token);
    assert.equal(first.identity.authenticateToken(session.token), null);
  } finally {
    first.identity.close();
  }

  const second = fixture();
  try {
    const session = second.identity.register({ username: "second-user", password: "correct horse battery", inviteCode: "test-invite" });
    second.advance(1001);
    assert.equal(second.identity.authenticateToken(session.token), null);
  } finally {
    second.identity.close();
  }
});

test("production cookie shape is HttpOnly, same-site, and secure", () => {
  const root = mkdtempSync(join(tmpdir(), "dsh-user-auth-cookie-"));
  const identity = new IdentityAccess({
    databasePath: join(root, "auth.sqlite"),
    inviteHash: IdentityAccess.hashInviteCode("test-invite", fastParameters),
    passwordParameters: fastParameters,
  });
  try {
    assert.match(identity.sessionCookie("token"), /^__Host-dsh_session=token; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
  } finally {
    identity.close();
  }
});

test("session ownership is private to its user while administrators may inspect all", () => {
  const { identity } = fixture();
  try {
    const first = identity.register({ username: "first-user", password: "correct horse battery", inviteCode: "test-invite" });
    const second = identity.register({ username: "second-user", password: "correct horse battery", inviteCode: "test-invite" });
    const firstPrincipal = identity.authenticateToken(first.token);
    const secondPrincipal = identity.authenticateToken(second.token);
    identity.bindSession("session-a", first.user.userId);
    assert.equal(identity.canAccessSession(firstPrincipal, "session-a"), true);
    assert.equal(identity.canAccessSession(secondPrincipal, "session-a"), false);
    assert.deepEqual(identity.sessionsFor(secondPrincipal, ["session-a", "session-b"]), []);
    identity.setUserRole(second.user.userId, "admin");
    assert.equal(identity.canAccessSession(identity.authenticateToken(second.token), "session-a"), true);
  } finally {
    identity.close();
  }
});

test("request principal is carried through asynchronous API work", async () => {
  const { identity } = fixture();
  try {
    const session = identity.register({ username: "context-user", password: "correct horse battery", inviteCode: "test-invite" });
    assert.equal(identity.enterRequest({ headers: { cookie: `dsh_session=${session.token}` } })?.userId, session.user.userId);
    await Promise.resolve();
    assert.equal(identity.currentPrincipal()?.userId, session.user.userId);
  } finally {
    identity.close();
  }
});
