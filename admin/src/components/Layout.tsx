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
          display="block"
          overflow="auto"
          overflowX="auto"
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
            minW={0}
            w="full"
            h={{ lg: "100%" }}
            minH={{ lg: 0 }}
            display={{ lg: "flex" }}
            flexDirection="column"
            px={{ base: 4, lg: 0 }}
          >
            <MobilePageTransition />
          </Box>
        </Box>
      </Flex>

      {typeof document !== "undefined" && !open && !hideBottomNav
        ? createPortal(
            <Box
              className="sul-mobile-nav-v2"
              display={{ base: "block", lg: "none" }}
              position="fixed"
              left={0}
              right={0}
              bottom={0}
              zIndex={1000}
              bg="transparent"
              pointerEvents="none"
              p={0}
              pb="8px"
              style={{
                position: "fixed",
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 1000,
                background: "transparent",
                pointerEvents: "none",
                paddingBottom: 8,
                transform: "none",
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
