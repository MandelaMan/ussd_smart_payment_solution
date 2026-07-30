import { motion, useReducedMotion } from "framer-motion";
import { Outlet, useLocation } from "react-router-dom";

/**
 * Soft opacity fade on route enter.
 * Opacity-only (no transform) so sticky list headers keep working on mobile.
 * Enter-only avoids stacking two pages in the scroll pane during exit.
 */
export function MobilePageTransition() {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  // Key on pathname only so query/hash updates don't replay the fade.
  const routeKey = location.pathname;

  if (reduceMotion) {
    return <Outlet />;
  }

  return (
    <motion.div
      key={routeKey}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        minWidth: 0,
        width: "100%",
      }}
    >
      <Outlet />
    </motion.div>
  );
}
