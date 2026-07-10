let io = null;

function initSocket(server, env) {
  const { Server } = require("socket.io");
  const allowedOrigins = [
    env.ADMIN_ORIGIN,
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "https://app.sulsolutions.biz",
  ].filter(Boolean);

  io = new Server(server, {
    path: "/api/socket.io",
    cors: {
      origin: allowedOrigins,
      credentials: true,
    },
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
