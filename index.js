require("dotenv").config();
const http = require("http");
const path = require("path");
const express = require("express");
const util = require("util");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");

const { loadEnv } = require("./api/config/env");
const { getPool } = require("./api/config/db");
const { connectRedis, pingRedis } = require("./api/config/redis");
const notFound = require("./api/middleware/notFound");
const errorHandler = require("./api/middleware/errorHandler");
const { logError, logServerStart } = require("./api/utils/errorLogger");
const { initSocket } = require("./api/socket");
const { syncLog } = require("./api/lib/structuredLogger");

const env = loadEnv();
const app = express();

const routes = require("./api/routes");

app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);

const allowedOrigins = [
  env.ADMIN_ORIGIN,
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://app.sulsolutions.biz",
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(
  express.json({ limit: "1mb", type: ["application/json", "text/plain"] })
);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

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

const adminDist = path.join(__dirname, "admin", "dist");
app.use("/admin", express.static(adminDist));
app.get(/^\/admin(\/.*)?$/, (_req, res) => {
  res.sendFile(path.join(adminDist, "index.html"));
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
});

module.exports = { app, server };
