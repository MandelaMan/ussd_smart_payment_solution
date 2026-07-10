import { Box, Button, Flex, Text } from "@chakra-ui/react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { buildMobileNavTabs, isMobileNavTabActive, MOBILE_BOTTOM_NAV_H } from "../lib/mobileNav";

export { MOBILE_BOTTOM_NAV_H };

type Props = {
  onOpenMenu: () => void;
};

export function MobileBottomNav({ onOpenMenu }: Props) {
  const { user } = useAuth();
  const location = useLocation();
  const tabs = buildMobileNavTabs(user);

  return (
    <Box
      as="nav"
      bg="white"
      borderTop="1px solid"
      borderColor="gray.100"
      boxShadow="0 -1px 12px rgba(0,0,0,0.06)"
      pb="env(safe-area-inset-bottom, 0px)"
    >
      <Flex justify="space-around" align="stretch" minH={MOBILE_BOTTOM_NAV_H}>
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
                flexDirection="column"
                alignItems="center"
                justifyContent="center"
                gap={1}
                flex={1}
                minH={MOBILE_BOTTOM_NAV_H}
                h="auto"
                py={1.5}
                px={1}
                borderRadius={0}
                color="gray.500"
                onClick={onOpenMenu}
                _active={{ bg: "gray.50" }}
              >
                <Icon size={20} />
                <Text fontSize="2xs" fontWeight="medium" lineHeight="1.25">
                  {tab.label}
                </Text>
              </Button>
            );
          }

          return (
            <NavLink
              key={tab.key}
              to={tab.to!}
              end={tab.end}
              style={{ flex: 1, textDecoration: "none", minWidth: 0 }}
            >
              <Flex
                direction="column"
                align="center"
                justify="center"
                gap={1}
                minH={MOBILE_BOTTOM_NAV_H}
                py={1.5}
                px={1}
                color={active ? "brand.600" : "gray.500"}
                _active={{ bg: "gray.50" }}
                transition="color 0.15s ease"
              >
                <Icon size={20} strokeWidth={active ? 2.5 : 2} />
                <Text
                  fontSize="2xs"
                  fontWeight={active ? "semibold" : "medium"}
                  lineHeight="1.25"
                  textAlign="center"
                  truncate
                  maxW="full"
                >
                  {tab.label}
                </Text>
              </Flex>
            </NavLink>
          );
        })}
      </Flex>
    </Box>
  );
}
