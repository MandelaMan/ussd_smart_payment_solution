const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  CANONICAL_ADMIN_EMAIL,
  CANONICAL_ADMIN_NAME,
  resolveAdminEmail,
  resolveAdminName,
  nextAdminName,
} = require("../../api/utils/canonicalAdminAccount");

describe("canonical admin account", () => {
  it("defaults the administrator login to it@sulsolutions.biz", () => {
    assert.equal(CANONICAL_ADMIN_EMAIL, "it@sulsolutions.biz");
    assert.equal(resolveAdminEmail(""), CANONICAL_ADMIN_EMAIL);
    assert.equal(resolveAdminEmail(undefined), CANONICAL_ADMIN_EMAIL);
  });

  it("rewrites the legacy admin@ address even when ADMIN_EMAIL still says admin", () => {
    assert.equal(
      resolveAdminEmail("admin@sulsolutions.biz"),
      CANONICAL_ADMIN_EMAIL
    );
    assert.equal(
      resolveAdminEmail("  Admin@sulsolutions.biz  "),
      CANONICAL_ADMIN_EMAIL
    );
  });

  it("keeps an explicit non-legacy ADMIN_EMAIL", () => {
    assert.equal(
      resolveAdminEmail("ops@sulsolutions.biz"),
      "ops@sulsolutions.biz"
    );
  });

  it("defaults the administrator name to IT and replaces generic Admin labels", () => {
    assert.equal(CANONICAL_ADMIN_NAME, "IT");
    assert.equal(resolveAdminName(""), CANONICAL_ADMIN_NAME);
    assert.equal(resolveAdminName("Admin"), CANONICAL_ADMIN_NAME);
    assert.equal(resolveAdminName("Administrator"), CANONICAL_ADMIN_NAME);
    assert.equal(nextAdminName("Admin"), "IT");
    assert.equal(nextAdminName("Nelson"), "Nelson");
  });
});
