import { Box, Flex } from "@chakra-ui/react";
import { useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { MobileBottomNav } from "./MobileBottomNav";
import { MobilePageTransition } from "./MobilePageTransition";
import {
  MOBILE_BOTTOM_NAV_GAP,
  MOBILE_BOTTOM_NAV_H,
  MOBILE_BOTTOM_NAV_OFFSET,
} from "../lib/mobileNav";
import { MobileSearchProvider, useMobileSearchOptional } from "../lib/mobileSearch";

/** Float the pill 8px above the visible bottom — never safe-area (that paints the dead strip). */
const MOBILE_NAV_BOTTOM = MOBILE_BOTTOM_NAV_GAP;

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
      position="relative"
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
          // Mobile stays block so sticky list headers work; desktop is a flex
          // column so Home/dashboard can fill height (activity rail + charts).
          display={{ base: "block", lg: "flex" }}
          flexDirection="column"
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
            flex={{ lg: 1 }}
            minW={0}
            w="full"
            minH={{ lg: 0 }}
            display={{ lg: "flex" }}
            flexDirection="column"
            px={{ base: 4, lg: 0 }}
          >
            <MobilePageTransition />
          </Box>
        </Box>
      </Flex>

      {!open && !hideBottomNav ? (
        <Box
          className="sul-mobile-nav-v5"
          display={{ base: "block", lg: "none" }}
          position="absolute"
          left={0}
          right={0}
          bottom={MOBILE_NAV_BOTTOM}
          zIndex={1000}
          bg="transparent"
          pointerEvents="none"
          p={0}
          m={0}
          minH={0}
          h="auto"
          maxH="none"
        >
          <MobileBottomNav onOpenMenu={() => setOpen(true)} />
        </Box>
      ) : null}
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
