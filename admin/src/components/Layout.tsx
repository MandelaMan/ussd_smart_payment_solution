import { Box, Flex } from "@chakra-ui/react";
import { Outlet } from "react-router-dom";
import { useState } from "react";
import { createPortal } from "react-dom";
import { Sidebar } from "./Sidebar";
import { MobileBottomNav } from "./MobileBottomNav";
import { MOBILE_BOTTOM_NAV_H } from "../lib/mobileNav";

export function Layout() {
  const [open, setOpen] = useState(false);

  return (
    <Flex
      h="100dvh"
      maxH="100dvh"
      minH="100dvh"
      overflow="hidden"
      bg={{ base: "white", lg: "surface.50" }}
    >
      <Sidebar open={open} onClose={() => setOpen(false)} />

      <Flex
        direction="column"
        flex="1"
        minW={0}
        minH={0}
        overflow="hidden"
      >
        <Box
          as="main"
          flex="1"
          minH={0}
          minW={0}
          display="flex"
          flexDirection="column"
          overflow="auto"
          WebkitOverflowScrolling="touch"
          p={{ base: 0, lg: 3 }}
          pt={{
            base: "max(0.75rem, env(safe-area-inset-top, 0px))",
            lg: 3,
          }}
          pb={{
            base: `calc(${MOBILE_BOTTOM_NAV_H} + env(safe-area-inset-bottom, 0px) + 12px)`,
            lg: 3,
          }}
        >
          <Box flex="1" minH={0} px={{ base: 3, lg: 0 }}>
            <Outlet />
          </Box>
        </Box>
      </Flex>

      {/* Portal to body so fixed is always viewport-relative (not trapped by overflow/transform) */}
      {typeof document !== "undefined" && !open
        ? createPortal(
            <Box
              className="mobile-bottom-nav-root"
              display={{ base: "block", lg: "none" }}
              position="fixed"
              left={0}
              right={0}
              bottom={0}
              zIndex={1000}
              bg="white"
              style={{
                position: "fixed",
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 1000,
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

export { MOBILE_BOTTOM_NAV_H };
