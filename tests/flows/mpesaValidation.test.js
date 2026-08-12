const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const { mockRes } = require("../helpers/http");

// Isolate controller require from live env side effects where possible
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-secret-minimum-32-chars-long!!";

const { mpesaValidation } = require("../../api/controllers/mpesa.controller");

describe("process: M-Pesa C2B validation webhook", () => {
  function validate(body) {
    const { res, state } = mockRes();
    mpesaValidation({ body, headers: {} }, res);
    return state;
  }

  it("accepts multi-POP account refs with amount >= 1", () => {
    for (const ref of ["ET-401A", "AZE-TGA-401A", "CL-A10", "CLB-A10"]) {
      const state = validate({ BillRefNumber: ref, TransAmount: 100 });
      assert.equal(state.body.ResultCode, 0, ref);
    }
  });

  it("rejects archived cancel numbers, free text, and zero amount", () => {
    assert.equal(
      validate({ BillRefNumber: "ET-H302-CXL-12", TransAmount: 100 }).body
        .ResultCode,
      1
    );
    assert.equal(
      validate({ BillRefNumber: "Starlynx Utility", TransAmount: 100 }).body
        .ResultCode,
      1
    );
    assert.equal(
      validate({ BillRefNumber: "ET-401A", TransAmount: 0 }).body.ResultCode,
      1
    );
  });
});
