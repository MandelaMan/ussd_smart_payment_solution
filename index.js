require("dotenv").config();
const http = require("http");
const path = require("path");
const express = require("express");
const util = require("util");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");

const { loadEnv, validateProductionSecrets } = require("./api/config/env");
const { getPool } = require("./api/config/db");
const { connectRedis, pingRedis } = require("./api/config/redis");
const notFound = require("./api/middleware/notFound");
const errorHandler = require("./api/middleware/errorHandler");
const { logError, logServerStart } = require("./api/utils/errorLogger");
const { initSocket } = require("./api/socket");
const { syncLog } = require("./api/lib/structuredLogger");

const env = loadEnv();
validateProductionSecrets(env);
const app = express();

if (env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

const { originGuard } = require("./api/middleware/originGuard");

const routes = require("./api/routes");

app.use(
  helmet({
    // CSP disabled — admin SPA is built separately; configure at reverse proxy if needed.
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    // Module scripts use crossorigin; CORP same-origin can blank the SPA when
    // Origin is localhost vs 127.0.0.1 (or after a proxy hop).
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

const allowedOrigins = [
  env.ADMIN_ORIGIN,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  // Built SPA is also served from the API origin; module scripts send Origin.
  "http://localhost:4000",
  "http://127.0.0.1:4000",
  `http://localhost:${env.PORT}`,
  `http://127.0.0.1:${env.PORT}`,
  "https://app.sulsolutions.biz",
  "https://staging-app.sulsolutions.biz",
].filter(Boolean);

app.use(
  cors((req, callback) => {
    const reqPath = req.path || "";
    const isPublicLead =
      reqPath.startsWith("/api/public/leads") ||
      reqPath === "/api/public/whatsapp/status";

    if (isPublicLead) {
      return callback(null, {
        origin: true,
        credentials: false,
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: [
          "Content-Type",
          "X-Lead-Source",
          "X-Requested-With",
        ],
      });
    }

    // Admin static assets are same-origin; Vite may still send Origin because of
    // crossorigin on module scripts. Never CORS-block the SPA shell.
    if (reqPath === "/admin" || reqPath.startsWith("/admin/")) {
      return callback(null, { origin: true, credentials: true });
    }

    const origin = req.header("Origin");
    // Same-origin browser navigations (e.g. GET /admin/login) often send no Origin.
    // Only enforce the allowlist when Origin is present (cross-origin / XHR / fetch).
    if (!origin) {
      return callback(null, { origin: true, credentials: true });
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, { origin: true, credentials: true });
    }
    // Reflect Origin when it matches this server's host (API serving admin SPA).
    try {
      const host = req.headers.host;
      if (host && new URL(origin).host === host) {
        return callback(null, { origin: true, credentials: true });
      }
    } catch {
      /* ignore bad Origin */
    }
    return callback(new Error("Not allowed by CORS"));
  })
);

app.use(
  express.json({
    limit: "12mb",
    type: ["application/json", "text/plain"],
    verify: (req, _res, buf) => {
      const path = req.originalUrl?.split("?")[0] || "";
      if (path === "/api/public/whatsapp/webhook") {
        req.rawBody = buf;
      }
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(originGuard);

if (env.NODE_ENV !== "test") app.use(morgan("dev"));

async function healthCheckHandler(_req, res) {
  try {
    const [row] = await getPool().query("SELECT 1 AS ok;");
    const redisOk = await pingRedis().catch(() => false);
    res.json({
      status: "ok",
      db: row[0]?.ok === 1 ? "connected" : "unknown",
      redis: redisOk ? "connected" : "disconnected",
      syncEnabled: env.SYNC_ENABLED,
      env: env.NODE_ENV,
    });
  } catch (err) {
    logError(err, { source: "healthCheck" });
    res
      .status(500)
      .json({ status: "degraded", db: "disconnected", env: env.NODE_ENV });
  }
}

app.get("/api/health", healthCheckHandler);

app.use("/api", routes);

const publicLeadsDir = path.join(__dirname, "public", "leads");
app.use(
  "/leads",
  express.static(publicLeadsDir, {
    index: "index.html",
    setHeaders(res, filePath) {
      if (filePath.endsWith("embed.js")) {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Cache-Control", "public, max-age=300");
      }
    },
  })
);
app.get("/leads/embed", (_req, res) => {
  res.sendFile(path.join(publicLeadsDir, "embed.html"));
});

const publicSignupDir = path.join(__dirname, "public", "signup");
app.use(
  "/signup",
  express.static(publicSignupDir, {
    index: "index.html",
  })
);

const adminDist = path.join(__dirname, "admin", "dist");
const adminIndex = path.join(adminDist, "index.html");
const fs = require("fs");
app.use(
  "/admin",
  express.static(adminDist, {
    setHeaders(res, filePath) {
      // Never long-cache the SPA shell — hashed JS/CSS can stay immutable.
      if (filePath.endsWith("index.html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      } else if (/\.[a-f0-9]{8,}\.(js|css)$/i.test(filePath)) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      }
    },
  })
);
app.get(/^\/admin(\/.*)?$/, (_req, res) => {
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  if (!fs.existsSync(adminIndex)) {
    return res
      .status(503)
      .type("html")
      .send(
        `<!doctype html><meta charset="utf-8" /><title>Admin UI not built</title>
         <p>Admin SPA is missing. For local development open
         <a href="http://127.0.0.1:5173/admin/">http://127.0.0.1:5173/admin/</a>
         or run <code>cd admin && yarn build</code>.</p>`
      );
  }
  return res.sendFile(adminIndex);
});

app.get("/", (_req, res) => {
  res.redirect("/admin");
});

app.use(notFound);
app.use(errorHandler);

process.on("unhandledRejection", (reason) => {
  const err =
    reason instanceof Error
      ? reason
      : new Error(
          typeof reason === "object" ? util.inspect(reason) : String(reason)
        );
  logError(err, { source: "unhandledRejection" });
});

process.on("uncaughtException", (err) => {
  logError(err, { source: "uncaughtException" });
  process.exit(1);
});

const server = http.createServer(app);
initSocket(server, env);

async function bootstrapSync() {
  if (!env.SYNC_ENABLED) {
    try {
      const { startScheduledSync } = require("./api/services/reconciliationStore");
      startScheduledSync();
    } catch (e) {
      console.warn("[reconciliation] scheduled sync not started:", e.message);
    }
    return;
  }

  try {
    await connectRedis();
    const redisOk = await pingRedis();
    if (!redisOk) {
      syncLog.warn("redis_unavailable_fallback_inline_sync");
      const { startScheduledSync } = require("./api/services/reconciliationStore");
      startScheduledSync();
      return;
    }

    // Schedulers + boot enqueue belong to the worker process. Running them in
    // both API and worker races clearAllRepeatableJobs and opens dozens of
    // Redis connections on every nodemon restart — which makes admin refresh
    // hang on ECONNREFUSED / Redis storms.
    if (env.WORKER_INLINE) {
      const { startAllWorkers } = require("./api/workers/registry");
      startAllWorkers();
      const { registerRepeatableJobs, triggerInitialSync } = require("./api/queue/schedulers");
      await registerRepeatableJobs();
      await triggerInitialSync();
      syncLog.info("inline_workers_and_schedulers_started");
      return;
    }

    syncLog.info("sync_schedulers_owned_by_worker", {
      hint: "Run yarn worker / yarn worker:dev for schedules and job processing",
    });
  } catch (e) {
    syncLog.warn("sync_bootstrap_failed", { error: e.message });
    try {
      const { startScheduledSync } = require("./api/services/reconciliationStore");
      startScheduledSync();
    } catch {
      /* ignore */
    }
  }
}

server.listen(env.PORT, () => {
  console.log(`Server listening on http://localhost:${env.PORT}`);
  logServerStart({ port: env.PORT });
  bootstrapSync().catch((e) => {
    console.warn("[sync] bootstrap error:", e.message);
  });
  // Sync permission catalog + map legacy roles → groups (idempotent).
  Promise.resolve()
    .then(() => require("./api/rbac/permissionService").initializeRbac())
    .then(() => syncLog.info("rbac_initialized"))
    .catch((e) => {
      console.warn("[rbac] initialize error:", e.message);
    });
});

module.exports = { app, server };
