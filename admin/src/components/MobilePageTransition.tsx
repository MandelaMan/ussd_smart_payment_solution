import { Outlet } from "react-router-dom";

/**
 * Route outlet wrapper. Page transitions are intentionally plain so sticky
 * headers and Suspense boundaries keep working reliably on mobile.
 */
export function MobilePageTransition() {
  return <Outlet />;
}
