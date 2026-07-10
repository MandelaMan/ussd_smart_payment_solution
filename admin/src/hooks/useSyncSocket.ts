import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type { SyncProgressEvent } from "../lib/api";

type SyncSocketState = {
  connected: boolean;
  lastEvent: SyncProgressEvent | null;
  liveProgress: Record<string, SyncProgressEvent>;
};

export function useSyncSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [state, setState] = useState<SyncSocketState>({
    connected: false,
    lastEvent: null,
    liveProgress: {},
  });

  const upsertProgress = useCallback((event: SyncProgressEvent) => {
    setState((prev) => ({
      connected: prev.connected,
      lastEvent: event,
      liveProgress: {
        ...prev.liveProgress,
        [event.integration]: event,
      },
    }));
  }, []);

  useEffect(() => {
    const socket = io({
      path: "/api/socket.io",
      transports: ["websocket", "polling"],
      withCredentials: true,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setState((prev) => ({ ...prev, connected: true }));
    });
    socket.on("disconnect", () => {
      setState((prev) => ({ ...prev, connected: false }));
    });
    socket.on("sync:connected", () => {
      setState((prev) => ({ ...prev, connected: true }));
    });

    const progressEvents = [
      "sync:started",
      "sync:progress",
      "sync:completed",
      "sync:failed",
      "sync:retry",
    ] as const;

    for (const evt of progressEvents) {
      socket.on(evt, (payload: SyncProgressEvent) => {
        upsertProgress({ ...payload, event: evt });
      });
    }

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [upsertProgress]);

  const clearIntegration = useCallback((integration: string) => {
    setState((prev) => {
      const next = { ...prev.liveProgress };
      delete next[integration];
      return { ...prev, liveProgress: next };
    });
  }, []);

  return { ...state, clearIntegration };
}
