const DEFAULT_RECOVERY_EMAIL = "it@sulsolutions.biz";

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
      "If an account exists for that email, IT has been notified and will restore access.",
  };
}

function accountStatusLabel(user) {
  if (!user) return "No matching staff account";
  if (!user.is_active) return "Inactive";
  if (user.lockedUntil) return `Locked until ${user.lockedUntil}`;
  return "Active";
}

function buildAccountRecoveryEmail({
  requesterEmail,
  user,
  note,
  ip,
  userAgent,
  requestedAt,
  usersUrl,
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

  const resetHint = found
    ? `<p>Reset this account from <a href="${safe(usersUrl)}">${safe(usersUrl)}</a> (Settings → Users &amp; permissions).</p>`
    : "<p>No staff account matched this email. Confirm the address with the requester before creating or resetting a user.</p>";

  return {
    toAddress: recoveryInboxEmail(),
    subject: `SUL Bix account recovery request — ${email || "unknown"}`,
    content: `
      <p>A staff member requested account recovery from the SUL Bix login page. This includes administrator accounts.</p>
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
  buildAccountRecoveryEmail,
};
