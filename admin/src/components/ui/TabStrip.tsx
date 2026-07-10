import { Box, Button, Flex } from "@chakra-ui/react";

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
  return (
    <Box borderBottom="1px solid" borderColor="brand.100" bg="white" w="full" px={{ base: 3, md: 4 }}>
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
              flex={{ base: 1, md: "none" }}
              minW={0}
              px={{ base: 2, md: 4 }}
              py={3}
              h="auto"
              minH="44px"
              fontWeight={isActive ? "semibold" : "medium"}
              fontSize={{ base: "xs", md: "sm" }}
              color={isActive ? "brand.700" : "gray.600"}
              borderBottom="3px solid"
              borderColor={isActive ? "brand.600" : "transparent"}
              mb="-1px"
              whiteSpace="nowrap"
              overflow="hidden"
              textOverflow="ellipsis"
              _hover={{ bg: "brand.50", color: "brand.700" }}
              onClick={() => onChange(tab.id)}
            >
              {tab.label}
            </Button>
          );
        })}
      </Flex>
    </Box>
  );
}
