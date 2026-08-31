#!/usr/bin/env node
import { IdentityAccess } from "./identity-access.js";

const inviteCode = process.argv[2];
if (!inviteCode) {
  process.stderr.write("usage: node hash-invite.js <invite-code>\n");
  process.exitCode = 1;
} else {
  process.stdout.write(`${IdentityAccess.hashInviteCode(inviteCode)}\n`);
}
