import { Box, Flex } from "@chakra-ui/react";
import { Outlet } from "react-router-dom";
import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { MobileBottomNav } from "./MobileBottomNav";
import { MOBILE_BOTTOM_NAV_H } from "../lib/mobileNav";

export function Layout() {
  const [open, setOpen] = useState(false);

  return (
    <Flex
      minH="100dvh"
      h={{ lg: "100dvh" }}
      overflow={{ lg: "hidden" }}
      bg={{ base: "white", lg: "surface.50" }}
    >
      <Sidebar open={open} onClose={() => setOpen(false)} />

      <Flex
        direction="column"
        flex="1"
        minW={0}
        minH={0}
        position="relative"
        overflow={{ lg: "hidden" }}
      >
        <Box
          as="main"
          flex="1"
          minH={0}
          minW={0}
          display="flex"
          flexDirection="column"
          overflow="auto"
          p={{ base: 0, lg: 3 }}
          pt={{
            base: "max(0.75rem, env(safe-area-inset-top, 0px))",
            lg: 3,
          }}
          pb={{ base: 0, lg: 3 }}
        >
          <Box
            flex="1"
            minH={0}
            px={{ base: 3, lg: 0 }}
            pb={{
              base: `calc(${MOBILE_BOTTOM_NAV_H} + env(safe-area-inset-bottom, 0px) + 8px)`,
              lg: 0,
            }}
          >
            <Outlet />
          </Box>
        </Box>

        <MobileBottomNav onOpenMenu={() => setOpen(true)} />
      </Flex>
    </Flex>
  );
}
