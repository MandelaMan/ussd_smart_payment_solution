const DEFAULT_RECOVERY_EMAIL = "it@sulsolutions.biz";
const { TOKEN_TTL_MINUTES } = require("./passwordResetToken");

function recoveryInboxEmail() {
  const fromEnv = String(process.env.ACCOUNT_RECOVERY_EMAIL || "")
    .trim()
    .toLowerCase();
  return fromEnv.includes("@") ? fromEnv : DEFAULT_RECOVERY_EMAIL;
}

function genericRecoveryResponse() {
  return {
    ok: true,
    message:
      "If an account exists for that email, we sent a password reset link.",
  };
}

function accountStatusLabel(user) {
  if (!user) return "No matching staff account";
  if (!user.is_active) return "Inactive";
  if (user.lockedUntil) return `Locked until ${user.lockedUntil}`;
  return "Active";
}

function shouldSendPasswordResetEmail(user) {
  return Boolean(user?.id && user.is_active);
}

function adminResetPasswordUrl(token) {
  const origin = String(process.env.ADMIN_ORIGIN || "").replace(/\/$/, "");
  const path = `/admin/reset-password?token=${encodeURIComponent(String(token || ""))}`;
  return origin ? `${origin}${path}` : path;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPasswordResetEmail({ name, email, resetUrl, expiresMinutes = TOKEN_TTL_MINUTES }) {
  const safeName = escapeHtml(name || "there");
  const safeUrl = escapeHtml(resetUrl);
  const minutes = Number(expiresMinutes) || TOKEN_TTL_MINUTES;
  return {
    toAddress: String(email || "").trim().toLowerCase(),
    subject: "Reset your SUL Bix password",
    content: `
      <p>Hello ${safeName},</p>
      <p>We received a request to reset the password for your SUL Bix staff account.</p>
      <p><a href="${safeUrl}">Reset your password</a></p>
      <p>This link expires in ${minutes} minutes and can be used only once. If you did not request a reset, you can ignore this email.</p>
    `,
  };
}

function buildAccountRecoveryEmail({
  requesterEmail,
  user,
  note,
  ip,
  userAgent,
  requestedAt,
  usersUrl,
  staffLinkSent = false,
}) {
  const email = String(requesterEmail || "").trim().toLowerCase();
  const found = Boolean(user);
  const safe = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const rows = [
    ["Requested email", email || "—"],
    ["Account found", found ? "Yes" : "No"],
    ["Name", user?.name || "—"],
    ["Role", user?.role || "—"],
    ["Job title", user?.jobTitle || "—"],
    ["Status", accountStatusLabel(user)],
    ["Must change password", user?.mustChangePassword ? "Yes" : found ? "No" : "—"],
    ["Reset link emailed to staff", staffLinkSent ? "Yes" : "No"],
    ["Requester note", note || "—"],
    ["Submitted at", requestedAt || new Date().toISOString()],
    ["IP address", ip || "—"],
    ["User agent", userAgent || "—"],
  ];

  const tableRows = rows
    .map(
      ([label, value]) =>
        `<tr>
          <td style="padding:6px 12px 6px 0;vertical-align:top;color:#475569;white-space:nowrap;">${safe(label)}</td>
          <td style="padding:6px 0;vertical-align:top;font-weight:600;color:#0f172a;">${safe(value)}</td>
        </tr>`
    )
    .join("");

  let resetHint;
  if (staffLinkSent) {
    resetHint =
      "<p>A reset link was emailed to the staff member. Review this request if it looks unexpected.</p>";
  } else if (found) {
    resetHint = `<p>No reset link was sent to the staff member. Reset this account from <a href="${safe(usersUrl)}">${safe(usersUrl)}</a> (Settings → Users &amp; permissions), or send a reset link from that page.</p>`;
  } else {
    resetHint =
      "<p>No staff account matched this email. Confirm the address with the requester before creating or resetting a user.</p>";
  }

  return {
    toAddress: recoveryInboxEmail(),
    subject: `SUL Bix password reset requested — ${email || "unknown"}`,
    content: `
      <p>Super Admin notice: someone requested a password reset from the SUL Bix login page. This includes administrator accounts.</p>
      <table style="border-collapse:collapse;font-family:system-ui,sans-serif;font-size:14px;">${tableRows}</table>
      ${resetHint}
    `,
  };
}

module.exports = {
  DEFAULT_RECOVERY_EMAIL,
  recoveryInboxEmail,
  genericRecoveryResponse,
  accountStatusLabel,
  shouldSendPasswordResetEmail,
  adminResetPasswordUrl,
  buildPasswordResetEmail,
  buildAccountRecoveryEmail,
};
