import { Box, Collapsible, Icon, Text } from "@chakra-ui/react";
import { useState, type ReactNode } from "react";
import { FiChevronDown, FiChevronRight } from "react-icons/fi";
import { BRAND } from "../../theme";

type Props = {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

export function BiSection({ title, subtitle, defaultOpen = true, children }: Props) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Box
      bg="white"
      border="1px solid"
      borderColor="gray.100"
      borderRadius="xl"
      boxShadow="sm"
      overflow="hidden"
    >
      <Collapsible.Root open={open} onOpenChange={(e) => setOpen(e.open)}>
        <Collapsible.Trigger
          w="100%"
          display="flex"
          px={{ base: 4, md: 5 }}
          py={4}
          alignItems="center"
          justifyContent="space-between"
          gap={3}
          bg="gray.50"
          borderBottomWidth={open ? "1px" : 0}
          borderColor="gray.100"
          cursor="pointer"
          _hover={{ bg: "gray.100" }}
        >
          <Box textAlign="left">
            <Text fontSize="md" fontWeight="semibold" color="gray.800">
              {title}
            </Text>
            {subtitle && (
              <Text fontSize="xs" color="gray.500" mt={0.5}>
                {subtitle}
              </Text>
            )}
          </Box>
          <Icon
            as={open ? FiChevronDown : FiChevronRight}
            boxSize={5}
            color={BRAND.cerulean}
            flexShrink={0}
          />
        </Collapsible.Trigger>
        <Collapsible.Content>
          <Box p={{ base: 4, md: 5 }}>{children}</Box>
        </Collapsible.Content>
      </Collapsible.Root>
    </Box>
  );
}
