import { Box, Button, Dialog, Flex, Spinner, Text } from "@chakra-ui/react";
import { FiMail } from "react-icons/fi";
import type { BillingCommunicationPreview } from "../../lib/api";
import { sanitizeHtml } from "../../lib/sanitizeHtml";
import { AppDialog } from "../ui/AppDialog";

type Props = {
  open: boolean;
  onOpenChange: (details: { open: boolean }) => void;
  preview: BillingCommunicationPreview | null;
  loading?: boolean;
  onSend?: () => void;
  sending?: boolean;
};

export function BillingEmailPreviewDialog({
  open,
  onOpenChange,
  preview,
  loading,
  onSend,
  sending,
}: Props) {
  const safeHtml = preview?.html ? sanitizeHtml(preview.html) : "";

  return (
    <AppDialog open={open} onOpenChange={onOpenChange} maxW="2xl">
      <Dialog.Header borderBottomWidth="1px" px={4} py={3} pr={12}>
        <Dialog.Title fontSize="md">Email preview</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body px={4} py={4}>
        {loading ? (
          <Flex justify="center" py={8}>
            <Spinner />
          </Flex>
        ) : preview ? (
          <Box>
            <Text fontSize="xs" color="fg.muted" mb={1}>
              To: {preview.email || "—"} {preview.emailSource ? `(${preview.emailSource})` : ""}
            </Text>
            <Text fontSize="sm" fontWeight="semibold" mb={3}>
              Subject: {preview.subject}
            </Text>
            <Box
              border="1px solid"
              borderColor="border"
              borderRadius="md"
              p={3}
              bg="bg.subtle"
              maxH="360px"
              overflow="auto"
              fontSize="sm"
              dangerouslySetInnerHTML={{ __html: safeHtml }}
            />
            {!preview.canSend && (
              <Text fontSize="xs" color="orange.700" mt={2}>
                Cannot send — missing email or Zoho Mail not configured.
              </Text>
            )}
          </Box>
        ) : null}
      </Dialog.Body>
      <Dialog.Footer borderTopWidth="1px" px={4} py={3} gap={2}>
        <Button size="sm" variant="outline" onClick={() => onOpenChange({ open: false })}>
          Close
        </Button>
        {preview?.canSend && onSend && (
          <Button size="sm" colorPalette="brand" loading={sending} onClick={onSend}>
            <FiMail />
            Send via Zoho Mail
          </Button>
        )}
      </Dialog.Footer>
    </AppDialog>
  );
}
