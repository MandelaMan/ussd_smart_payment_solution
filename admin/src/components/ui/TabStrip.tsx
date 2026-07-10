import { Box, Button, Flex, Text } from "@chakra-ui/react";
import { SelectField } from "./SelectField";

export type TabItem = {
  id: string;
  label: string;
};

type Props = {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
};

export function TabStrip({ tabs, active, onChange }: Props) {
  const activeLabel = tabs.find((tab) => tab.id === active)?.label ?? "Section";

  return (
    <Box borderBottom="1px solid" borderColor="brand.100" bg="white" w="full">
      {/* Mobile: section picker — avoids cramped equal-width tabs */}
      <Box display={{ base: "block", md: "none" }} px={3} py={2.5}>
        <Text fontSize="2xs" fontWeight="medium" color="gray.500" mb={1.5}>
          Section
        </Text>
        <SelectField
          size="sm"
          fieldProps={{
            value: active,
            "aria-label": `Section: ${activeLabel}`,
            onChange: (e) => onChange(e.target.value),
            borderRadius: "md",
            bg: "gray.50",
            borderColor: "gray.200",
            fontWeight: "semibold",
            color: "brand.800",
            _focusVisible: {
              borderColor: "brand.500",
              boxShadow: "0 0 0 1px var(--chakra-colors-brand-500)",
            },
          }}
        >
          {tabs.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.label}
            </option>
          ))}
        </SelectField>
      </Box>

      {/* Desktop: underline tab strip */}
      <Box display={{ base: "none", md: "block" }} px={4}>
        <Flex gap={0} w="full" overflow="hidden">
          {tabs.map((tab) => {
            const isActive = tab.id === active;
            return (
              <Button
                key={tab.id}
                type="button"
                variant="ghost"
                size="sm"
                borderRadius={0}
                flex="none"
                minW={0}
                px={4}
                py={3}
                h="auto"
                minH="44px"
                fontWeight={isActive ? "semibold" : "medium"}
                fontSize="sm"
                color={isActive ? "brand.700" : "gray.600"}
                borderBottom="3px solid"
                borderColor={isActive ? "brand.600" : "transparent"}
                mb="-1px"
                whiteSpace="nowrap"
                _hover={{ bg: "brand.50", color: "brand.700" }}
                onClick={() => onChange(tab.id)}
              >
                {tab.label}
              </Button>
            );
          })}
        </Flex>
      </Box>
    </Box>
  );
}
