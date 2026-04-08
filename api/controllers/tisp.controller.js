const axios = require("axios");
const moment = require("moment");
require("dotenv").config();

async function callTISP(method = "POST", data = null, params = {}) {
  try {
    const config = {
      method,
      url: process.env.TISP_CLIENT_STATUS_URL,
      headers: {
        "Content-Type": "application/json",
      },
      params,
    };

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    return response.data;
  } catch (error) {
    console.error("TISP call failed:", error.message);
    throw error;
  }
}

function parseTispResponseBody(data) {
  if (data == null) return null;
  if (typeof data === "object" && !Array.isArray(data)) return { ...data };
  if (typeof data === "string") {
    const trimmed = data.trim();
    if (!trimmed) return null;
    return JSON.parse(trimmed);
  }
  return null;
}

/**
 * Map TISP JSON keys to the shape USSD / callers expect (sample ET-F502 uses duedate, package, amount, status).
 */
function normalizeTispClientPayload(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return parsed;
  }
  const dueDate =
    parsed.dueDate ??
    parsed.duedate ??
    parsed.DueDate ??
    parsed.DUE_DATE ??
    parsed.expiryDate ??
    parsed.ExpiryDate;

  return {
    ...parsed,
    dueDate: dueDate ?? parsed.dueDate,
    status: parsed.status ?? parsed.Status ?? parsed.STATUS,
    package: parsed.package ?? parsed.Package ?? parsed.PACKAGE,
    amount:
      parsed.amount ?? parsed.Amount ?? parsed.AMOUNT ?? parsed.monthlyAmount,
  };
}

const getTISPCustomer = async (clientNo) => {
  const client = String(clientNo ?? "").trim().toUpperCase();
  if (!client) {
    throw new Error("Client number is required.");
  }

  try {
    const data = await callTISP("POST", { client });
    const parsed = parseTispResponseBody(data);
    return normalizeTispClientPayload(parsed);
  } catch (error) {
    console.error("Failed to get TISP customer:", error.message);
    throw error;
  }
};

const test = async (req, res) => {
  const { customer_no } = req.body;

  const result = await getTISPCustomer(customer_no);

  res.json(result);
};

module.exports = {
  getTISPCustomer,
  test,
};
