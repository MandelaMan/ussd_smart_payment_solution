# Admin dashboard

React + TypeScript + Vite admin UI for the USSD smart payment solution.

## Develop

From the **repo root** (API + DB must be running — see root [README](../README.md)):

```bash
yarn docker:up
yarn db:setup
yarn dev          # API on :4000
yarn dev:admin    # this app on http://localhost:5173/admin/
```

Or from this folder:

```bash
yarn dev
```

Vite proxies `/api` to `http://localhost:4000` (see `vite.config.ts`).

## Build

```bash
# from repo root
yarn build:admin
```

Built assets land in `admin/dist` and are served by the API at `/admin` in production.

## Stack

- React + TypeScript + Vite
- Chakra UI
- React Router

Login and roles are managed under **Settings → Users** (Administrator, Customer Support, CFO, Partner).
