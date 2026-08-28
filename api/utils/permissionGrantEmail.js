/**
 * Staff permission-grant email helpers.
 * Only newly granted access is described — revocations are never included.
 */
const { getPermission } = require("../rbac/permissionCatalog");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function adminLoginUrl() {
  const origin = String(process.env.ADMIN_ORIGIN || "").replace(/\/$/, "");
  return origin ? `${origin}/admin/login` : "/admin/login";
}

/**
 * Keys present in `nextKeys` but not in `previousKeys`.
 * Removals are ignored so callers never email revoked rights.
 */
function diffGrantedPermissionKeys(previousKeys, nextKeys) {
  const prev = new Set(Array.isArray(previousKeys) ? previousKeys : []);
  const next = Array.isArray(nextKeys) ? nextKeys : [];
  return [...new Set(next.filter((key) => key && !prev.has(key)))].sort();
}

function groupGrantedPermissions(keys) {
  /** @type {Map<string, { key: string, label: string, description: string }[]>} */
  const byModule = new Map();
  for (const key of keys || []) {
    const perm = getPermission(key);
    const moduleLabel = perm?.moduleLabel || String(key).split(".")[0] || "Access";
    const label = perm?.label || key;
    const description = perm?.description || label;
    if (!byModule.has(moduleLabel)) byModule.set(moduleLabel, []);
    byModule.get(moduleLabel).push({ key, label, description });
  }
  return [...byModule.entries()].map(([moduleLabel, items]) => ({
    moduleLabel,
    items,
  }));
}

function buildPermissionGrantEmail({
  name,
  email,
  grantedKeys = [],
  becameAdministrator = false,
}) {
  const safeName = escapeHtml(name || "there");
  const loginUrl = escapeHtml(adminLoginUrl());
  const grouped = groupGrantedPermissions(grantedKeys);

  let capabilityBlock;
  if (becameAdministrator) {
    capabilityBlock = `
      <p>You now have <strong>Administrator</strong> access. You can use every module in SUL Bix.</p>
    `;
  } else {
    const sections = grouped
      .map((group) => {
        const items = group.items
          .map(
            (item) =>
              `<li>${escapeHtml(item.description || item.label)}</li>`
          )
          .join("");
        return `<p style="margin:16px 0 6px;font-weight:600;color:#0f172a;">${escapeHtml(
          group.moduleLabel
        )}</p><ul style="margin:0;padding-left:20px;">${items}</ul>`;
      })
      .join("");
    capabilityBlock = `
      <p>You can now:</p>
      ${sections}
    `;
  }

  return {
    toAddress: String(email || "").trim().toLowerCase(),
    subject: becameAdministrator
      ? "You now have administrator access in SUL Bix"
      : "New access granted in SUL Bix",
    content: `
      <p>Hello ${safeName},</p>
      <p>An administrator granted you additional access in SUL Bix.</p>
      ${capabilityBlock}
      <p>Sign in at <a href="${loginUrl}">${loginUrl}</a> to use these capabilities. Refresh the app (or sign in again) if you are already signed in.</p>
      <p>If you did not expect this change, contact your administrator.</p>
    `,
  };
}

function shouldSendPermissionGrantEmail({
  user,
  grantedKeys,
  becameAdministrator = false,
}) {
  if (!user?.id || !user.is_active) return false;
  const email = String(user.email || "").trim();
  if (!email.includes("@")) return false;
  if (becameAdministrator) return true;
  return Array.isArray(grantedKeys) && grantedKeys.length > 0;
}

function becameAdministrator(previousRole, nextRole) {
  return previousRole !== "admin" && nextRole === "admin";
}

module.exports = {
  diffGrantedPermissionKeys,
  groupGrantedPermissions,
  buildPermissionGrantEmail,
  shouldSendPermissionGrantEmail,
  becameAdministrator,
};
