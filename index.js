require("dotenv").config();
const util = require("util");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const cookieParser = require("cookie-parser");

const { loadEnv } = require("./api/config/env");
const { getPool } = require("./api/config/db");
const notFound = require("./api/middleware/notFound");
const errorHandler = require("./api/middleware/errorHandler");
const { logError, logServerStart } = require("./api/utils/errorLogger");

const env = loadEnv();
const app = express();

//Routes
const routes = require("./api/routes");

app.use(helmet());
app.use(cors());
app.use(
  express.json({ limit: "1mb", type: ["application/json", "text/plain"] })
);
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

if (env.NODE_ENV !== "test") app.use(morgan("dev"));

async function healthCheckHandler(_req, res) {
  try {
    const [row] = await getPool().query("SELECT 1 AS ok;");
    res.json({
      status: "ok",
      db: row[0]?.ok === 1 ? "connected" : "unknown",
      env: env.NODE_ENV,
    });
  } catch (err) {
    logError(err, { source: "healthCheck" });
    res
      .status(500)
      .json({ status: "degraded", db: "disconnected", env: env.NODE_ENV });
  }
}

app.get("/", healthCheckHandler);

app.use("/api", routes);
app.use(notFound);
app.use(errorHandler);

process.on("unhandledRejection", (reason) => {
  const err =
    reason instanceof Error
      ? reason
      : new Error(typeof reason === "object" ? util.inspect(reason) : String(reason));
  logError(err, { source: "unhandledRejection" });
});

process.on("uncaughtException", (err) => {
  logError(err, { source: "uncaughtException" });
  process.exit(1);
});

app.listen(env.PORT, () => {
  console.log(`Server listening on http://localhost:${env.PORT}`);
  logServerStart({ port: env.PORT });
});
