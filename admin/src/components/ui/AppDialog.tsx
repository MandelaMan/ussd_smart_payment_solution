import { Dialog, IconButton, Portal, type DialogRootProps } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { FiX } from "react-icons/fi";
import { MODAL_Z_INDEX } from "./ModalShell";

export const APP_DIALOG_Z_INDEX = 1700;
/** Stacked above ModalShell when a dialog opens inside another modal. */
export const NESTED_APP_DIALOG_Z_INDEX = MODAL_Z_INDEX + 50;

type Props = {
  open: boolean;
  onOpenChange?: (details: { open: boolean }) => void;
  children: ReactNode;
  maxW?: string;
  /** Nearly fills the viewport — useful for data-heavy dialogs. */
  nearFullScreen?: boolean;
  zIndex?: number;
  showCloseButton?: boolean;
} & Omit<
  DialogRootProps,
  "open" | "onOpenChange" | "children" | "closeOnInteractOutside"
>;

export function AppDialog({
  open,
  onOpenChange,
  children,
  maxW = "lg",
  nearFullScreen = false,
  zIndex = APP_DIALOG_Z_INDEX,
  showCloseButton = true,
  ...rootProps
}: Props) {
  function requestClose() {
    onOpenChange?.({ open: false });
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={onOpenChange}
      closeOnInteractOutside={false}
      lazyMount={false}
      {...rootProps}
    >
      <Portal>
        <Dialog.Backdrop
          bg="blackAlpha.600"
          zIndex={zIndex}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              requestClose();
            }
          }}
        />
        <Dialog.Positioner
          zIndex={zIndex}
          display="flex"
          alignItems={nearFullScreen ? "stretch" : { base: "stretch", sm: "center" }}
          justifyContent="center"
          p={nearFullScreen ? { base: 3, sm: 4, md: 6 } : { base: 0, sm: 4 }}
          inset={0}
          overflow="hidden"
        >
          <Dialog.Content
            borderRadius={nearFullScreen ? "xl" : { base: 0, sm: "xl" }}
            mx={nearFullScreen ? 0 : { base: 0, sm: 4 }}
            mb={0}
            w="full"
            h={nearFullScreen ? undefined : { base: "100dvh", sm: "auto" }}
            maxW={nearFullScreen ? "100%" : { base: "100%", sm: maxW }}
            maxH={nearFullScreen ? "100%" : { base: "100dvh", sm: "calc(100dvh - 2rem)" }}
            minH={0}
            alignSelf={nearFullScreen ? "stretch" : undefined}
            overflow="hidden"
            display="flex"
            flexDirection="column"
            bg="bg.panel"
            boxShadow="xl"
            borderWidth={nearFullScreen ? "1px" : { base: 0, sm: "1px" }}
            borderColor="border"
            zIndex={zIndex + 1}
            position="relative"
            pb={
              nearFullScreen
                ? 0
                : { base: "env(safe-area-inset-bottom, 0px)", sm: 0 }
            }
            pt={
              nearFullScreen
                ? 0
                : { base: "env(safe-area-inset-top, 0px)", sm: 0 }
            }
          >
            {showCloseButton ? (
              <IconButton
                aria-label="Close"
                variant="ghost"
                size="sm"
                position="absolute"
                top={{ base: "calc(0.75rem + env(safe-area-inset-top, 0px))", sm: 3 }}
                right={3}
                zIndex={2}
                color="fg.muted"
                borderRadius="full"
                _hover={{ bg: "bg.muted", color: "fg" }}
                onClick={requestClose}
              >
                <FiX size={18} />
              </IconButton>
            ) : null}
            {children}
          </Dialog.Content>
        </Dialog.Positioner>
      </Portal>
    </Dialog.Root>
  );
}
