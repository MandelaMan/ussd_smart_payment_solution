# Customer Processes

Admin customer actions from the customers list menu (`CustomerActionMenu`), and how each one affects **local DB**, **TISP**, **Zoho Books**, and **OLT EMS**.

## System roles

| System | Role |
|--------|------|
| **Local DB** | Source of truth for customer identity, package, apartment, subscription status |
| **TISP** | ISP billing / access control (account number, package, due date, PPPoE/IP) |
| **Zoho Books** | Invoicing & recurring billing (C2B personal contact; B2B agency contact) |
| **OLT EMS** | Physical ONU activate/deactivate when a building OLT + ONU index are linked |

### Cross-cutting rules

- Menu service actions (upgrade → cancel) only appear when `customers.status === "active"`.
- `Suspended` / `Paused` keep `status=active` and change `subscription_status` only — those customers can still use the menu.
- **C2B** → personal Zoho contact + recurring. **B2B** → agency Zoho contact; personal Zoho sync is skipped.
- TISP does **not** rename `AccountNumber` on UPDATE. Number changes (apartment move, C2B↔B2B) **migrate**: release old account → INSERT new.
- There is no admin “Resume / Reconnect” menu item. Network restore after Suspended/Paused is payment-driven (`SetISPPayment` + OLT activate).
- Type changes must use **Convert to C2B/B2B**, not Edit.
- **Shops** are units under the same building and POP as apartments. Customer numbers still use the unit segment (`SH01`, `SH02`, …).
- New signups and apartment switches can create **installation** jobs (Installations module). Campaign first-month discounts apply at onboard only; decoder fees are never discounted.

---

## Process matrix

| Action | Local DB | TISP | Zoho | OLT |
|--------|----------|------|------|-----|
| Edit customer details | Update contact / IP / PPPoE; optional admin package correction; apartment move delegates to switch | Update (or migrate if number changed) | C2B: update contact (+ optional invoices/recurring flags). B2B: skip | No |
| Upgrade package | Immediate: product (+ frequency if changed). Pending: `pending_upgrades` only until paid | Immediate / on payment complete: UPDATE package | Top-up invoice (C2B/agency). C2B recurring refreshed on apply/complete. B2B personal skip | No |
| Downgrade package | Product (+ frequency if changed); cancels any pending upgrade | UPDATE package | Credit note when unused value &gt; 0; C2B recurring refresh | No |
| Update frequency | Swap to matching Mbps product + frequency + price | UPDATE | C2B recurring refresh. B2B skip | No |
| Move apartment | New apartment, customer number, IP/PPPoE, history rows | Migrate old → new account number | C2B: renumber contact/recurring. B2B skip | Clear ONU index/SN (building OLT link kept) |
| Convert C2B↔B2B | Type, agency, customer number, PPPoE if it tracked the number | Migrate old → new account number (preserve due date) | C2B→B2B: stop personal recurring, inactive contact, agency signup invoice + recurring. B2B→C2B: detach agency snapshot, refresh agency recurring without this house, create personal contact + recurring + new invoice | No |
| Pause service (away) | `subscription_status=Paused`, pause window + reason | Due date = today (stop access) | Defer matching recurring so next invoice is after pause end | Deactivate ONU |
| Suspend on TISP | `subscription_status=Suspended` | Due date = today | **None** (billing continues) | Deactivate ONU |
| Cancel subscription | `status=cancelled`, close apartment history, collection dates; archive number to `{number}-CXL-{id}` and clear IP/DSTV immediately | Due date = cancel day (async) | C2B: void overdue invoices, stop recurring, rename company to `{number}-CXL-{id}`, mark inactive. B2B: void that house's overdue invoices and stop agency recurring for this number only | Deactivate ONU (async) |
| New signup after cancel (same apt) | Cancelled row already archived; insert new active tenant on live number | UPDATE existing account (name/phone/package/due) | Retire leftover Zoho contact on live number; create **new** Zoho customer + signup invoice (former invoices ignored) | No |
| Apartment history | Read-only timeline | — | — | — |
| Wipe local records | Hard-delete local rows (**cancelled only**) | **Untouched** | **Untouched** | **Untouched** |

---

## 1. Edit customer details

**Purpose:** Correct contact, network, VAT/agency, or (admins) local package fields without a formal upgrade/downgrade.

**Outcomes**

- **Local:** Name, phone, email, VAT, agency (B2B), IP/PPPoE/DSTV updated. Changing apartment on an active customer runs the same DB path as Move apartment.
- **TISP:** Active customers are pushed (`preferUpdate`). Account-number change triggers migrate.
- **Zoho:** C2B contact ensured/updated; optional signup invoice / recurring / update-recurring flags from the form. B2B skipped (`b2b_agency_billing`).
- **OLT:** Not changed (use OLT link UI separately).

