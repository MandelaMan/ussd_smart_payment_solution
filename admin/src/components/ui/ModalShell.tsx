import { Box, IconButton, Portal } from "@chakra-ui/react";
import { useEffect, type ReactNode } from "react";
import { FiX } from "react-icons/fi";

export const MODAL_Z_INDEX = 2000;

type Props = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  maxW?: string;
  /** Off by default — native selects render outside the panel and backdrop clicks would dismiss the modal. */
  closeOnBackdropClick?: boolean;
  /** Top-right close control (in addition to footer Cancel actions). */
  showCloseButton?: boolean;
};

export function ModalShell({
  open,
  onClose,
  children,
  maxW = "32rem",
  closeOnBackdropClick = false,
  showCloseButton = true,
}: Props) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <Portal>
      <Box
        position="fixed"
        inset={0}
        zIndex={MODAL_Z_INDEX}
        display="flex"
        alignItems={{ base: "flex-end", sm: "center" }}
        justifyContent="center"
        px={{ base: 0, sm: 4 }}
        py={{ base: 0, sm: 4 }}
        bg="blackAlpha.600"
        overflow="hidden"
        onMouseDown={
          closeOnBackdropClick
            ? (event) => {
                if (event.target === event.currentTarget) onClose();
              }
            : undefined
        }
      >
        <Box
          role="dialog"
          aria-modal="true"
          position="relative"
          w="full"
          maxW={{ base: "full", sm: maxW }}
          maxH={{ base: "min(92dvh, 100%)", sm: "calc(100dvh - 2rem)" }}
          bg="white"
          borderRadius={{ base: "2xl 2xl 0 0", sm: "xl" }}
          boxShadow="xl"
          borderWidth={{ base: "0", sm: "1px" }}
          borderColor="gray.200"
          overflow="hidden"
          display="flex"
          flexDirection="column"
          pb={{ base: "env(safe-area-inset-bottom, 0px)", sm: 0 }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {showCloseButton ? (
            <IconButton
              aria-label="Close"
              variant="ghost"
              size="sm"
              position="absolute"
              top={{ base: 2, sm: 3 }}
              right={{ base: 2, sm: 3 }}
              zIndex={2}
              color="gray.500"
              borderRadius="full"
              _hover={{ bg: "gray.100", color: "gray.700" }}
              onClick={onClose}
            >
              <FiX size={18} />
            </IconButton>
          ) : null}
          <Box
            display={{ base: "block", sm: "none" }}
            w="10"
            h="1"
            bg="gray.300"
            borderRadius="full"
            mx="auto"
            mt={2}
            mb={1}
            flexShrink={0}
          />
          <Box overflowY="auto" flex={1} minH={0}>
            {children}
          </Box>
        </Box>
      </Box>
    </Portal>
  );
}
