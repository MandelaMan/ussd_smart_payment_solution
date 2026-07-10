import { Box, Collapsible, Flex, IconButton, Text } from "@chakra-ui/react";
import { useEffect, useState } from "react";
import { FiChevronDown, FiChevronRight, FiGitMerge } from "react-icons/fi";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  BILLING_BASE_PATH,
  BILLING_MODULES,
  BILLING_NAV_LABEL,
  billingModulePath,
} from "../../lib/billingReconciliationNav";
import { canAccessFinance } from "../../lib/rbac";
import { useAuth } from "../../lib/auth";

type Props = { onNavigate?: () => void };

export function BillingNavGroup({ onNavigate }: Props) {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const billingActive = location.pathname.startsWith(BILLING_BASE_PATH);
  const onBillingHome = location.pathname === BILLING_BASE_PATH;
  const [open, setOpen] = useState(billingActive);

  useEffect(() => {
    setOpen(location.pathname.startsWith(BILLING_BASE_PATH));
  }, [location.pathname]);

  if (!canAccessFinance(user)) return null;

  return (
    <Collapsible.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
      <Flex
        align="center"
        gap={0}
        borderRadius="md"
        fontSize="sm"
        fontWeight="medium"
        color={billingActive ? "white" : "brand.800"}
        bg={billingActive ? "brand.600" : "transparent"}
        borderLeft="3px solid"
        borderLeftColor={billingActive ? "azure.500" : "transparent"}
        _hover={{
          bg: billingActive ? "brand.700" : "white",
          color: billingActive ? "white" : "brand.700",
        }}
        transition="background 0.15s, color 0.15s"
        w="full"
        overflow="hidden"
      >
        <NavLink
          to={BILLING_BASE_PATH}
          end
          onClick={onNavigate}
          style={{ textDecoration: "none", flex: 1, minWidth: 0, overflow: "hidden" }}
        >
          {() => (
            <Flex align="center" gap={2} px={2} py={3} minH="44px" color="inherit" minW={0}>
              <Box flexShrink={0} lineHeight={0}>
                <FiGitMerge size={16} />
              </Box>
              <Text
                flex={1}
                minW={0}
                lineHeight="short"
                whiteSpace="nowrap"
                overflow="hidden"
                textOverflow="ellipsis"
              >
                {BILLING_NAV_LABEL}
              </Text>
            </Flex>
          )}
        </NavLink>
        <IconButton
          aria-label={open ? "Collapse billing menu" : "Expand billing menu"}
          variant="ghost"
          size="xs"
          minW="28px"
          w="28px"
          h="28px"
          flexShrink={0}
          mr={1}
          color="inherit"
          _hover={{ bg: billingActive ? "brand.700" : "gray.100" }}
          onClick={(e) => {
            e.preventDefault();
            if (!open) {
              setOpen(true);
              if (!onBillingHome) navigate(BILLING_BASE_PATH);
            } else {
              setOpen(false);
            }
          }}
        >
          {open ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
        </IconButton>
      </Flex>

      <Collapsible.Content>
        <Box pl={3} pb={1}>
          {BILLING_MODULES.map((module) => (
            <NavLink
              key={module.id}
              to={billingModulePath(module)}
              onClick={onNavigate}
              style={{ textDecoration: "none" }}
            >
              {({ isActive }) => (
                <SubLink label={module.label} isActive={isActive} />
              )}
            </NavLink>
          ))}
        </Box>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function SubLink({ label, isActive }: { label: string; isActive: boolean }) {
  return (
    <Flex
      align="center"
      gap={2}
      px={2}
      py={2}
      minH="36px"
      borderRadius="md"
      fontSize="xs"
      fontWeight="medium"
      color={isActive ? "brand.700" : "brand.800"}
      bg={isActive ? "white" : "transparent"}
      borderLeft="2px solid"
      borderLeftColor={isActive ? "azure.500" : "transparent"}
      _hover={{ bg: "white", color: "brand.700" }}
      whiteSpace="nowrap"
      overflow="hidden"
      textOverflow="ellipsis"
      title={label}
    >
      {label}
    </Flex>
  );
}
