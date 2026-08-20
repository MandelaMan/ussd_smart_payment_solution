import { Box, Flex, Text } from "@chakra-ui/react";
import { scorePassword } from "../../lib/passwordStrength";

const SEGMENTS = 4;

export function PasswordStrengthMeter({ password }: { password: string }) {
  const strength = scorePassword(password);
  const filled = strength.score;

  return (
    <Box mt={2}>
      <Flex gap="5px" aria-hidden>
        {Array.from({ length: SEGMENTS }, (_, index) => (
          <Box
            key={index}
            flex="1"
            h="6px"
            borderRadius="full"
            bg={index < filled ? strength.color : "gray.200"}
            transition="background-color 0.2s ease"
          />
        ))}
      </Flex>
      <Text
        mt={1.5}
        fontSize="xs"
        fontWeight="medium"
        color={strength.label ? strength.color : "fg.muted"}
        aria-live="polite"
      >
        {strength.label
          ? `Password strength: ${strength.label}`
          : "At least 8 characters with a letter and a number."}
      </Text>
    </Box>
  );
}
