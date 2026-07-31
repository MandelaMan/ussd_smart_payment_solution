import { motion, useReducedMotion } from "framer-motion";
import { useRef } from "react";
import { Outlet, useLocation } from "react-router-dom";

/**
 * Soft opacity fade on route enter.
 * Opacity-only (no transform) so sticky list headers keep working on mobile.
 * Never starts at 0 — a stuck animation must not blank the whole app.
 */
export function MobilePageTransition() {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const isFirstPaint = useRef(true);
  // Key on pathname only so query/hash updates don't replay the fade.
  const routeKey = location.pathname;

  if (reduceMotion) {
    return <Outlet />;
  }

  const skipEnter = isFirstPaint.current;
  isFirstPaint.current = false;

  return (
    <motion.div
      key={routeKey}
      initial={skipEnter ? false : { opacity: 0.92 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16, ease: "easeOut" }}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        minWidth: 0,
        width: "100%",
        // Solid fallback so content stays readable if motion fails mid-flight.
        opacity: 1,
      }}
    >
      <Outlet />
    </motion.div>
  );
}
