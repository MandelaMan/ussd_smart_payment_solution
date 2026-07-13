import { Box, Flex } from "@chakra-ui/react";
import { useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Sidebar } from "./Sidebar";
import { MobileBottomNav } from "./MobileBottomNav";
import { MobilePageTransition } from "./MobilePageTransition";
import { MOBILE_BOTTOM_NAV_H, MOBILE_BOTTOM_NAV_OFFSET } from "../lib/mobileNav";
import { MobileSearchProvider, useMobileSearchOptional } from "../lib/mobileSearch";

function LayoutShell() {
  const [open, setOpen] = useState(false);
  const mobileSearch = useMobileSearchOptional();
  const hideBottomNav = Boolean(mobileSearch?.searchOpen);
  const { pathname } = useLocation();

  useEffect(() => {
    mobileSearch?.closeSearch();
    // Reset search chrome when navigating between modules.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <Flex
      h="100%"
      maxH="100%"
      minH="100%"
      overflow="hidden"
      bg={{ base: "bg.panel", lg: "bg" }}
    >
      <Sidebar open={open} onClose={() => setOpen(false)} />

      <Flex direction="column" flex="1" minW={0} minH={0} overflow="hidden">
        <Box
          as="main"
          data-app-scroll-root
          flex="1"
          minH={0}
          minW={0}
          // Avoid a flex-column scrollport on mobile — it breaks position:sticky headers.
          display={{ base: "block", lg: "flex" }}
          flexDirection="column"
          overflow="auto"
          overflowX="hidden"
          WebkitOverflowScrolling="touch"
          p={{ base: 0, lg: 3 }}
          pt={{ base: 0, lg: 3 }}
          pb={{
            base: hideBottomNav
              ? "max(1rem, env(safe-area-inset-bottom, 0px))"
              : MOBILE_BOTTOM_NAV_OFFSET,
            lg: 3,
          }}
        >
          <Box
            flex={{ lg: 1 }}
            minW={0}
            w="full"
            minH={{ lg: 0 }}
            px={{ base: 4, lg: 0 }}
          >
            <MobilePageTransition />
          </Box>
        </Box>
      </Flex>

      {typeof document !== "undefined" && !open && !hideBottomNav
        ? createPortal(
            <Box
              className="mobile-bottom-nav-root"
              display={{ base: "block", lg: "none" }}
              position="fixed"
              left={0}
              right={0}
              bottom={0}
              zIndex={1000}
              bg="transparent"
              style={{
                position: "fixed",
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 1000,
                background: "transparent",
              }}
            >
              <MobileBottomNav onOpenMenu={() => setOpen(true)} />
            </Box>,
            document.body
          )
        : null}
    </Flex>
  );
}

export function Layout() {
  return (
    <MobileSearchProvider>
      <LayoutShell />
    </MobileSearchProvider>
  );
}

export { MOBILE_BOTTOM_NAV_H };
