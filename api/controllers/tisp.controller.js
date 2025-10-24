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

const getTISPCustomer = async (clientNo) => {
  if (!clientNo) {
    throw new Error("Client number is required.");
  }

  try {
    const data = await callTISP("POST", { client: clientNo });
    return JSON.parse(data);
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
