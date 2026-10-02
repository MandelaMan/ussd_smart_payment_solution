import { useState } from "react";
import { Box, Button, Dialog, Flex, Stack, Text } from "@chakra-ui/react";
import { AppDialog } from "../ui/AppDialog";

export type CustomerIntake = "new" | "existing";

type Props = {
  open: boolean;
  onClose: () => void;
  onContinue: (intake: CustomerIntake) => void;
};

const OPTIONS: { value: CustomerIntake; title: string; detail: string }[] = [
  {
    value: "new",
    title: "Add New Customer",
    detail: "Sends the onboarding invoice.",
  },
  {
    value: "existing",
    title: "Add Existing Customer",
    detail: "No onboarding invoice. DSTV Only is not created on TISP.",
  },
];

export function AddCustomerChoiceDialog({ open, onClose, onContinue }: Props) {
  const [intake, setIntake] = useState<CustomerIntake | null>(null);

  function close() {
    setIntake(null);
    onClose();
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={(details) => {
        if (!details.open) close();
      }}
      maxW="md"
    >
      <Dialog.Header borderBottomWidth="1px" borderColor="border.muted" px={5} py={4} pr={12}>
        <Dialog.Title fontSize="lg">Add customer</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body px={5} py={4}>
        <Text fontSize="sm" color="fg.muted" mb={3}>
          Choose one. The form is the same either way.
        </Text>
        <Stack gap={2} role="radiogroup" aria-label="Customer type to add">
          {OPTIONS.map((option) => {
            const selected = intake === option.value;
            return (
              <Box
                key={option.value}
                as="button"
                role="radio"
                aria-checked={selected}
                textAlign="left"
                w="full"
                px={3}
                py={3}
                borderWidth="1px"
                borderRadius="lg"
                borderColor={selected ? "brand.500" : "border"}
                bg={selected ? "brand.50" : "bg.panel"}
                onClick={() => setIntake(option.value)}
              >
                <Flex align="flex-start" gap={3}>
                  <Box
                    mt="3px"
                    boxSize="16px"
                    borderRadius="full"
                    borderWidth="2px"
                    borderColor={selected ? "brand.600" : "border"}
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                    flexShrink={0}
                  >
                    {selected ? (
                      <Box boxSize="8px" borderRadius="full" bg="brand.600" />
                    ) : null}
                  </Box>
                  <Box>
                    <Text fontWeight="semibold" fontSize="sm">
                      {option.title}
                    </Text>
                    <Text fontSize="xs" color="fg.muted" mt={1}>
                      {option.detail}
                    </Text>
                  </Box>
                </Flex>
              </Box>
            );
          })}
        </Stack>
      </Dialog.Body>
      <Dialog.Footer px={5} py={3} borderTopWidth="1px" borderColor="border.muted" gap={2}>
        <Button variant="ghost" onClick={close}>
          Cancel
        </Button>
        <Button
          colorPalette="brand"
          disabled={!intake}
          onClick={() => {
            if (!intake) return;
            const chosen = intake;
            setIntake(null);
            onContinue(chosen);
          }}
        >
          Continue
        </Button>
      </Dialog.Footer>
    </AppDialog>
  );
}
