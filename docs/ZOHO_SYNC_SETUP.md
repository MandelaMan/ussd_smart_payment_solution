# Zoho Books Sync Setup Guide

This guide covers OAuth, webhooks, incremental sync, and rate-limit configuration for the Starlynx admin platform.

## Architecture summary

```
Zoho Books ──webhooks──► Node API ──► MySQL
                ▲              ▲
                │              │
         Background jobs   React dashboard
         (BullMQ + Redis)  (reads MySQL only)
```

The React app **never** calls Zoho directly. All dashboard and customer views read from MySQL snapshots updated by:

1. **Webhooks** (highest priority, zero/minimal API calls)
2. **Incremental scheduled sync** (`last_modified_time` per module, every 10 minutes by default)
3. **On-demand single-customer refresh** (manual button, respects cache + API reserve)

---

## 1. OAuth setup

### Required environment variables

```env
ZOHO_CLIENT_ID=
ZOHO_CLIENT_SECRET=
ZOHO_REFRESH_TOKEN=
ZOHO_ORG_ID=
ZOHO_BASE_URL=https://www.zoho.com/books/api/v3
ZOHO_AUTH_URL=https://accounts.zoho.com/oauth/v2/token
```

### Required OAuth scopes

Minimum scopes for sync + billing:

- `ZohoBooks.contacts.READ`
- `ZohoBooks.invoices.READ`
- `ZohoBooks.customerpayments.READ`
- `ZohoBooks.recurringinvoices.READ`
- `ZohoBooks.estimates.READ`
- `ZohoBooks.creditnotes.READ`

For write operations (invoice creation, mark paid):

- `ZohoBooks.invoices.CREATE`
- `ZohoBooks.invoices.UPDATE`
- `ZohoBooks.contacts.CREATE`

### Refresh token handling

Access tokens are cached in memory and refreshed automatically before expiry. On `401`, the client refreshes once and retries.

---

## 2. Webhooks

### Endpoint

```
POST https://<your-domain>/api/public/zoho/webhook
Header: x-zoho-webhook-secret: <ZOHO_WEBHOOK_SECRET>
```

### Zoho Books configuration

1. Go to **Settings → Automation → Workflow Rules** (or Zoho Flow / custom functions).
2. Create rules for events you care about:
   - Invoice created / updated / paid
   - Contact created / updated
   - Customer payment received
   - Estimate updated
   - Credit note updated
3. Action: **Webhook** → POST JSON payload to the endpoint above.
4. Include header `x-zoho-webhook-secret` matching `ZOHO_WEBHOOK_SECRET`.

### Supported events

| Event | Behavior |
|-------|----------|
| Invoice paid | Existing payment reconciliation + snapshot update |
| Invoice / contact / payment / estimate / credit note | Upsert into MySQL; fetch full record only if payload is incomplete |
| Unknown payload | Logged to `zoho_webhook_events`, returns 200 (does not crash) |

### Testing

```bash
curl -X POST https://localhost:4000/api/public/zoho/webhook \
  -H "Content-Type: application/json" \
  -H "x-zoho-webhook-secret: YOUR_SECRET" \
  -d '{"invoice":{"invoice_id":"123","status":"paid","total":1000}}'
```

Check `zoho_webhook_events` table for delivery status.

---

## 3. Incremental synchronization

### How it works

Each Zoho module sync uses **org-level list APIs** with `last_modified_time`:

| Module | Integration key | Schedule (default) |
|--------|-----------------|------------------|
| Contacts | `zoho-contacts` | 10 min |
| Invoices | `invoices` | 10 min |
| Recurring invoices | `zoho-recurring` | 10 min |
| Customer payments | `zoho-payments` | 10 min |
| Estimates | `zoho-estimates` | 10 min |
| Credit notes | `zoho-credit-notes` | 10 min |

State is stored in `integration_sync_state` with checkpoint in `sync_cursor.lastModifiedCheckpoint`.

**Important:** Sync does **not** loop per customer. With ~300 customers, a typical incremental run uses **1–5 API calls** instead of 600+.

### Run migration

```bash
yarn docker:up    # MariaDB + Redis if not running
yarn db:migrate   # applies all pending migrations including 020_zoho_incremental_sync
```

### Start workers

```bash
yarn worker        # production
yarn worker:dev    # development with nodemon
```

Requires Redis (`REDIS_HOST`, `REDIS_PORT`). Local default: Docker via `yarn docker:up` (see root [README](../README.md)).

---

## 4. API rate limits

### Configuration

```env
ZOHO_DAILY_API_LIMIT=10000
ZOHO_DAILY_API_RESERVE=1500
API_WARNING_THRESHOLD=7000
API_CRITICAL_THRESHOLD=8500
API_EMERGENCY_THRESHOLD=9500
```

- **Interactive** calls (manual refresh, manual sync) use the full daily limit.
- **Background** sync is capped at `dailyLimit - reserve`.
- When background budget is exhausted, jobs pause and resume on the next schedule.

Monitor usage at **Admin → Synchronization**.

---

## 5. On-demand customer refresh

- Customer profile loads from MySQL immediately.
- **Refresh from Zoho** fetches only that customer's contact + invoices + payments + recurring.
- If data was synced within `CUSTOMER_CACHE_DURATION_SECONDS` (default 300s), cached snapshot is returned without API calls.
- 30-second cooldown between manual refreshes per customer (`syncCooldown`).

---

## 6. Troubleshooting

| Issue | Check |
|-------|-------|
| Dashboard stale | Synchronization page → last sync times; Redis/worker running |
| High API usage | API usage panel; reduce `RECONCILIATION_FULL_ZOHO_INTERVAL_MS` |
| Webhook not updating DB | `zoho_webhook_events` status; secret header; payload shape |
| Records not linking | Customer `customer_number` must match Zoho `company_name` prefix (CL-, ET-, etc.) |

---

## 7. Module API reference

Zoho Books list endpoints support:

- `last_modified_time` — incremental filter
- `page` / `per_page` — pagination (max 200)
- `sort_column=last_modified_time` — ordered processing

Implementation: `api/services/zoho/zohoListApi.js`, `api/services/zoho/zohoIncrementalSync.service.js`
