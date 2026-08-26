import { type FormEvent, useEffect, useState } from "react";
import { Box, Button, Field, Heading, Input, Text, VStack } from "@chakra-ui/react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import { api } from "../lib/api";
import { meetsPasswordPolicy } from "../lib/passwordStrength";
import { PasswordStrengthMeter } from "../components/ui/PasswordStrengthMeter";
import { toaster } from "../components/ui/toaster";
import { BRAND } from "../theme";

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = String(params.get("token") || "").trim();
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(Boolean(token));
  const [tokenValid, setTokenValid] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!token) {
      setChecking(false);
      setTokenValid(false);
      return;
    }
    setChecking(true);
    api
      .validatePasswordResetToken(token)
      .then((res) => {
        if (!cancelled) setTokenValid(Boolean(res.valid));
      })
      .catch(() => {
        if (!cancelled) setTokenValid(false);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

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
      await api.resetPasswordWithToken(token, newPassword);
      setDone(true);
    } catch (err) {
      toaster.create({
        title:
          err instanceof Error
            ? err.message
            : "This reset link is invalid or has expired. Request a new one.",
        type: "error",
      });
      setTokenValid(false);
    } finally {
      setSubmitting(false);
    }
  }

  const invalid = !checking && !done && (!token || !tokenValid);

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
        w="full"
        maxW="420px"
        bg="white"
        borderWidth="1px"
        borderColor="gray.200"
        borderRadius="xl"
        p={8}
        shadow="sm"
      >
        {checking ? (
          <Text color="fg.muted" fontSize="sm">
            Checking reset link…
          </Text>
        ) : done ? (
          <VStack align="stretch" gap={5}>
            <Box>
              <Heading size="lg" mb={1}>
                Password updated
              </Heading>
              <Text color="fg.muted" fontSize="sm">
                Sign in with your new password. Any previous sessions have been signed out.
              </Text>
            </Box>
            <Button asChild colorPalette="blue">
              <RouterLink to="/login">Back to sign in</RouterLink>
            </Button>
          </VStack>
        ) : invalid ? (
          <VStack align="stretch" gap={5}>
            <Box>
              <Heading size="lg" mb={1}>
                This link has expired
              </Heading>
              <Text color="fg.muted" fontSize="sm">
                Request a new password reset link from the sign-in page.
              </Text>
            </Box>
            <Button asChild colorPalette="blue">
              <RouterLink to="/login?recover=1">Request a new link</RouterLink>
            </Button>
          </VStack>
        ) : (
          <Box as="form" onSubmit={handleSubmit}>
            <VStack align="stretch" gap={5}>
              <Box>
                <Heading size="lg" mb={1}>
                  Set a new password
                </Heading>
                <Text color="fg.muted" fontSize="sm">
                  Choose a password for your staff account. This also unlocks the account if it
                  was locked after failed sign-in attempts.
                </Text>
              </Box>

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
                Save password
              </Button>
            </VStack>
          </Box>
        )}
      </Box>
    </Box>
  );
}
