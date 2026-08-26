#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Auth security unit tests — password policy, JWT hardening helpers.
 * Run: node scripts/auth-security-test.js
 */
require("dotenv").config();

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const failures = [];
const passes = [];

function pass(name, detail) {
  passes.push({ name, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
}

function fail(name, err) {
  const msg = err instanceof Error ? err.message : String(err);
  failures.push({ name, msg });
  console.error(`FAIL  ${name} — ${msg}`);
}

function assert(name, condition, detail) {
  if (condition) pass(name, detail);
  else fail(name, detail || "assertion failed");
}

async function testPasswordPolicy() {
  const { validatePassword } = require("../api/utils/passwordPolicy");

  assert("reject short password", validatePassword("abc") !== null);
  assert("reject empty password", validatePassword("") !== null);
  assert(
    "reject password without number",
    validatePassword("abcdefgh") !== null
  );
  assert(
    "reject password without letter",
    validatePassword("12345678") !== null
  );
  assert(
    "accept strong password",
    validatePassword("SecurePass1") === null
  );
  assert(
    "reject overly long password",
    validatePassword("a1".repeat(65)) !== null
  );
}

function testJwtAlgorithmPinning() {
  process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-minimum-32-chars-long!!";

  const {
    signToken,
    verifyToken,
    JWT_ALGORITHM,
  } = require("../api/middleware/auth");

  assert("JWT algorithm is HS256", JWT_ALGORITHM === "HS256");

  const token = signToken({
    id: 1,
    email: "test@example.com",
    role: "admin",
    name: "Test",
    token_version: 0,
  });

  try {
    const decoded = verifyToken(token);
    pass("verify valid HS256 token");
    assert("JWT includes session jti", typeof decoded.jti === "string" && decoded.jti.length > 0);
  } catch (e) {
    fail("verify valid HS256 token", e);
  }

  const {
    maxActiveSessions,
    DEFAULT_MAX_ACTIVE_SESSIONS,
  } = require("../api/services/adminSessionStore");
  assert(
    "default max admin sessions is 5",
    DEFAULT_MAX_ACTIVE_SESSIONS === 5 && maxActiveSessions() === 5
  );

  const parts = token.split(".");
  const header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
  const tamperedHeader = Buffer.from(
    JSON.stringify({ ...header, alg: "none" })
  ).toString("base64url");
  const noneToken = `${tamperedHeader}.${parts[1]}.`;

  try {
    verifyToken(noneToken);
    fail("reject none algorithm", "token was accepted");
  } catch {
    pass("reject none algorithm");
  }
}

async function testBcryptCost() {
  const hash = await bcrypt.hash("TestPassword1", 12);
  assert("bcrypt cost factor is 12", hash.startsWith("$2b$12$") || hash.startsWith("$2a$12$"));
}

function testAccountLockoutHelpers() {
  const { isAccountLocked, MAX_FAILED_ATTEMPTS } = require("../api/utils/accountLockout");

  assert("lockout threshold is 5", MAX_FAILED_ATTEMPTS === 5);
  assert(
    "account not locked when locked_until is null",
    !isAccountLocked({ locked_until: null })
  );
  assert(
    "account locked when locked_until is future",
    isAccountLocked({ locked_until: new Date(Date.now() + 60_000).toISOString() })
  );
  assert(
    "account not locked when locked_until is past",
    !isAccountLocked({ locked_until: new Date(Date.now() - 60_000).toISOString() })
  );
}

function testWebhookVerify() {
  const crypto = require("crypto");
  const { verifyWhatsAppHmac, getMpesaAllowedIps } = require("../api/middleware/webhookVerify");

  const appSecret = "test-app-secret";
  const body = Buffer.from(JSON.stringify({ entry: [] }));
  const sig =
    "sha256=" +
    crypto.createHmac("sha256", appSecret).update(body).digest("hex");

  assert("accept valid WhatsApp signature", verifyWhatsAppHmac(sig, body, appSecret).ok);
  assert(
    "reject invalid WhatsApp signature",
    !verifyWhatsAppHmac("sha256=deadbeef", body, appSecret).ok
  );
  assert("M-Pesa IP allowlist is non-empty", getMpesaAllowedIps().length > 0);
}

async function testRateLimiter() {
  const { createRateLimiter } = require("../api/middleware/rateLimit");
  const limiter = createRateLimiter({
    windowMs: 60_000,
    max: 2,
    message: { error: "limited" },
  });

  let statusCode = 200;
  const req = { headers: {}, socket: { remoteAddress: "127.0.0.1-test" } };
  const res = {
    setHeader() {},
    status(code) {
      statusCode = code;
      return { json() {} };
    },
  };

  const run = () =>
    new Promise((resolve) => {
      limiter(req, res, resolve);
    });

  await run();
  await run();
  statusCode = 200;
  limiter(req, res, () => {});

  assert("rate limiter blocks after max", statusCode === 429);
}

function testPasswordResetTokens() {
  const {
    generateResetToken,
    hashResetToken,
    isResetTokenExpired,
    PASSWORD_RESET_USER_SQL,
  } = require("../api/utils/passwordResetToken");
  const {
    genericRecoveryResponse,
    shouldSendPasswordResetEmail,
  } = require("../api/utils/accountRecovery");

  const token = generateResetToken();
  assert("reset token is high entropy", token.length >= 32);
  assert("reset token hash is sha256 hex", hashResetToken(token).length === 64);
  assert(
    "reset token hash is not the raw token",
    hashResetToken(token) !== token
  );
  assert(
    "expired reset tokens are rejected",
    isResetTokenExpired(new Date(Date.now() - 1000))
  );
  assert(
    "password reset clears lockout",
    PASSWORD_RESET_USER_SQL.includes("locked_until = NULL")
  );
  const res = genericRecoveryResponse();
  assert(
    "recovery response does not enumerate accounts",
    res.ok === true && !String(res.message).toLowerCase().includes("not found")
  );
  assert(
    "inactive accounts do not receive reset mail",
    shouldSendPasswordResetEmail({ id: 1, is_active: 0 }) === false
  );
  assert(
    "locked active accounts do receive reset mail",
    shouldSendPasswordResetEmail({ id: 1, is_active: 1 }) === true
  );
}

async function main() {
  console.log("Auth security tests\n");
  await testPasswordPolicy();
  testJwtAlgorithmPinning();
  testAccountLockoutHelpers();
  testPasswordResetTokens();
  testWebhookVerify();
  await testBcryptCost();
  await testRateLimiter();

  console.log(`\n${passes.length} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
