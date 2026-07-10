import {
  Box,
  Flex,
  IconButton,
  Input,
  Text,
  type InputProps,
} from "@chakra-ui/react";
import { useState } from "react";
import { FiCalendar, FiX } from "react-icons/fi";

type Props = Omit<InputProps, "type" | "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  placeholder?: string;
};

const SHELL_HEIGHT = {
  xs: "28px",
  sm: "32px",
  md: "40px",
  lg: "44px",
} as const;

export function DateField({
  value,
  onChange,
  onClear,
  min,
  max,
  size = "sm",
  disabled,
  placeholder = "Select date",
  ...rest
}: Props) {
  const [focused, setFocused] = useState(false);
  const hasValue = Boolean(value);
  const showPlaceholder = !hasValue && !focused;
  const shellHeight = SHELL_HEIGHT[size as keyof typeof SHELL_HEIGHT] ?? SHELL_HEIGHT.sm;
  const iconSize = size === "lg" ? 16 : 14;

  function handleClear() {
    if (onClear) onClear();
    else onChange("");
  }

  return (
    <Flex
      align="center"
      gap={2}
      h={shellHeight}
      px={3}
      borderWidth="1px"
      borderColor={hasValue ? "brand.200" : "gray.200"}
      borderRadius="md"
      bg="white"
      boxShadow="sm"
      position="relative"
      transition="border-color 0.15s, box-shadow 0.15s"
      _focusWithin={{
        borderColor: "brand.500",
        boxShadow: "0 0 0 1px var(--chakra-colors-brand-500)",
      }}
      opacity={disabled ? 0.65 : 1}
      cursor={disabled ? "not-allowed" : "pointer"}
    >
      <Box color={hasValue ? "brand.600" : "gray.400"} flexShrink={0} aria-hidden>
        <FiCalendar size={iconSize} />
      </Box>

      <Box flex={1} position="relative" minW={0} h="full" overflow="hidden">
        {showPlaceholder ? (
          <Text
            fontSize={size === "sm" ? "sm" : "md"}
            color="gray.400"
            position="absolute"
            left={0}
            right={0}
            top="50%"
            transform="translateY(-50%)"
            pointerEvents="none"
            userSelect="none"
            lineHeight="1"
            whiteSpace="nowrap"
            overflow="hidden"
            textOverflow="ellipsis"
          >
            {placeholder}
          </Text>
        ) : null}

        <Input
          type="date"
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          size={size}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          variant="outline"
          borderWidth={0}
          boxShadow="none"
          w="full"
          h="full"
          minH="unset"
          px={0}
          py={0}
          color={hasValue || focused ? "gray.800" : "transparent"}
          fontWeight={hasValue ? "medium" : "normal"}
          fontSize={size === "sm" ? "sm" : "md"}
          lineHeight="1"
          className={`date-field-native${hasValue ? " date-field-has-value" : ""}`}
          _focus={{
            boxShadow: "none",
            outline: "none",
          }}
          _focusVisible={{
            boxShadow: "none",
            outline: "none",
          }}
          css={{
            "&::-webkit-calendar-picker-indicator": {
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              margin: 0,
              padding: 0,
              opacity: 0,
              cursor: disabled ? "not-allowed" : "pointer",
            },
          }}
          {...rest}
        />
      </Box>

      {hasValue && !disabled ? (
        <IconButton
          aria-label="Clear date"
          variant="ghost"
          size="xs"
          minW="24px"
          h="24px"
          color="gray.400"
          _hover={{ color: "gray.700", bg: "gray.100" }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            handleClear();
          }}
        >
          <FiX size={14} />
        </IconButton>
      ) : null}
    </Flex>
  );
}
