import { useEffect } from "react";
import { useAuth } from "../lib/auth";
import {
  armBootSplashMaxWait,
  dismissBootSplash,
  isPwaDisplayMode,
} from "../lib/bootSplash";

/**
 * PWA-only: keeps the HTML boot splash up until the first auth check finishes.
 * In a normal browser tab the splash is never shown.
 */
export function BootSplashGate() {
  const { loading } = useAuth();

  useEffect(() => {
    if (!isPwaDisplayMode()) {
      dismissBootSplash();
      return;
    }
    armBootSplashMaxWait();
  }, []);

  useEffect(() => {
    if (!isPwaDisplayMode()) return;
    if (!loading) dismissBootSplash();
  }, [loading]);

  return null;
}
