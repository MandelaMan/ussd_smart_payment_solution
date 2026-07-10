import { Box, Button, Flex, Heading } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { ModalShell } from "./ModalShell";

type MobileFilterSheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  onClear?: () => void;
  clearLabel?: string;
};

export function MobileFilterSheet({
  open,
  onClose,
  title = "Filters",
  children,
  onClear,
  clearLabel = "Clear all",
}: MobileFilterSheetProps) {
  return (
    <ModalShell open={open} onClose={onClose} maxW="28rem" closeOnBackdropClick>
      <Flex
        direction="column"
        px={4}
        pt={3}
        pb={4}
        pr={12}
        gap={4}
        h={{ base: "100%", sm: "auto" }}
        maxH={{ base: "100%", sm: "min(85dvh, 100%)" }}
        minH={0}
      >
        <Flex align="center" justify="space-between" gap={3}>
          <Heading size="md">{title}</Heading>
          {onClear ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              color="brand.600"
              onClick={onClear}
            >
              {clearLabel}
            </Button>
          ) : null}
        </Flex>

        <Box overflowY="auto" flex={1} minH={0}>
          <Flex direction="column" gap={4}>
            {children}
          </Flex>
        </Box>

        <Button type="button" colorPalette="brand" w="full" onClick={onClose}>
          Show results
        </Button>
      </Flex>
    </ModalShell>
  );
}

/** Count how many filter values differ from their defaults. */
export function countActiveFilters(
  entries: Array<{ value: string | undefined | null; defaultValue?: string }>
) {
  return entries.filter(({ value, defaultValue = "" }) => {
    const v = (value ?? "").trim();
    const d = (defaultValue ?? "").trim();
    return v !== "" && v !== d;
  }).length;
}
