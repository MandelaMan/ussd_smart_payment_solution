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
  /** Hug label width instead of stretching tabs across the full row. */
  fitContent?: boolean;
};

export function TabStrip({ tabs, active, onChange, fitContent = false }: Props) {
  const activeLabel = tabs.find((tab) => tab.id === active)?.label ?? "Section";

  return (
    <Box
      borderBottom="1px solid"
      borderColor={{ _light: "brand.100", _dark: "border" }}
      bg="bg.panel"
      w="full"
      minW={0}
      overflow="hidden"
    >
      {/* Mobile: section picker — avoids cramped equal-width tabs */}
      <Box display={{ base: "block", md: "none" }} px={{ base: 2.5, sm: 3 }} py={2}>
        <Text fontSize="2xs" fontWeight="medium" color="fg.muted" mb={1.5}>
          Section
        </Text>
        <SelectField
          size="sm"
          fieldProps={{
            value: active,
            "aria-label": `Section: ${activeLabel}`,
            onChange: (e) => onChange(e.target.value),
            borderRadius: "md",
            bg: "bg.subtle",
            borderColor: "border",
            fontWeight: "semibold",
            color: { _light: "brand.800", _dark: "brand.200" },
            minH: "44px",
            fontSize: "16px",
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

      {/* Desktop tabs */}
      <Box
        display={{ base: "none", md: "block" }}
        px={{ md: fitContent ? 4 : 2, lg: fitContent ? 5 : 3 }}
        pt={fitContent ? 1 : 0}
        overflow="hidden"
      >
        <Flex
          gap={fitContent ? 1 : 0}
          w={fitContent ? "auto" : "full"}
          minW={0}
          overflow="hidden"
        >
          {tabs.map((tab) => {
            const isActive = tab.id === active;
            return (
              <Button
                key={tab.id}
                type="button"
                variant="ghost"
                size="sm"
                borderRadius={0}
                flex={fitContent ? "0 0 auto" : "1 1 0"}
                minW={0}
                px={{ md: fitContent ? 3 : 2, lg: fitContent ? 4 : 3 }}
                py={fitContent ? 2.5 : 3}
                h="auto"
                minH={fitContent ? "40px" : "44px"}
                fontWeight={isActive ? "semibold" : "medium"}
                fontSize={{ md: "xs", lg: "sm" }}
                color={
                  isActive
                    ? { _light: "brand.700", _dark: "brand.300" }
                    : "fg.muted"
                }
                borderBottom="3px solid"
                borderColor={isActive ? "brand.600" : "transparent"}
                mb="-1px"
                whiteSpace="nowrap"
                overflow="hidden"
                textOverflow="ellipsis"
                _hover={{
                  bg: { _light: "brand.50", _dark: "brand.900" },
                  color: { _light: "brand.700", _dark: "brand.300" },
                }}
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
