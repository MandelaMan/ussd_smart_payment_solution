const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  DEFAULT_RECOVERY_EMAIL,
  recoveryInboxEmail,
  genericRecoveryResponse,
  accountStatusLabel,
  buildAccountRecoveryEmail,
} = require("../../api/utils/accountRecovery");
const {
  ADMIN_AUDIT_EXTRA_EVENT_TYPES,
} = require("../../api/lib/customerActivityEvents");

describe("account recovery", () => {
  it("emails IT by default, including administrator recoveries", () => {
    assert.equal(DEFAULT_RECOVERY_EMAIL, "it@sulsolutions.biz");
    assert.equal(recoveryInboxEmail(), "it@sulsolutions.biz");

    const mail = buildAccountRecoveryEmail({
      requesterEmail: "admin@sulsolutions.biz",
      user: {
        name: "Admin",
        email: "admin@sulsolutions.biz",
        role: "admin",
        jobTitle: "Administrator",
        is_active: true,
        lockedUntil: null,
        mustChangePassword: false,
      },
      note: "Forgot password",
      ip: "127.0.0.1",
      userAgent: "Mozilla",
      requestedAt: "2026-08-18T10:00:00.000Z",
      usersUrl: "http://localhost:5173/settings",
    });

    assert.equal(mail.toAddress, "it@sulsolutions.biz");
    assert.match(mail.subject, /admin@sulsolutions.biz/);
    assert.match(mail.content, /administrator accounts/i);
    assert.match(mail.content, />admin</);
    assert.match(mail.content, /Forgot password/);
    assert.match(mail.content, /Users &amp; permissions/);
  });

  it("does not reveal whether an account exists in the public response", () => {
    const res = genericRecoveryResponse();
    assert.equal(res.ok, true);
    assert.match(res.message, /If an account exists/i);
    assert.equal(res.message.includes("not found"), false);
  });

  it("labels locked and inactive staff accounts for IT", () => {
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

  it("escapes requester-supplied HTML in the IT email", () => {
    const mail = buildAccountRecoveryEmail({
      requesterEmail: "user@sulsolutions.biz",
      user: { name: "<script>", role: "user", is_active: true },
      note: "<img src=x onerror=alert(1)>",
      usersUrl: "http://localhost:5173/settings",
    });
    assert.equal(mail.content.includes("<script>"), false);
    assert.match(mail.content, /&lt;script&gt;/);
    assert.match(mail.content, /&lt;img src=x/);
  });

  it("records recovery requests on the admin activity audit trail", () => {
    assert.ok(ADMIN_AUDIT_EXTRA_EVENT_TYPES.includes("user_recovery_requested"));
  });
});
