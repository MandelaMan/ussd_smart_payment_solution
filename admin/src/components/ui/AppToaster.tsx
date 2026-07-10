import { Portal, Stack, Toast, Toaster } from "@chakra-ui/react";
import { toaster } from "./toaster";

export function AppToaster() {
  return (
    <Portal>
      <Toaster toaster={toaster} insetInline={{ mdDown: "4" }}>
        {(toast) => (
          <Toast.Root
            w={{ base: "calc(100vw - 2rem)", md: "sm" }}
            maxW="sm"
            alignItems="flex-start"
          >
            <Toast.Indicator mt={0.5} />
            <Stack gap="1" flex="1" minW={0}>
              {toast.title && <Toast.Title>{toast.title}</Toast.Title>}
              {toast.description && (
                <Toast.Description>{toast.description}</Toast.Description>
              )}
            </Stack>
            <Toast.CloseTrigger />
          </Toast.Root>
        )}
      </Toaster>
    </Portal>
  );
}
