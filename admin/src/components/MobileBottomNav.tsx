import { Box, Button, Flex, Text } from "@chakra-ui/react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import {
  buildMobileNavTabs,
  isMobileNavTabActive,
  MOBILE_BOTTOM_NAV_H,
} from "../lib/mobileNav";

export { MOBILE_BOTTOM_NAV_H };

type Props = {
  onOpenMenu: () => void;
};

function TabVisual({
  active,
  icon: Icon,
  label,
}: {
  active: boolean;
  icon: typeof import("react-icons/fi").FiGrid;
  label: string;
}) {
  return (
    <Flex
      direction="column"
      align="center"
      justify="center"
      gap="2px"
      w="100%"
      minH="48px"
      px={1.5}
      py={1}
      borderRadius="full"
      bg={active ? "brand.600" : "transparent"}
      color={active ? "white" : "fg.muted"}
      boxShadow={active ? "0 2px 10px rgba(22, 106, 130, 0.32)" : "none"}
      transition="background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease"
    >
      <Box lineHeight={0} aria-hidden flexShrink={0}>
        <Icon size={18} strokeWidth={active ? 2.5 : 2} />
      </Box>
      <Text
        fontSize="9px"
        fontWeight={active ? "bold" : "semibold"}
        lineHeight="1.1"
        textAlign="center"
        whiteSpace="nowrap"
        letterSpacing="-0.02em"
        maxW="100%"
        overflow="hidden"
        textOverflow="ellipsis"
      >
        {label}
      </Text>
    </Flex>
  );
}

export function MobileBottomNav({ onOpenMenu }: Props) {
  const { user } = useAuth();
  const location = useLocation();
  const tabs = buildMobileNavTabs(user);

  return (
    <Box
      as="nav"
      mx={0}
      mb={0}
      // Floating pill only — no safe-area padding (that painted the white bottom strip).
      pb={0}
      bg="whiteAlpha.900"
      border="1px solid"
      borderColor="border"
      borderRadius="full"
      boxShadow="0 8px 28px rgba(15, 23, 42, 0.14)"
      backdropFilter="blur(16px)"
      css={{ WebkitBackdropFilter: "blur(16px)", pointerEvents: "auto" }}
      overflow="visible"
      px={1}
      py={1}
    >
      <Flex justify="space-between" align="center" minH={MOBILE_BOTTOM_NAV_H} gap={0.5}>
        {tabs.map((tab) => {
          const active = isMobileNavTabActive(tab, location.pathname, location.search);
          const Icon = tab.icon;

          if (tab.action === "menu") {
            return (
              <Button
                key={tab.key}
                type="button"
                variant="ghost"
                display="flex"
                flex={1}
                minW={0}
                h="auto"
                minH={MOBILE_BOTTOM_NAV_H}
                p={0}
                borderRadius="full"
                onClick={onOpenMenu}
                _hover={{ bg: "transparent" }}
                _active={{ bg: "transparent", transform: "scale(0.96)" }}
                transition="transform 0.15s ease"
              >
                <TabVisual active={false} icon={Icon} label={tab.label} />
              </Button>
            );
          }

          return (
            <NavLink
              key={tab.key}
              to={tab.to!}
              end={tab.end}
              style={{ flex: 1, textDecoration: "none", minWidth: 0 }}
              aria-current={active ? "page" : undefined}
            >
              <Flex
                align="center"
                justify="center"
                minH={MOBILE_BOTTOM_NAV_H}
                px={0.5}
                _active={{ opacity: 0.9, transform: "scale(0.97)" }}
                transition="transform 0.15s ease"
              >
                <TabVisual active={active} icon={Icon} label={tab.label} />
              </Flex>
            </NavLink>
          );
        })}
      </Flex>
    </Box>
  );
}
