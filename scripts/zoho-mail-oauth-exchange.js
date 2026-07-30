/**
 * Exchange a Zoho OAuth authorization code for ZOHO_MAIL_REFRESH_TOKEN.
 *
 * Usage:
 *   node scripts/zoho-mail-oauth-exchange.js "1000.xxxx"
 *   node scripts/zoho-mail-oauth-exchange.js --url "https://app.sulsolutions.biz/api?code=1000.xxxx&..."
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const REDIRECT_URI =
  process.env.ZOHO_MAIL_REDIRECT_URI || "https://app.sulsolutions.biz/api";
const AUTH_URL = process.env.ZOHO_AUTH_URL || "https://accounts.zoho.com/oauth/v2/token";
const MAIL_API = process.env.ZOHO_MAIL_API_BASE || "https://mail.zoho.com/api";
const ENV_PATH = path.join(__dirname, "..", ".env");

function extractCode(arg) {
  const raw = String(arg || "").trim();
  if (!raw) return null;
  try {
    if (raw.includes("code=")) {
      const u = new URL(raw);
      return u.searchParams.get("code");
    }
  } catch {
    /* not a URL */
  }
  const m = raw.match(/code=([^&\s]+)/);
  if (m) return decodeURIComponent(m[1]);
  return raw;
}

function upsertEnv(key, value) {
  let env = fs.readFileSync(ENV_PATH, "utf8");
  const line = `${key}=${value}`;
  const re = new RegExp(`^[ \\t]*#?[ \\t]*${key}=.*$`, "m");
  if (re.test(env)) {
    env = env.replace(re, line);
  } else {
    env = `${env.trimEnd()}\n${line}\n`;
  }
  fs.writeFileSync(ENV_PATH, env, "utf8");
}

async function main() {
  const args = process.argv.slice(2);
  const urlIdx = args.indexOf("--url");
  const input = urlIdx >= 0 ? args[urlIdx + 1] : args[0];
  const code = extractCode(input);
  if (!code) {
    console.error("Missing authorization code or redirect URL");
    process.exit(1);
  }
  if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET) {
    console.error("ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET required in .env");
    process.exit(1);
  }

  const { data } = await axios.post(AUTH_URL, null, {
    params: {
      grant_type: "authorization_code",
      client_id: process.env.ZOHO_CLIENT_ID,
      client_secret: process.env.ZOHO_CLIENT_SECRET,
      redirect_uri: REDIRECT_URI,
      code,
    },
    validateStatus: () => true,
    timeout: 20000,
  });

  if (!data.refresh_token) {
    console.error("Token exchange failed:", data);
    process.exit(1);
  }

  upsertEnv("ZOHO_MAIL_REFRESH_TOKEN", data.refresh_token);
  console.log("Saved ZOHO_MAIL_REFRESH_TOKEN");
  console.log("Scopes:", data.scope || "(none)");

  const accounts = await axios.get(`${MAIL_API}/accounts`, {
    headers: {
      Authorization: `Zoho-oauthtoken ${data.access_token}`,
      Accept: "application/json",
    },
    validateStatus: () => true,
    timeout: 20000,
  });

  const list = Array.isArray(accounts.data?.data) ? accounts.data.data : [];
  console.log("Mail accounts:", list.length);
  for (const a of list) {
    const froms = [];
    for (const d of a.sendMailDetails || []) {
      if (d?.fromAddress) froms.push(d.fromAddress);
    }
    console.log(
      "-",
      a.accountId,
      a.mailboxAddress || a.primaryEmailAddress || a.emailAddress || "",
      froms.length ? `from=[${froms.join(", ")}]` : ""
    );
    if (a.accountId) {
      upsertEnv("ZOHO_MAIL_ACCOUNT_ID", String(a.accountId));
      console.log("Saved ZOHO_MAIL_ACCOUNT_ID=", a.accountId);
    }
  }

  console.log("Done. Restart yarn dev to load the new token.");
}

main().catch((e) => {
  console.error(e.response?.data || e.message);
  process.exit(1);
});
