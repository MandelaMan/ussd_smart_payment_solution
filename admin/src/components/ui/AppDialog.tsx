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
        <Dialog.Positioner zIndex={zIndex}>
          <Dialog.Content
            borderRadius="xl"
            mx={4}
            w="full"
            maxW={maxW}
            overflow="hidden"
            bg="white"
            boxShadow="xl"
            borderWidth="1px"
            borderColor="gray.200"
            zIndex={zIndex + 1}
            position="relative"
          >
            {showCloseButton ? (
              <IconButton
                aria-label="Close"
                variant="ghost"
                size="sm"
                position="absolute"
                top={3}
                right={3}
                zIndex={2}
                color="gray.500"
                borderRadius="full"
                _hover={{ bg: "gray.100", color: "gray.700" }}
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
