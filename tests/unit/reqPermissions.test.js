const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const { hasReqPermission } = require("../../api/middleware/permissions");

describe("hasReqPermission", () => {
  it("grants every key to administrators", () => {
    assert.equal(
      hasReqPermission({ user: { role: "admin" } }, "customers.package_edit"),
      true
    );
  });

  it("honors a granted permission on the request set", () => {
    const req = {
      user: { role: "user" },
      userPermissionSet: new Set(["customers.view", "customers.edit"]),
    };
    assert.equal(hasReqPermission(req, "customers.edit"), true);
    assert.equal(hasReqPermission(req, "customers.package_edit"), false);
  });

  it("lets package_edit work without the administrator role", () => {
    const req = {
      user: { role: "user" },
      userPermissionSet: new Set(["customers.edit", "customers.package_edit"]),
    };
    assert.equal(hasReqPermission(req, "customers.package_edit"), true);
  });

  it("denies when unauthenticated or the key is missing", () => {
    assert.equal(hasReqPermission({}, "customers.edit"), false);
    assert.equal(
      hasReqPermission({ user: { role: "user" }, userPermissionSet: new Set() }, "customers.edit"),
      false
    );
  });
});
