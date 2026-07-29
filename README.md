# ussd_smart_payment_solution

USSD / M-Pesa smart payment solution with a Node API and React admin dashboard.

## Local development

### Prerequisites

- Node.js + Yarn
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (MySQL/MariaDB + Redis)

XAMPP MySQL is **not** required. Prefer Docker for local databases.

### Start infrastructure

```bash
yarn docker:up    # MariaDB (host :3307) + Redis (host :6379)
yarn db:setup     # migrate schema + seed test admin users
```

Copy `.env.dist` → `.env` if you do not already have one. Defaults point at Docker:

| Variable | Default | Notes |
|----------|---------|--------|
| `MYSQL_HOST` | `127.0.0.1` | |
| `MYSQL_PORT` | `3307` | Host port mapped from container `3306` (avoids XAMPP on `3306`) |
| `MYSQL_USER` / `MYSQL_PASSWORD` | `root` / `root` | Matches `docker-compose.yml` |
| `MYSQL_DATABASE` | `ussd_smart_payment_solution` | |
| `REDIS_HOST` / `REDIS_PORT` | `127.0.0.1` / `6379` | |

If port `3306` is free and you prefer it, change compose to `"3306:3306"` and set `MYSQL_PORT=3306`. If Redis is already running on the host, Docker Redis may fail to bind `6379` — the existing Redis instance is fine.

### Run the app

```bash
yarn dev          # API — http://localhost:4000
yarn dev:admin    # Admin UI — http://localhost:5173/admin/
yarn worker:dev   # Background sync workers (BullMQ)
```

Login: http://localhost:5173/admin/login (credentials in `.env` / `.env.dist`).

### Database commands

```bash
yarn db:migrate         # apply schema + migrations
yarn db:status          # show applied migrations
yarn db:seed            # seed test users (admin, support, cfo, partner)
yarn db:setup           # migrate + seed
yarn db:restore-xampp   # one-time: import old XAMPP data into Docker MySQL
```

`yarn db:restore-xampp` reads `C:\xampp\mysql\data`, dumps `ussd_smart_payment_solution`, and imports it into the Docker MariaDB container. Stop using XAMPP MySQL afterward.

### Docker commands

```bash
yarn docker:up    # start MySQL + Redis
yarn docker:down  # stop containers (volumes kept)
yarn docker:logs  # follow container logs
```

Compose file: [`docker-compose.yml`](docker-compose.yml).

## Docs

- [Setup & migration guide (HTML)](docs/SETUP_AND_MIGRATION_GUIDE.html) — full install, Docker, env, deploy
- [Customer processes](docs/CUSTOMER_PROCESSES.md) — admin customer actions and effects on Zoho, TISP, OLT
- [Sync architecture](docs/SYNC_ARCHITECTURE.md) — BullMQ workers, Redis, Zoho budget
- [Zoho sync setup](docs/ZOHO_SYNC_SETUP.md) — webhooks, incremental sync, rate limits
- [Admin UI](admin/README.md) — Vite React dashboard
