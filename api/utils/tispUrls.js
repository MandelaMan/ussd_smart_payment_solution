require("dotenv").config();

const TISP_SERVICE_BASE =
  process.env.TISP_SERVICE_BASE ||
  "http://daraja.teqworthsystems.com/starlynxservice/WebISPService.svc";

/** TISP endpoints use plain HTTP — HTTPS fails TLS verification on their server. */
function normalizeTispUrl(url) {
  if (!url || typeof url !== "string") return url;
  return url.replace(/^https:\/\//i, "http://");
}

function resolveTispUrl(envValue, defaultPath) {
  const fallback = `${TISP_SERVICE_BASE.replace(/\/$/, "")}/${defaultPath}`;
  return normalizeTispUrl(envValue || fallback);
}

const ISP_PAYMENT_URL = resolveTispUrl(
  process.env.ISP_PAYMENT_URL,
  "SetISPPayment"
);
const TISP_SET_CLIENT_URL = resolveTispUrl(
  process.env.TISP_SET_CLIENT_URL,
  "SetClientDetails"
);
const TISP_CLIENT_STATUS_URL = resolveTispUrl(
  process.env.TISP_CLIENT_STATUS_URL,
  "ClientStatus"
);

module.exports = {
  normalizeTispUrl,
  ISP_PAYMENT_URL,
  TISP_SET_CLIENT_URL,
  TISP_CLIENT_STATUS_URL,
};
