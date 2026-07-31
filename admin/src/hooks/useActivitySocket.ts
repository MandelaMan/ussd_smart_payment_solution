import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";
import type { ActivityItem } from "../lib/api";
import { normalizeActivityItem } from "../lib/activityFeed";

/**
 * Subscribe to live activity_logs inserts (`activity:created` via Socket.IO).
 * Failures to connect must never blank the admin UI.
 */
export function useActivitySocket(
  onCreated: (item: ActivityItem) => void,
  enabled = true
) {
  const handlerRef = useRef(onCreated);
  handlerRef.current = onCreated;

  useEffect(() => {
    if (!enabled) return undefined;

    let socket: Socket | null = null;
    try {
      socket = io({
        path: "/api/socket.io",
        transports: ["websocket", "polling"],
        withCredentials: true,
      });
    } catch (err) {
      console.error("[activity-socket] failed to connect", err);
      return undefined;
    }

    socket.on("activity:created", (payload: unknown) => {
      try {
        const item = normalizeActivityItem(payload);
        if (item) handlerRef.current(item);
      } catch (err) {
        console.error("[activity-socket] bad payload", err);
      }
    });

    socket.on("connect_error", (err) => {
      console.warn("[activity-socket] connect_error", err.message);
    });

    return () => {
      socket?.disconnect();
    };
  }, [enabled]);
}
