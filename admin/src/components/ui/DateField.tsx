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
import { FILTER_CONTROL_HEIGHT } from "../../theme";

type Props = Omit<InputProps, "type" | "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  placeholder?: string;
};

const SHELL_HEIGHT = {
  xs: "28px",
  sm: FILTER_CONTROL_HEIGHT,
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
      w="full"
      minW={0}
      align="center"
      gap={2}
      h={shellHeight}
      minH={shellHeight}
      px={3}
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      bg="bg.panel"
      boxShadow="sm"
      position="relative"
      boxSizing="border-box"
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
            fontSize="sm"
            color="fg.subtle"
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
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          variant="outline"
          borderWidth={0}
          boxShadow="none"
          w="full"
          minW={0}
          h="full"
          minH="unset"
          px={0}
          py={0}
          color={hasValue || focused ? "fg" : "transparent"}
          fontWeight="normal"
          fontSize="sm"
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
          color="fg.subtle"
          _hover={{ color: "fg", bg: "bg.muted" }}
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
