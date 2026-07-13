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
  /**
   * `sheet` — edge-to-edge below the `lg` breakpoint (mobile filter/sort panels).
   * `dialog` — centered card from `sm` up (default).
   */
  variant?: "dialog" | "sheet";
};

export function ModalShell({
  open,
  onClose,
  children,
  maxW = "32rem",
  closeOnBackdropClick = false,
  showCloseButton = true,
  variant = "dialog",
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

  const sheet = variant === "sheet";

  return (
    <Portal>
      <Box
        position="fixed"
        inset={0}
        zIndex={MODAL_Z_INDEX}
        display="flex"
        alignItems={sheet ? { base: "stretch", lg: "center" } : { base: "stretch", sm: "center" }}
        justifyContent="center"
        px={sheet ? { base: 0, lg: 4 } : { base: 0, sm: 4 }}
        py={sheet ? { base: 0, lg: 4 } : { base: 0, sm: 4 }}
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
          h={sheet ? { base: "100dvh", lg: "auto" } : { base: "100dvh", sm: "auto" }}
          maxW={sheet ? { base: "100%", lg: maxW } : { base: "100%", sm: maxW }}
          maxH={
            sheet
              ? { base: "100dvh", lg: "calc(100dvh - 2rem)" }
              : { base: "100dvh", sm: "calc(100dvh - 2rem)" }
          }
          bg="bg.panel"
          borderRadius={sheet ? { base: 0, lg: "xl" } : { base: 0, sm: "xl" }}
          boxShadow="xl"
          borderWidth={sheet ? { base: "0", lg: "1px" } : { base: "0", sm: "1px" }}
          borderColor="border"
          overflow="hidden"
          display="flex"
          flexDirection="column"
          pt={
            sheet
              ? { base: "env(safe-area-inset-top, 0px)", lg: 0 }
              : { base: "env(safe-area-inset-top, 0px)", sm: 0 }
          }
          pb={
            sheet
              ? { base: "env(safe-area-inset-bottom, 0px)", lg: 0 }
              : { base: "env(safe-area-inset-bottom, 0px)", sm: 0 }
          }
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          {showCloseButton ? (
            <IconButton
              aria-label="Close"
              variant="ghost"
              size="sm"
              position="absolute"
              top={
                sheet
                  ? { base: "calc(0.5rem + env(safe-area-inset-top, 0px))", lg: 3 }
                  : { base: "calc(0.5rem + env(safe-area-inset-top, 0px))", sm: 3 }
              }
              right={sheet ? { base: 2, lg: 3 } : { base: 2, sm: 3 }}
              zIndex={2}
              color="fg.muted"
              borderRadius="full"
              _hover={{ bg: "bg.muted", color: "fg" }}
              onClick={onClose}
            >
              <FiX size={18} />
            </IconButton>
          ) : null}
          <Box overflowY="auto" flex={1} minH={0} w="full">
            {children}
          </Box>
        </Box>
      </Box>
    </Portal>
  );
}
