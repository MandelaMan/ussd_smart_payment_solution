import { type FormEvent, useState } from "react";
import { Box, Button, Field, Heading, Input, Text, VStack } from "@chakra-ui/react";
import { Navigate } from "react-router-dom";
import { api } from "../lib/api";
import { meetsPasswordPolicy } from "../lib/passwordStrength";
import { useAuth } from "../lib/authContext";
import { PasswordStrengthMeter } from "../components/ui/PasswordStrengthMeter";
import { toaster } from "../components/ui/toaster";
import { BRAND } from "../theme";

export function ChangePasswordPage() {
  const { user, refresh } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!user.mustChangePassword) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      toaster.create({ title: "Passwords do not match", type: "error" });
      return;
    }
    if (!meetsPasswordPolicy(newPassword)) {
      toaster.create({
        title: "Password must be at least 8 characters with a letter and a number",
        type: "error",
      });
      return;
    }
    setSubmitting(true);
    try {
      await api.changePassword({
        currentPassword: currentPassword || undefined,
        newPassword,
      });
      await refresh();
      toaster.create({ title: "Password updated", type: "success" });
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Failed to change password",
        type: "error",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box
      minH="100dvh"
      display="flex"
      alignItems="center"
      justifyContent="center"
      px={4}
      bg={`linear-gradient(160deg, ${BRAND.cerulean}14, white 45%)`}
    >
      <Box
        as="form"
        onSubmit={handleSubmit}
        w="full"
        maxW="420px"
        bg="white"
        borderWidth="1px"
        borderColor="gray.200"
        borderRadius="xl"
        p={8}
        shadow="sm"
      >
        <VStack align="stretch" gap={5}>
          <Box>
            <Heading size="lg" mb={1}>
              Set a new password
            </Heading>
            <Text color="fg.muted" fontSize="sm">
              Your temporary password must be changed before continuing.
            </Text>
          </Box>

          {!user.mustChangePassword ? null : (
            <Field.Root>
              <Field.Label>Current temporary password</Field.Label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field.Root>
          )}

          <Field.Root required>
            <Field.Label>New password</Field.Label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <PasswordStrengthMeter password={newPassword} />
          </Field.Root>

          <Field.Root required>
            <Field.Label>Confirm new password</Field.Label>
            <Input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </Field.Root>

          <Button type="submit" colorPalette="blue" loading={submitting}>
            Save password & continue
          </Button>
        </VStack>
      </Box>
    </Box>
  );
}
