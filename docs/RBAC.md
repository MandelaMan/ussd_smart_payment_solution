# Roles, Groups & Permissions

This application uses a permission-driven RBAC model (product **1.11.0+**).

Day-to-day management: admin **Settings → Users & permissions**. Full setup context: [Setup & migration guide](./SETUP_AND_MIGRATION_GUIDE.html#rbac).

## System roles

Only two system roles exist:

| Role | Meaning |
|------|---------|
| **Administrator** | Full access to every module automatically. Groups and individual overrides do not limit access. |
| **User** | Authenticated only (`dashboard.view`). All other access comes from groups and overrides. |

Roles set the baseline only. Day-to-day access is controlled by **permissions**. Do not put operational keys on the User role — groups can only add access, they cannot take User defaults away.

## Permission keys

Permissions use `module.action` keys, for example:

- `customers.view`
- `customers.export`
- `billing.refund`
- `users.manage_permissions`

The catalog lives in `api/rbac/permissionCatalog.js`. Adding a new module permission there makes it available in the UI and API after the next app boot (catalog sync).

## Inheritance order

1. **System role defaults** (Administrator = all modules; User = `dashboard.view` only)
2. **User group permissions** (union across all groups; ignored for Administrators)
3. **Individual overrides** (grant or deny) — apply to Users only; Administrators ignore overrides

Prefer one primary group per person. Stacking groups always expands access.

## User groups

Preset groups ship with recommended permission sets:

| Group | Typical job | Notes |
|-------|-------------|--------|
| Sales | Acquisition | Customers + leads; no financials |
| Finance | CFO / accounts | Billing ops; **no refund**, no Settings |
| Billing | Collections | Allocate / communicate; no refund, no sync |
| Support | Help desk | Pause and OLT; **no cancel, disconnect, or agencies** |
| Technician | Field tech | View customers; update installation jobs |
| Installations | Onboarding coordinators | Jobs + occupancy; **no building/POP create** |
| Network Operations | NOC | Disconnect, pause, equipment edit |
| Management | PM / exec | Read-heavy finance and reports |
| Customer Relations | Partner | Customer list + reports; **no financials** |

Dangerous actions (`customers.cancel`, `billing.refund`, `customers.delete`) are not in any preset. Grant them individually or use the Administrator role.

Assign one or more groups when creating or editing a user. Group permissions merge (union).

When `GROUP_PRESETS` in the catalog are intentionally narrowed, bump `SYSTEM_GROUP_PRESET_REVISION` so existing databases replace system-group grants on next boot. Custom (non-system) groups are not overwritten.

## Managing access (administrators)

1. Open **Settings → Users & permissions**
2. **Create user** with full name, job title, email, role, groups, status, optional notes
3. A strong temporary password is generated (e.g. `hJ8}N6V9j`) — copy it or email it to the user
4. The user must set a full password on first login
5. Use **Permissions** on a user to grant or deny individual actions without changing their role
6. Use the **Groups** tab to edit preset group permission bundles — saves persist across restarts

After changing a group's permissions, affected users should refresh the admin app (or re-login) so their session picks up the new `/auth/me` permission list. API checks update immediately after save.

## Performance (permission checks on list APIs)

List tables used to feel slow because every admin request re-resolved permissions via Redis/DB, and login warmed buildings/packages/POPs lookups even for users who could not access them (competing 403s).

Current design (keep these):

| Layer | Behavior |
|-------|----------|
| `attachPermissions` | Runs once after `authenticate` on admin/sync routers; sets `req.userPermissionSet` |
| `requirePermission` | Reads the request-scoped set (no second Redis round-trip) |
| In-process map | `memoryPermCache` in `permissionService.js` (~60s TTL) skips Redis on hot paths |
| Redis | Still used as shared cache; fails open to memory/DB if Redis is slow |
| `warmSharedLookups` | Only runs when `canAccessConfig(user)` is true |

Do **not** re-seed system group permissions on every boot — that wiped admin group edits. Boot sync only seeds **new** or empty groups. Narrowing presets is applied once per `SYSTEM_GROUP_PRESET_REVISION` bump.

## Migration from legacy roles

Legacy roles (`support`, `cfo`, `ceo`, `partner`) are remapped to:

| Legacy | New role | Group |
|--------|----------|-------|
| support | User | Support |
| cfo | User | Finance |
| ceo | User | Management |
| partner | User | Customer Relations |
| admin | Administrator | — |

Original values are kept in `admin_users.legacy_role` for audit.

## API enforcement

Every sensitive admin route uses `requirePermission(...)`. Frontend hiding is not sufficient — the API always validates.

Permission results are cached (in-process → Redis → DB) and invalidated when users, groups, or overrides change.

## Audit

Permission and membership changes are written to `rbac_permission_audit` with actor, previous/new state, timestamp, and IP when available.

## Security notes

- Never rely on UI visibility alone
- Prefer deny for destructive actions (`customers.delete`, `billing.reverse`, etc.)
- Administrators cannot be deactivated
- Password resets invalidate all sessions via `token_version`
- Temporary passwords force `must_change_password` until a strong password is set
- System group **permission lists** are replaced only when `SYSTEM_GROUP_PRESET_REVISION` is bumped; day-to-day boot sync must not overwrite them
