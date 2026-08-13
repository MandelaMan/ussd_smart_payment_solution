const { describe, it } = require("node:test");
const { assert } = require("../helpers");
const {
  DEFAULT_MPESA_DEPOSIT_ACCOUNT_NAME,
  pickDepositAccountId,
  accountNameMatches,
  mpesaDepositLookupOptions,
  isMpesaPaymentChannel,
} = require("../../api/utils/zohoDepositAccount");

const mpesaAccount = {
  account_id: "acc-mpesa",
  account_name: "MPESA PAYBILL NO 4185091",
};
const paystackAccount = {
  account_id: "acc-paystack",
  account_name: "Paystack Funds",
};
const pettyCash = {
  account_id: "acc-cash",
  account_name: "Petty Cash",
};

describe("Zoho M-Pesa deposit account matching", () => {
  it("uses an explicit Zoho account_id when provided", () => {
    assert.equal(
      pickDepositAccountId([mpesaAccount, paystackAccount], {
        accountId: "  acc-configured  ",
        accountName: DEFAULT_MPESA_DEPOSIT_ACCOUNT_NAME,
      }),
      "acc-configured"
    );
  });

  it("matches MPESA PAYBILL NO 4185091 by exact name", () => {
    assert.equal(
      pickDepositAccountId([paystackAccount, pettyCash, mpesaAccount], {
        accountName: DEFAULT_MPESA_DEPOSIT_ACCOUNT_NAME,
        paybillNumber: "4185091",
      }),
      "acc-mpesa"
    );
  });

  it("matches a paybill number inside an M-Pesa / Paybill account name", () => {
    assert.equal(
      pickDepositAccountId(
        [
          paystackAccount,
          { account_id: "acc-alt", account_name: "M-Pesa Paybill 4185091" },
        ],
        { accountName: "Something Else", paybillNumber: "4185091" }
      ),
      "acc-alt"
    );
  });

  it("never selects Paystack Funds", () => {
    assert.equal(
      accountNameMatches(paystackAccount, {
        exactName: "Paystack Funds",
        paybillNumber: "4185091",
      }),
      false
    );
    assert.equal(
      pickDepositAccountId([paystackAccount, pettyCash], {
        accountName: DEFAULT_MPESA_DEPOSIT_ACCOUNT_NAME,
        paybillNumber: "4185091",
      }),
      null
    );
  });

  it("reads M-Pesa deposit env with paybill 4185091 as default", () => {
    const opts = mpesaDepositLookupOptions({
      ZOHO_MPESA_DEPOSIT_ACCOUNT_NAME: "",
      ZOHO_MPESA_ACCOUNT_ID: "",
      ZOHO_MPESA_PAYBILL: "",
    });
    assert.equal(opts.accountName, DEFAULT_MPESA_DEPOSIT_ACCOUNT_NAME);
    assert.equal(opts.paybillNumber, "4185091");
  });

  it("treats M-Pesa channel labels as deposit-to-paybill", () => {
    assert.equal(isMpesaPaymentChannel("M-Pesa"), true);
    assert.equal(isMpesaPaymentChannel("mpesa"), true);
    assert.equal(isMpesaPaymentChannel("Paystack"), false);
    assert.equal(isMpesaPaymentChannel("Direct Bank"), false);
  });
});
