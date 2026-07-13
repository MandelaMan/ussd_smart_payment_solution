import {
  Box,
  Flex,
  IconButton,
  Input,
  Text,
  type InputProps,
} from "@chakra-ui/react";
import { useEffect, useId, useRef, useState } from "react";
import { FiChevronDown, FiX } from "react-icons/fi";
import {
  SUBSCRIPTION_STATUS_FILTER_OPTIONS,
  type SubscriptionStatusLabel,
} from "../../lib/customerStatus";
import { fieldControlStyles, FILTER_CONTROL_HEIGHT } from "../../theme";

type Props = {
  value: SubscriptionStatusLabel[];
  onChange: (value: SubscriptionStatusLabel[]) => void;
  disabled?: boolean;
  isLoading?: boolean;
  size?: InputProps["size"];
  placeholder?: string;
};

export function StatusMultiSelect({
  value,
  onChange,
  disabled = false,
  isLoading = false,
  size = "sm",
  placeholder = "All statuses",
}: Props) {
  const isDisabled = disabled || isLoading;
  const resolvedPlaceholder = isLoading ? "Loading…" : placeholder;
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const shellHeight = size === "sm" ? FILTER_CONTROL_HEIGHT : "40px";

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const filtered = SUBSCRIPTION_STATUS_FILTER_OPTIONS.filter((option) =>
    option.label.toLowerCase().includes(query.trim().toLowerCase())
  );

  function toggleOption(option: SubscriptionStatusLabel) {
    if (isDisabled) return;
    const next = value.includes(option)
      ? value.filter((v) => v !== option)
      : [...value, option];
    onChange(next);
  }

  function removeOption(option: SubscriptionStatusLabel) {
    if (isDisabled) return;
    onChange(value.filter((v) => v !== option));
  }

  function clearAll() {
    if (isDisabled) return;
    onChange([]);
    setQuery("");
  }

  return (
    <Box ref={rootRef} position="relative" w="full">
      <Flex
        align="center"
        gap={1}
        h={value.length === 0 ? shellHeight : undefined}
        minH={shellHeight}
        px={2}
        py={1}
        borderWidth="1px"
        borderColor={open ? "brand.500" : "gray.200"}
        borderRadius="md"
        bg={isDisabled ? "gray.50" : "white"}
        boxShadow={open ? "0 0 0 1px var(--chakra-colors-brand-500)" : fieldControlStyles.boxShadow}
        cursor={isDisabled ? "not-allowed" : "text"}
        opacity={isDisabled ? 0.65 : 1}
        onClick={() => {
          if (isDisabled) return;
          setOpen(true);
        }}
      >
        <Flex align="center" gap={1} flex={1} minW={0} flexWrap="wrap">
          {value.length === 0 ? (
            <Text fontSize="sm" color="fg.subtle" px={1} userSelect="none">
              {resolvedPlaceholder}
            </Text>
          ) : (
            value.map((status) => (
              <Flex
                key={status}
                align="center"
                gap={1}
                px={2}
                py={0.5}
                borderRadius="md"
                bg="bg.muted"
                border="1px solid"
                borderColor="border"
                maxW="full"
                onClick={(e) => e.stopPropagation()}
              >
                <Text fontSize="xs" fontWeight="semibold" color="fg" textTransform="uppercase">
                  {status}
                </Text>
                <IconButton
                  aria-label={`Remove ${status}`}
                  variant="ghost"
                  size="xs"
                  minW="16px"
                  h="16px"
                  p={0}
                  color="fg.muted"
                  disabled={isDisabled}
                  _hover={{ color: "fg", bg: "gray.200" }}
                  onClick={() => removeOption(status)}
                >
                  <FiX size={12} />
                </IconButton>
              </Flex>
            ))
          )}
          {open && !isDisabled ? (
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              variant="flushed"
              size="xs"
              minW="72px"
              flex={1}
              px={1}
              borderWidth={0}
              boxShadow="none"
              _focus={{ boxShadow: "none" }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setOpen(false);
                  setQuery("");
                }
              }}
            />
          ) : null}
        </Flex>

        <Flex align="center" gap={0} flexShrink={0} onClick={(e) => e.stopPropagation()}>
          {value.length > 0 ? (
            <IconButton
              aria-label="Clear statuses"
              variant="ghost"
              size="xs"
              color="fg.subtle"
              disabled={isDisabled}
              onClick={clearAll}
            >
              <FiX size={14} />
            </IconButton>
          ) : null}
          <IconButton
            aria-label="Toggle status list"
            aria-expanded={open}
            aria-controls={menuId}
            variant="ghost"
            size="xs"
            color="fg.muted"
            disabled={isDisabled}
            onClick={() => {
              if (isDisabled) return;
              setOpen((v) => !v);
            }}
          >
            <FiChevronDown
              size={16}
              style={{ transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }}
            />
          </IconButton>
        </Flex>
      </Flex>

      {open && !isDisabled ? (
          <Box
            id={menuId}
            position="absolute"
            top="calc(100% + 4px)"
            left={0}
            right={0}
            zIndex={1500}
            bg="bg.panel"
            border="1px solid"
            borderColor="border"
            borderRadius="md"
            boxShadow="lg"
            py={1}
            maxH="240px"
            overflowY="auto"
          >
            {filtered.length === 0 ? (
              <Text px={3} py={2} fontSize="sm" color="fg.subtle">
                No matches
              </Text>
            ) : (
              filtered.map((option) => {
                const selected = value.includes(option.value);
                return (
                  <Box
                    key={option.value}
                    as="button"
                    display="flex"
                    w="full"
                    alignItems="center"
                    gap={2}
                    px={3}
                    py={2}
                    textAlign="left"
                    bg={selected ? "blue.50" : "transparent"}
                    _hover={{ bg: selected ? "blue.50" : "gray.50" }}
                    onClick={() => toggleOption(option.value)}
                  >
                    <Box w="3px" alignSelf="stretch" borderRadius="full" bg={option.color} flexShrink={0} />
                    <Text fontSize="sm" fontWeight="medium" color="fg" textTransform="uppercase">
                      {option.label}
                    </Text>
                  </Box>
                );
              })
            )}
          </Box>
      ) : null}
    </Box>
  );
}