**Notes:** Customer type is locked on edit — use Convert. Admin package edits are DB-only unless Zoho recurring flags are set.

---

## 2. Upgrade package

**Purpose:** Move to a higher-priced package; collect prorated top-up when days remain on the current period.

**Outcomes**

- **Local:** Quote uses **current** billing frequency first. New frequency is applied only on immediate apply or when pending payment completes (stored on the quote). Pending path creates `pending_upgrades` + `upgrade_payment_status`.
- **TISP:** Package UPDATE when upgrade applies (immediate or after payment). Not updated while payment is pending.
- **Zoho:** Top-up invoice on C2B contact or B2B agency (reference = customer number). C2B recurring line items refreshed when the package actually applies. Pending cancel does **not** void the Zoho invoice (manual follow-up if needed).
- **OLT:** No change.

**Payment methods:** Zoho invoice or M-Pesa STK. Completion hooks: invoice paid / STK success → `completePendingUpgrade`.

---

## 3. Downgrade package

**Purpose:** Move to a lower-priced package; issue prorated Zoho credit when unused value remains.

**Outcomes**

- **Local:** Cancels any active pending upgrade, applies frequency (if requested), then product change.
- **TISP:** Package UPDATE.
- **Zoho:** Credit note when `creditAmount > 0` (soft-fail if Zoho errors — local package still changes). C2B recurring refresh.
- **OLT:** No change.

---

## 4. Update frequency

**Purpose:** Change monthly / quarterly / yearly / custom and switch to the matching Mbps product variant.

**Outcomes**

- **Local:** New `product_id`, `payment_frequency`, `package_price`. Blocked if a pending upgrade exists.
- **TISP:** UPDATE package / billing fields (TISP billing cycle remains Monthly).
- **Zoho:** C2B recurring refresh. B2B skip.
- **OLT:** No change.

**Notes:** No proration settlement (unlike upgrade/downgrade).

---

## 5. Move apartment

**Purpose:** Same building, new unit → new customer number (`{pop_c2b|b2b}[-{building_code}]-{apartment}`, e.g. `ET-401A` or `AZE-TGA-401A`).

**Outcomes**

- **Local:** Close/open `apartment_history`; update apartment, number, tisp password, IP/PPPoE.
- **TISP:** Migrate previous account number → new (release network on old, INSERT new, preserve due date).
- **Zoho:** C2B company name / recurring reference updated (`previousCustomerNumber`). B2B skip.
- **OLT:** ONU index/SN cleared so later pause/suspend cannot deactivate the old port. Relink ONU after the move.

---

## 6. Convert to C2B / B2B

**Purpose:** Flip billing type and renumber using the POP’s other code (`CL-A10` ↔ `CLB-A10`, or `AZE-TGA-401A` ↔ `AZEB-TGA-401A`).

**Outcomes**

- **Local:** `customer_type`, `agency_id` (required for B2B, cleared for C2B), `customer_number`; PPPoE username renumbered when it matched the old number.
- **TISP:** Migrate old → new account; due date from live TISP or local snapshot (never “today” for the new account).
- **Zoho:**
  - **C2B → B2B:** Stop personal recurring, mark personal contact inactive, clear the personal Zoho snapshot, then create a managed-house signup invoice on the agency contact and rebuild agency recurring.
  - **B2B → C2B:** Rebuild agency recurring without this house; clear the agency Zoho snapshot so agency invoices no longer appear on the customer; create (or reactivate) a personal C2B contact; create/update the personal recurring profile; create and send a new C2B invoice.
- **OLT:** No change.

**Recovery:** If local convert succeeds but TISP fails, Refresh Status migrates from the alternate type account number.

---

## 7. Pause service (away)

**Purpose:** Customer temporarily away — stop access now, keep account active, defer Zoho invoices that would fall in the pause window.

**Outcomes**

- **Local:** `subscription_status=Paused`, `pause_start_date` / `pause_end_date` / reason.
- **TISP:** Due date = today (same stop as suspend). Future `pauseStartDate` does not delay the TISP stop.
- **Zoho:** Matching recurring profiles deferred (`start_date` / next invoice pushed to pause end) on C2B contact or B2B agency by customer-number reference.
- **OLT:** ONU deactivated when linked.

**Notes:** No automated resume job at `pause_end_date`. Payment while paused can reactivate OLT via the payment handler. Use Suspend when the intent is non-payment enforcement without Zoho deferral.

---

## 8. Suspend on TISP

**Purpose:** Force-stop network access (typically non-payment) without changing Zoho billing.

**Outcomes**

- **Local:** `subscription_status=Suspended` (`status` stays `active`).
- **TISP:** Due date = today.
- **Zoho:** Untouched — invoices/recurring continue.
- **OLT:** ONU deactivated when linked.

