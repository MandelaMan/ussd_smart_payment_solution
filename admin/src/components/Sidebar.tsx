import {
  Box,
  Button,
  Flex,
  Image,
  Text,
  VStack,
} from "@chakra-ui/react";
import { NavLink } from "react-router-dom";

import {
  FiGrid,
  FiCreditCard,
  FiLogOut,
  FiUser,
  FiPackage,
  FiBriefcase,
  FiHome,
  FiBarChart2,
  FiLayers,
  FiPieChart,
  FiSettings,
  FiList,
  FiRefreshCw,
} from "react-icons/fi";
import { BillingNavGroup } from "./billing/BillingNavGroup";
import { useAuth } from "../lib/auth";
import {
  canAccessConfig,
  canAccessFinance,
  canAccessReports,
  canManageUsers,
  canAccessOps,
  normalizeRole,
  roleLabel,
} from "../lib/rbac";

type NavLinkDef = {
  to: string;
  label: string;
  icon: typeof FiGrid;
  end?: boolean;
  visible?: boolean;
};

type Props = { open: boolean; onClose: () => void };

export function Sidebar({ open, onClose }: Props) {
  const { user, logout } = useAuth();
  const role = normalizeRole(user?.role);

  const links: NavLinkDef[] = [
    { to: "/", label: "Dashboard", icon: FiGrid, end: true, visible: true },
    {
      to: "/customers",
      label: "Customers",
      icon: FiUser,
      visible: true,
    },
    {
      to: "/products",
      label: "Packages",
      icon: FiPackage,
      visible: canAccessConfig(user),
    },
    {
      to: "/buildings",
      label: "Buildings",
      icon: FiHome,
      visible: canAccessConfig(user),
    },
    {
      to: "/agencies",
      label: "Agencies",
      icon: FiBriefcase,
      visible: canAccessConfig(user),
    },
    {
      to: "/apartments",
      label: "Apartment History",
      icon: FiLayers,
      visible: canAccessConfig(user),
    },
    {
      to: "/transactions",
      label: "Transactions",
      icon: FiCreditCard,
      visible: canAccessFinance(user),
    },
    {
      to: "/synchronization",
      label: "Synchronization",
      icon: FiRefreshCw,
      visible: canAccessFinance(user),
    },
    {
      to: "/analytics",
      label: "Business Intelligence",
      icon: FiPieChart,
      visible: canAccessFinance(user),
    },
    {
      to: "/reports",
      label: "Reports",
      icon: FiBarChart2,
      visible: canAccessReports(user),
    },
    {
      to: "/logs",
      label: "Logs",
      icon: FiList,
      visible: canAccessOps(user),
    },
    {
      to: "/settings",
      label: "Settings",
      icon: FiSettings,
      visible: canManageUsers(user),
    },
  ];

  return (
    <>
      {open ? (
        <Box
          className="mobile-sidebar-backdrop"
          display={{ base: "block", lg: "none" }}
          position="fixed"
          inset={0}
          bg="blackAlpha.500"
          zIndex={1100}
          onClick={onClose}
        />
      ) : null}

      <Box
        as="aside"
        w={{ base: "min(280px, 88vw)", lg: "220px" }}
        bg="sidebar.bg"
        borderRight="1px solid"
        borderColor="sidebar.border"
        position={{ base: "fixed", lg: "sticky" }}
        top={0}
        h="100dvh"
        maxH="100dvh"
        zIndex={{ base: 1200, lg: 50 }}
        transform={{
          base: open ? "translateX(0)" : "translateX(-100%)",
          lg: "none",
        }}
        transition="transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)"
        display="flex"
        flexDirection="column"
        flexShrink={0}
        overflow="hidden"
        boxShadow={{
          base: open ? "0 12px 40px rgba(15, 23, 42, 0.28)" : "none",
          lg: "none",
        }}
      >
        <NavLink to="/" end onClick={onClose} style={{ textDecoration: "none", flexShrink: 0 }}>
          <Flex
            align="center"
            gap={2.5}
            px={3}
            py={3}
            bg="brand.600"
            borderBottom="3px solid"
            borderColor="azure.500"
            _hover={{ bg: "brand.700" }}
          >
            <Image
              src="/admin/logo.png"
              alt="SUL Bix"
              boxSize="36px"
              borderRadius="md"
              bg="white"
              p={0.5}
              flexShrink={0}
            />
            <Box minW={0}>
              <Text fontWeight="semibold" fontSize="sm" color="white" truncate>
                SUL Bix
              </Text>
              <Text fontSize="xs" color="whiteAlpha.800" truncate>
                Utility Admin
              </Text>
            </Box>
          </Flex>
        </NavLink>

        <Box flex={1} minH={0} overflowY="auto" bg="sidebar.nav" px={2} py={2}>
          <VStack align="stretch" gap={0.5}>
          {links
            .filter((l) => l.visible !== false)
            .map((link) => {
              const items = [
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  onClick={onClose}
                  style={{ textDecoration: "none" }}
                >
                  {({ isActive }) => (
                    <Flex
                      align="center"
                      gap={2}
                      px={2}
                      py={3}
                      minH="44px"
                      borderRadius="md"
                      fontSize="sm"
                      fontWeight="medium"
                      color={isActive ? "white" : "sidebar.fg"}
                      bg={isActive ? "brand.600" : "transparent"}
                      borderLeft="3px solid"
                      borderLeftColor={isActive ? "azure.500" : "transparent"}
                      _hover={{
                        bg: isActive ? "brand.700" : "sidebar.hover",
                        color: isActive ? "white" : "sidebar.fg",
                      }}
                      _active={{ transform: "scale(0.98)" }}
                      transition="background 0.15s, color 0.15s, transform 0.15s"
                    >
                      <link.icon size={16} />
                      {link.label}
                    </Flex>
                  )}
                </NavLink>,
              ];

              if (link.to === "/transactions" && canAccessFinance(user)) {
                items.push(<BillingNavGroup key="billing-nav" onNavigate={onClose} />);
              }

              return items;
            })
            .flat()}
          </VStack>
        </Box>

        <Box
          flexShrink={0}
          borderTop="1px solid"
          borderColor="sidebar.border"
          px={3}
          pt={3}
          bg="sidebar.bg"
          pb={{
            base: "max(1rem, env(safe-area-inset-bottom, 0px))",
            lg: 3,
          }}
        >
          <Text fontSize="xs" color="sidebar.muted" truncate>
            {user?.email}
          </Text>
          <Text
            fontSize="xs"
            color="brand.600"
            fontWeight="medium"
            mt={0.5}
          >
            {roleLabel(role)}
          </Text>
          <Button
            size="sm"
            colorPalette="brand"
            mt={3}
            minH="44px"
            w="full"
            justifyContent="flex-start"
            fontSize="sm"
            onClick={() => logout()}
          >
            <FiLogOut style={{ marginRight: 8 }} />
            Sign out
          </Button>
        </Box>
      </Box>
    </>
  );
}
