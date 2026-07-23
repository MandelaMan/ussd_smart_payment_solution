let io = null;

function initSocket(server, env) {
  const cookie = require("cookie");
  const jwt = require("jsonwebtoken");
  const { Server } = require("socket.io");
  const {
    COOKIE_NAME,
    verifyToken,
    loadUserFromToken,
  } = require("../middleware/auth");

  const allowedOrigins = [
    env.ADMIN_ORIGIN,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://app.sulsolutions.biz",
    "https://staging-app.sulsolutions.biz",
  ].filter(Boolean);

  io = new Server(server, {
    path: "/api/socket.io",
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
  });

  io.use(async (socket, next) => {
    try {
      const rawCookie = socket.handshake.headers.cookie || "";
      const cookies = cookie.parse(rawCookie);
      const token = cookies[COOKIE_NAME];
      if (!token) {
        return next(new Error("Authentication required"));
      }
      const decoded = verifyToken(token);
      const user = await loadUserFromToken(decoded);
      if (!user) {
        return next(new Error("Invalid or expired session"));
      }
      socket.user = user;
      return next();
    } catch {
      return next(new Error("Authentication required"));
    }
  });

  io.on("connection", (socket) => {
    socket.join("sync-updates");
    socket.emit("sync:connected", { ok: true });
  });

  return io;
}

function emitSyncEvent(event, payload) {
  if (!io) return;
  io.to("sync-updates").emit(event, payload);
}

function getIO() {
  return io;
}

module.exports = { initSocket, emitSyncEvent, getIO };
