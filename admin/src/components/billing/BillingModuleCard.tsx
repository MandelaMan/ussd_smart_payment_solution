import { Box, Flex, Text } from "@chakra-ui/react";
import { FiChevronRight } from "react-icons/fi";
import { Link as RouterLink } from "react-router-dom";
import type { BillingModuleDef } from "../../lib/billingReconciliationNav";

type Props = {
  module: BillingModuleDef;
  count: number;
};

export function BillingModuleCard({ module, count }: Props) {
  return (
    <RouterLink to={`/billing/${module.path}`} style={{ textDecoration: "none" }}>
      <Box
        p={3}
        bg="white"
        border="1px solid"
        borderColor="brand.100"
        borderRadius="md"
        _hover={{ borderColor: "brand.300", bg: "brand.50" }}
        transition="border-color 0.15s, background 0.15s"
      >
      <Flex justify="space-between" align="flex-start" gap={2}>
        <Box minW={0} flex={1}>
          <Text fontSize="sm" fontWeight="semibold" color="brand.800">
            {module.label}
          </Text>
          <Text fontSize="xs" color="gray.600" mt={0.5} lineClamp={2}>
            {module.description}
          </Text>
        </Box>
        <Flex align="center" gap={1} flexShrink={0}>
          <Text fontSize="lg" fontWeight="bold" color={count > 0 ? "orange.600" : "green.600"}>
            {count}
          </Text>
          <FiChevronRight size={14} color="var(--chakra-colors-gray-400)" />
        </Flex>
      </Flex>
      </Box>
    </RouterLink>
  );
}
