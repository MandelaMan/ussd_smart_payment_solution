# Background Synchronization Architecture

This document describes the event-driven background sync system introduced to eliminate blocking third-party API calls during dashboard page loads.

## Overview

```
React Dashboard
       │
REST API / WebSocket (Socket.IO)
       │
Node.js API (index.js)
       │
───────────────
│             │
MySQL      Redis
│             │
──────┬────────
      │
 BullMQ Queues
      │
───────────────
│      │      │
Worker Worker Worker  (workers/index.js)
│      │      │
TISP  Zoho  M-Pesa
```

## Assumptions

1. **TISP** does not support `updated_after` filtering — customer sync uses paginated full scans with optional `customers.updated_at` filter for incremental mode.
2. **Zoho Books** uses org-level incremental sync (`last_modified_time`) via `api/services/zoho/zohoIncrementalSync.service.js` — not per-customer API loops. See [ZOHO_SYNC_SETUP.md](./ZOHO_SYNC_SETUP.md).
3. **Billing reconciliation** (`reconciliationStore.doRunSync`) remains the authoritative full sync; it is executed by the `reconciliation` worker.
4. **M-Pesa payments** are already stored locally; the `payments` worker refreshes unmatched-payment cache without external API calls.
5. **Products/packages** are local MySQL data; the `products` worker refreshes the catalog cache.

## Queues

| Integration      | Queue name             | Default schedule | External system |
|-----------------|------------------------|------------------|-----------------|
| `customers`     | `customer-sync`        | 15 min           | TISP ISP        |
| `invoices`      | `invoice-sync`         | 30 min (incremental) | Zoho Books  |
| `payments`      | `payment-sync`         | 2 min            | MySQL (local)   |
| `reconciliation`| `reconciliation-sync`  | 15 min quick / 6 hr full Zoho | Zoho + TISP |
| `products`      | `products-sync`        | 1 hour           | MySQL (local)   |

Each queue has a dead-letter queue (`*-dlq`) for jobs that exhaust retries.

## Zoho API daily budget (10,000 calls/day)

Zoho Books limits organizations to **10,000 API calls per day**. The system enforces this via:

- **Redis counter** (`zoho:api:count:YYYY-MM-DD`) incremented on every Zoho Books HTTP request
- **Reserve pool** (`ZOHO_DAILY_API_RESERVE`, default 1,500) kept for user actions (allocate payment, customer refresh, manual sync)
- **Background sync** may only use `ZOHO_DAILY_API_LIMIT - ZOHO_DAILY_API_RESERVE` calls
- **Invoice worker** pauses mid-run and saves cursor when budget is low
- **Scheduled full reconciliation** downgrades to quick sync (no Zoho) if estimated calls exceed remaining budget
- **Manual sync** uses the interactive pool (can consume the reserve)

Configure in `.env`:

```env
ZOHO_DAILY_API_LIMIT=10000
ZOHO_DAILY_API_RESERVE=1500
ZOHO_API_BUDGET_ENABLED=true
ZOHO_SYNC_CONCURRENCY=2
INVOICE_SYNC_INTERVAL_MS=1800000
RECONCILIATION_FULL_ZOHO_INTERVAL_MS=21600000
```

The **Synchronization** dashboard shows live Zoho API usage.

## Running the system

### Prerequisites

- MySQL / MariaDB (local Docker: `yarn docker:up` — see root [README](../README.md))
- Redis 6+ (same compose stack, or any Redis on `REDIS_HOST` / `REDIS_PORT`)

### Migration

```bash
yarn docker:up    # if not already running
yarn db:migrate
```

Creates `sync_jobs`, `integration_sync_state`, and related tables (full history under `db/migrations/`).

### Environment variables

See `.env.dist` for:

- `MYSQL_*` (Docker defaults: host `127.0.0.1`, port `3307`, password `root`)
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB`
- `SYNC_ENABLED`, `SYNC_SCHEDULER_ENABLED`, `WORKER_INLINE`
- `CUSTOMER_SYNC_INTERVAL_MS`, `INVOICE_SYNC_INTERVAL_MS`, `PAYMENT_SYNC_INTERVAL_MS`, `RECONCILIATION_SYNC_INTERVAL_MS`, `PRODUCTS_SYNC_INTERVAL_MS`
- `API_TIMEOUT_MS`, `API_CONCURRENCY`, `MAX_RETRIES`, `CACHE_TTL_SECONDS`, `WORKER_CONCURRENCY`, `SYNC_PAGE_SIZE`

### Start processes

```bash
# API server (enqueues jobs, serves dashboard, WebSocket)
yarn dev

# Background workers (production)
yarn worker
```

For local development without a separate worker process:

```env
WORKER_INLINE=true
```

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/sync/overview` | Integration status, queue stats, running jobs |
| GET | `/api/admin/sync/jobs` | Recent sync job history |
| GET | `/api/admin/sync/running` | Currently running jobs |
| POST | `/api/admin/sync/:integration/trigger` | Manual sync |
| POST | `/api/admin/sync/:integration/retry` | Retry failed job |

`POST /api/admin/reconciliation/sync` now returns **202 Accepted** when sync is queued.

## WebSocket events

Connect to `/api/socket.io`. Events:

- `sync:started`
- `sync:progress` — `{ processed, total, percent }`
- `sync:completed`
- `sync:failed`
- `sync:retry`

## Dashboard behavior

- Billing reconciliation reads from `reconciliation_customer_cache` and `billing_insights_cache` (MySQL).
- Background sync is triggered via BullMQ when data is stale; page requests never block on external APIs.
- Admin **Synchronization** page (`/admin/synchronization`) shows live job progress.

## Code layout

```
api/
  config/redis.js
  lib/cache.js, httpClient.js, structuredLogger.js
  queue/connection.js, definitions.js, manager.js, schedulers.js
  repositories/syncJob.repository.js, integrationState.repository.js, customer.repository.js
  services/external/billing.service.js, isp.service.js, crm.service.js, payment.service.js
  workers/*.worker.js, registry.js
  socket/index.js
  controllers/sync.controller.js
workers/index.js
```

## Fallback

If Redis is unavailable at startup, the API falls back to the legacy in-process `setInterval` reconciliation scheduler so existing functionality is preserved.
