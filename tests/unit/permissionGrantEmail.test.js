const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  diffGrantedPermissionKeys,
  groupGrantedPermissions,
  buildPermissionGrantEmail,
  shouldSendPermissionGrantEmail,
  becameAdministrator,
} = require("../../api/utils/permissionGrantEmail");

describe("permission grant email", () => {
  it("returns only newly granted keys and ignores revocations", () => {
    assert.deepEqual(
      diffGrantedPermissionKeys(
        ["customers.view", "billing.view", "leads.edit"],
        ["customers.view", "billing.allocate", "leads.edit"]
      ),
      ["billing.allocate"]
    );
    assert.deepEqual(
      diffGrantedPermissionKeys(
        ["customers.view", "billing.view"],
        ["customers.view"]
      ),
      []
    );
    assert.deepEqual(diffGrantedPermissionKeys(["a"], ["a", "b", "b"]), ["b"]);
    assert.deepEqual(diffGrantedPermissionKeys(undefined, ["customers.view"]), [
      "customers.view",
    ]);
  });

  it("groups granted keys by module with human-readable descriptions", () => {
    const grouped = groupGrantedPermissions([
      "customers.export",
      "billing.allocate",
    ]);
    const customers = grouped.find((g) => g.moduleLabel === "Customers");
    const billing = grouped.find((g) => g.moduleLabel === "Billing & Reconciliation");
    assert.ok(customers);
    assert.ok(billing);
    assert.match(customers.items[0].description, /export/i);
    assert.match(billing.items[0].description, /allocate/i);
  });

  it("builds an email listing what the user can now do, not what was removed", () => {
    const mail = buildPermissionGrantEmail({
      name: "Ada",
      email: "ada@sulsolutions.biz",
      grantedKeys: ["customers.export", "billing.allocate"],
    });
    assert.equal(mail.toAddress, "ada@sulsolutions.biz");
    assert.match(mail.subject, /new access granted/i);
    assert.match(mail.content, /You can now/);
    assert.match(mail.content, /Customers/);
    assert.match(mail.content, /Export customer data/);
    assert.match(mail.content, /Allocate unmatched M-Pesa payments/);
    assert.equal(mail.content.toLowerCase().includes("revok"), false);
    assert.equal(mail.content.includes("customers.view"), false);
  });

  it("summarizes administrator promotion instead of listing every permission", () => {
    const mail = buildPermissionGrantEmail({
      name: "Ada",
      email: "ada@sulsolutions.biz",
      grantedKeys: ["customers.view", "billing.refund"],
      becameAdministrator: true,
    });
    assert.match(mail.subject, /administrator access/i);
    assert.match(mail.content, /every module/i);
    assert.equal(mail.content.includes("You can now:"), false);
  });

  it("escapes user-controlled name in the email body", () => {
    const mail = buildPermissionGrantEmail({
      name: "<script>alert(1)</script>",
      email: "ada@sulsolutions.biz",
      grantedKeys: ["customers.view"],
    });
    assert.equal(mail.content.includes("<script>"), false);
    assert.match(mail.content, /&lt;script&gt;/);
  });

  it("does not send when rights were only revoked, the account is inactive, or email is missing", () => {
    const active = {
      id: 1,
      email: "ada@sulsolutions.biz",
      is_active: 1,
    };
    assert.equal(
      shouldSendPermissionGrantEmail({ user: active, grantedKeys: [] }),
      false
    );
    assert.equal(
      shouldSendPermissionGrantEmail({
        user: { ...active, is_active: 0 },
        grantedKeys: ["customers.export"],
      }),
      false
    );
    assert.equal(
      shouldSendPermissionGrantEmail({
        user: { ...active, email: "" },
        grantedKeys: ["customers.export"],
      }),
      false
    );
    assert.equal(
      shouldSendPermissionGrantEmail({
        user: active,
        grantedKeys: ["customers.export"],
      }),
      true
    );
  });

  it("detects administrator promotion only, not demotion", () => {
    assert.equal(becameAdministrator("user", "admin"), true);
    assert.equal(becameAdministrator("admin", "user"), false);
    assert.equal(becameAdministrator("admin", "admin"), false);
    assert.equal(becameAdministrator("user", "user"), false);
  });
});
