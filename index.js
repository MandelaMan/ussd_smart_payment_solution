require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");

const { loadEnv } = require("./api/config/env");
const { getPool } = require("./api/config/db");
const notFound = require("./api/middleware/notFound");
const errorHandler = require("./api/middleware/errorHandler");

const env = loadEnv();
const app = express();

//Routes
const routes = require("./api/routes");

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(
  express.json({ limit: "1mb", type: ["application/json", "text/plain"] })
);
app.use(express.urlencoded({ extended: true }));

if (env.NODE_ENV !== "test") app.use(morgan("dev"));

// Health check with DB ping
app.get("/health", async (_req, res) => {
  try {
    const [row] = await getPool().query("SELECT 1 AS ok;");
    res.json({
      status: "ok",
      db: row[0]?.ok === 1 ? "connected" : "unknown",
      env: env.NODE_ENV,
    });
  } catch {
    res
      .status(500)
      .json({ status: "degraded", db: "disconnected", env: env.NODE_ENV });
  }
});

app.use("/api", routes);
app.use(notFound);
app.use(errorHandler);

app.listen(env.PORT, () => {
  console.log(`Server listening on http://localhost:${env.PORT}`);
});
