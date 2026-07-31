import { Box, Button, Flex, Heading } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { scrollAppToTop } from "../ScrollToTop";
import { ModalShell } from "./ModalShell";

type MobileFilterSheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  onClear?: () => void;
  clearLabel?: string;
  /** When true (default), scroll the page to top after closing / showing results. */
  scrollToTopOnClose?: boolean;
};

export function MobileFilterSheet({
  open,
  onClose,
  title = "Filters",
  children,
  onClear,
  clearLabel = "Clear all",
  scrollToTopOnClose = true,
}: MobileFilterSheetProps) {
  function closeAndRevealResults() {
    onClose();
    if (scrollToTopOnClose) {
      scrollAppToTop();
      requestAnimationFrame(() => scrollAppToTop());
    }
  }

  return (
    <ModalShell
      open={open}
      onClose={closeAndRevealResults}
      maxW="28rem"
      variant="sheet"
      closeOnBackdropClick
    >
      <Flex
        direction="column"
        w="full"
        maxW="100%"
        px={4}
        pt={3}
        pb={4}
        gap={4}
        h={{ base: "100%", lg: "auto" }}
        maxH={{ base: "100%", lg: "min(85dvh, 100%)" }}
        minH={0}
      >
        <Flex align="center" justify="space-between" gap={3} pr={10}>
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

        <Box overflowY="auto" flex={1} minH={0} w="full">
          <Flex
            direction="column"
            gap={4}
            w="full"
            align="stretch"
            css={{
              "& > *": {
                width: "100% !important",
                maxWidth: "100% !important",
                flex: "0 0 auto !important",
                alignSelf: "stretch !important",
              },
            }}
          >
            {children}
          </Flex>
        </Box>

        <Button type="button" colorPalette="brand" w="full" onClick={closeAndRevealResults}>
          Show results
        </Button>
      </Flex>
    </ModalShell>
  );
}
