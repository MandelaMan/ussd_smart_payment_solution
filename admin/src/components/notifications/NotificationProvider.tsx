import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { io, type Socket } from "socket.io-client";
import { api, type UserNotification } from "../../lib/api";
import { useAuth } from "../../lib/authContext";
import { subscribeToPushNotifications } from "../../lib/pushNotifications";

type NotificationState = {
  unreadCount: number;
  notifications: UserNotification[];
  loading: boolean;
  refresh: () => Promise<void>;
  markRead: (ids?: number[]) => Promise<void>;
  markAllRead: () => Promise<void>;
};

const NotificationContext = createContext<NotificationState | null>(null);

export function useNotifications() {
  const ctx = useContext(NotificationContext);
  return (
    ctx || {
      unreadCount: 0,
      notifications: [],
      loading: false,
      refresh: async () => {},
      markRead: async () => {},
      markAllRead: async () => {},
    }
  );
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const userId = user?.id;

  const refresh = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await api.listNotifications({ limit: "30" });
      setNotifications(res.notifications || []);
      setUnreadCount(res.unreadCount || 0);
    } catch {
      /* keep last snapshot */
    } finally {
      setLoading(false);
    }
  }, [userId]);

  const markRead = useCallback(async (ids?: number[]) => {
    const res = await api.markNotificationsRead({ ids });
    setUnreadCount(res.unreadCount || 0);
    if (ids?.length) {
      setNotifications((prev) =>
        prev.map((n) => (ids.includes(n.id) ? { ...n, isRead: true } : n))
      );
    }
  }, []);

  const markAllRead = useCallback(async () => {
    const res = await api.markNotificationsRead({ all: true });
    setUnreadCount(res.unreadCount || 0);
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
  }, []);

  const applyIncoming = useCallback(
    (payload?: { notification?: UserNotification | null }) => {
      const note = payload?.notification;
      if (!note || Number(note.userId) !== Number(userId)) {
        void refresh();
        return;
      }
      setNotifications((prev) => {
        if (prev.some((item) => item.id === note.id)) return prev;
        return [note, ...prev];
      });
      if (!note.isRead) {
        setUnreadCount((count) => count + 1);
      }
      void refresh();
    },
    [userId, refresh]
  );

  useEffect(() => {
    if (!userId) {
      setUnreadCount(0);
      setNotifications([]);
      return;
    }
    void refresh();
    void subscribeToPushNotifications();
  }, [userId, refresh]);

  useEffect(() => {
    if (!userId) return undefined;
    function onVisible() {
      if (document.visibilityState === "visible") void refresh();
    }
    function onFocus() {
      void refresh();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [userId, refresh]);

  useEffect(() => {
    if (!userId) return undefined;
    let socket: Socket | null = null;
    try {
      socket = io({
        path: "/api/socket.io",
        transports: ["websocket", "polling"],
        withCredentials: true,
      });
    } catch {
      return undefined;
    }
    const onNotify = (payload?: { notification?: UserNotification | null }) => {
      applyIncoming(payload);
    };
    const onActionItems = () => {
      void refresh();
    };
    socket.on("connect", onActionItems);
    socket.on("admin:notifications", onNotify);
    socket.on("admin:action_items", onActionItems);
    return () => {
      socket?.off("connect", onActionItems);
      socket?.off("admin:notifications", onNotify);
      socket?.off("admin:action_items", onActionItems);
      socket?.disconnect();
    };
  }, [userId, refresh, applyIncoming]);

  const value = useMemo(
    () => ({
      unreadCount,
      notifications,
      loading,
      refresh,
      markRead,
      markAllRead,
    }),
    [unreadCount, notifications, loading, refresh, markRead, markAllRead]
  );

  return (
    <NotificationContext.Provider value={value}>{children}</NotificationContext.Provider>
  );
}
