const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  DEFAULT_RECOVERY_EMAIL,
  recoveryInboxEmail,
  genericRecoveryResponse,
  accountStatusLabel,
  shouldSendPasswordResetEmail,
  adminResetPasswordUrl,
  buildPasswordResetEmail,
  buildAccountRecoveryEmail,
} = require("../../api/utils/accountRecovery");
const {
  TOKEN_TTL_MINUTES,
  TOKEN_BYTES,
  PASSWORD_RESET_USER_SQL,
  generateResetToken,
  hashResetToken,
  resetTokenExpiresAt,
  isResetTokenExpired,
  isResetTokenRowValid,
} = require("../../api/utils/passwordResetToken");
const {
  ADMIN_AUDIT_EXTRA_EVENT_TYPES,
} = require("../../api/lib/customerActivityEvents");

describe("account recovery", () => {
  it("emails IT by default only as a fallback inbox", () => {
    assert.equal(DEFAULT_RECOVERY_EMAIL, "it@sulsolutions.biz");
    assert.equal(recoveryInboxEmail(), "it@sulsolutions.biz");
  });

  it("does not reveal whether an account exists in the public response", () => {
    const res = genericRecoveryResponse();
    assert.equal(res.ok, true);
    assert.match(res.message, /If an account exists/i);
    assert.match(res.message, /reset link/i);
    assert.equal(res.message.includes("not found"), false);
    assert.equal(res.message.toLowerCase().includes("it@"), false);
  });

  it("sends a reset link to active and locked staff, but not inactive or unknown", () => {
    assert.equal(shouldSendPasswordResetEmail(null), false);
    assert.equal(shouldSendPasswordResetEmail({ id: 1, is_active: 0 }), false);
    assert.equal(shouldSendPasswordResetEmail({ id: 1, is_active: 1 }), true);
    assert.equal(
      shouldSendPasswordResetEmail({
        id: 2,
        is_active: true,
        locked_until: "2099-01-01T00:00:00.000Z",
      }),
      true
    );
  });

  it("builds a staff reset email with a time-limited link", () => {
    const mail = buildPasswordResetEmail({
      name: "Ada",
      email: "ada@sulsolutions.biz",
      resetUrl: "http://localhost:5173/admin/reset-password?token=abc",
    });
    assert.equal(mail.toAddress, "ada@sulsolutions.biz");
    assert.match(mail.subject, /reset/i);
    assert.match(mail.content, /reset-password\?token=abc/);
    assert.match(mail.content, new RegExp(`${TOKEN_TTL_MINUTES} minutes`));
    assert.equal(mail.toAddress.includes("it@"), false);
  });

  it("escapes the reset URL in the staff email", () => {
    const mail = buildPasswordResetEmail({
      name: "<script>",
      email: "user@sulsolutions.biz",
      resetUrl: "http://localhost:5173/admin/reset-password?token=\"><img src=x>",
    });
    assert.equal(mail.content.includes("<script>"), false);
    assert.match(mail.content, /&lt;script&gt;/);
    assert.equal(mail.content.includes("<img src=x>"), false);
  });

  it("points the reset URL at /admin/reset-password", () => {
    const prev = process.env.ADMIN_ORIGIN;
    process.env.ADMIN_ORIGIN = "https://app.sulsolutions.biz";
    try {
      const url = adminResetPasswordUrl("tok/en+value");
      assert.equal(
        url,
        "https://app.sulsolutions.biz/admin/reset-password?token=tok%2Fen%2Bvalue"
      );
    } finally {
      process.env.ADMIN_ORIGIN = prev;
    }
  });

  it("labels locked and inactive staff accounts for IT fallback mail", () => {
    assert.equal(accountStatusLabel(null), "No matching staff account");
    assert.equal(accountStatusLabel({ is_active: false }), "Inactive");
    assert.equal(
      accountStatusLabel({
        is_active: true,
        lockedUntil: "2026-08-18T12:00:00.000Z",
      }),
      "Locked until 2026-08-18T12:00:00.000Z"
    );
    assert.equal(accountStatusLabel({ is_active: true }), "Active");
  });

  it("keeps an IT fallback email that does not leak requester HTML", () => {
    const mail = buildAccountRecoveryEmail({
      requesterEmail: "user@sulsolutions.biz",
      user: { name: "<script>", role: "user", is_active: true },
      note: "<img src=x onerror=alert(1)>",
      usersUrl: "http://localhost:5173/settings",
    });
    assert.equal(mail.toAddress, "it@sulsolutions.biz");
    assert.equal(mail.content.includes("<script>"), false);
    assert.match(mail.content, /&lt;script&gt;/);
    assert.match(mail.content, /&lt;img src=x/);
    assert.match(mail.content, /could not be sent/i);
  });

  it("records password reset events on the admin activity audit trail", () => {
    assert.ok(ADMIN_AUDIT_EXTRA_EVENT_TYPES.includes("password_reset_requested"));
    assert.ok(ADMIN_AUDIT_EXTRA_EVENT_TYPES.includes("password_reset_completed"));
    assert.ok(ADMIN_AUDIT_EXTRA_EVENT_TYPES.includes("account_unlocked"));
    assert.ok(ADMIN_AUDIT_EXTRA_EVENT_TYPES.includes("user_recovery_requested"));
  });
});

describe("password reset tokens", () => {
  it("generates high-entropy tokens and stores only a hash", () => {
    const a = generateResetToken();
    const b = generateResetToken();
    assert.notEqual(a, b);
    assert.ok(a.length >= TOKEN_BYTES);
    const hash = hashResetToken(a);
    assert.equal(hash, hashResetToken(a));
    assert.notEqual(hash, a);
    assert.equal(hash.length, 64);
    assert.match(hash, /^[a-f0-9]+$/);
  });

  it("expires after 60 minutes", () => {
    const from = new Date("2026-08-26T09:00:00.000Z");
    const expires = resetTokenExpiresAt(from);
    assert.equal(expires.toISOString(), "2026-08-26T10:00:00.000Z");
    assert.equal(isResetTokenExpired(expires, from), false);
    assert.equal(
      isResetTokenExpired(expires, new Date("2026-08-26T10:00:00.000Z")),
      true
    );
  });

  it("rejects used or expired token rows", () => {
    const now = new Date("2026-08-26T09:30:00.000Z");
    assert.equal(isResetTokenRowValid(null, now), false);
    assert.equal(
      isResetTokenRowValid(
        { used_at: "2026-08-26T09:01:00.000Z", expires_at: "2026-08-26T10:00:00.000Z" },
        now
      ),
      false
    );
    assert.equal(
      isResetTokenRowValid(
        { used_at: null, expires_at: "2026-08-26T09:00:00.000Z" },
        now
      ),
      false
    );
    assert.equal(
      isResetTokenRowValid(
        { used_at: null, expires_at: "2026-08-26T10:00:00.000Z" },
        now
      ),
      true
    );
  });

  it("clears lockout when the password is reset", () => {
    assert.match(PASSWORD_RESET_USER_SQL, /failed_login_count = 0/);
    assert.match(PASSWORD_RESET_USER_SQL, /locked_until = NULL/);
    assert.match(PASSWORD_RESET_USER_SQL, /must_change_password = 0/);
  });
});