**Notes:** UI copy matches behaviour (TISP + OLT only). Reconnect is payment-driven.

---

## 9. Cancel subscription

**Purpose:** End the subscription permanently in-app while retaining history; collect ONU / DSTV decoder dates; free the apartment for a new tenant.

**Outcomes**

- **Local:** `status=cancelled`, `subscription_status=Cancelled`, reason + collection dates; open apartment history closed. Customer number archived to `{number}-CXL-{id}` and IP / PPPoE / DSTV serial cleared **immediately** so UNIQUE keys are free for reuse.
- **TISP:** Background sync sets due date to cancellation day (uses the live apartment number, not the archived local value).
- **Zoho:** Background — void overdue invoices (positive balance, past due / Zoho overdue; drafts already excluded). C2B then stop recurring, rename `company_name` to `{number}-CXL-{id}` (same archive form as local), mark contact inactive. B2B void only this house's overdue invoices on the agency contact, then stop only recurring rows matching this customer number (agency stays active). Partially paid invoices may fail to void in Zoho; those are logged and left for follow-up.
- **OLT:** Background deactivate ONU when linked.

**Notes:** Response returns `tisp/zoho: pending` immediately; check activity log for integration results. Prefer Cancel over Wipe for leavers. The apartment number is free for a new active tenant immediately. Menu label: **Cancel & release apartment**.

### 9a. New tenant on same apartment (after cancel)

**Purpose:** Put a new person on the same unit (e.g. H302) without inheriting the previous tenant’s Zoho invoices or contact.

**Outcomes**

- **Local:** Previous cancelled holder is already `{number}-CXL-{id}`; new active customer gets the live number.
- **TISP:** Prefer **UPDATE** of the existing account (new name, phone, package, due date policy) — not a duplicate INSERT.
- **Zoho:** Do **not** reactivate the former contact. If a contact still owns the live company name (legacy cancel that only marked inactive), it is retired (`{number}-CXL-{id}` + inactive). A **new** Zoho customer is created for the new tenant; signup invoice is created and emailed; invoices dated before the new customer’s `created_at` are ignored.
- **OLT:** Unchanged unless separately linked.

**Notes:** Use Cancel → Create. If a prior signup wrongly linked the old Zoho contact, use **Retry billing onboarding** — it retires the former contact, creates a fresh one, and emails a new signup invoice.

---

## 10. Apartment history

**Purpose:** Read-only occupancy timeline for the unit.

**Outcomes:** Local read of `apartment_history` (+ customer/product join). No TISP / Zoho / OLT calls.

---

## 11. Wipe local records (formerly Delete permanently)

**Purpose:** Admin-only hard wipe of local customer data (snapshots, events, history, pending upgrades, customer row). Available only for **cancelled** customers.

**Outcomes**

- **Local:** Row deleted.
- **TISP / Zoho / OLT:** Explicitly **not** cleaned up — live orphans may remain (cancel should already have stopped them).

**Notes:** Operationally dangerous. Menu shows **Wipe local records** only after Cancel. API rejects wipe while still `active`. Use Cancel for normal offboarding.

---

## Payment-driven reconnect (not a menu action)

When M-Pesa / Zoho payment is allocated for a customer whose subscription is Suspended or Paused:

- **TISP:** `SetISPPayment` / due-date restore per payment handler.
- **OLT:** ONU activate when mapping exists.
- **Local:** Subscription can return to Active depending on payment handler rules.

---

## Related docs

- [Sync architecture](./SYNC_ARCHITECTURE.md) — background workers, Redis, Zoho API budget
- [Zoho sync setup](./ZOHO_SYNC_SETUP.md) — webhooks, incremental sync

## Automated tests

Process-flow decision rules are covered by `yarn test` (`tests/unit`, `tests/flows`):

| Area | Coverage |
|------|----------|
| Customer numbering / cancel archive / C2B↔B2B | `tests/unit/customerNumber.test.js`, `tests/flows/customerProcesses.test.js` |
| Upgrade / downgrade quotes | `tests/unit/upgradeDowngradeFlow.test.js` |
| M-Pesa matching + payment plan + C2B validation | `tests/unit/mpesaPaymentFlow.test.js`, `tests/flows/mpesaValidation.test.js` |
| Billing periods + B2B agency rules | `tests/unit/billingB2bFlow.test.js` |
| Reconciliation scenarios | `tests/unit/reconciliationFlow.test.js` |
| Auth / RBAC / Zoho sync gates | `tests/unit/authRbacPolicy.test.js` |

Live integration checks (staging only): `yarn test:smoke`, `yarn paybill:simulate`, `yarn test:olt`.
