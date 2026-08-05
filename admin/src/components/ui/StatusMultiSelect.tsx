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
import {
  FLOATING_MENU_Z_INDEX,
  renderFloatingMenuPortal,
  useFloatingMenuPosition,
} from "./floatingMenu";

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
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const placement = useFloatingMenuPosition(open && !isDisabled, rootRef, 320);

  const shellHeight = size === "sm" ? FILTER_CONTROL_HEIGHT : "40px";
  /** More than two chips → wrap and grow the filter row (pushes table down). */
  const allowWrap = value.length > 2;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
      setQuery("");
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
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
        align={allowWrap ? "flex-start" : "center"}
        gap={1}
        h={allowWrap ? undefined : shellHeight}
        minH={shellHeight}
        px={2}
        py={allowWrap ? 1 : 0}
        borderWidth="1px"
        borderColor={open ? "brand.500" : "gray.200"}
        borderRadius="md"
        bg={isDisabled ? "gray.50" : "white"}
        boxShadow={open ? "0 0 0 1px var(--chakra-colors-brand-500)" : fieldControlStyles.boxShadow}
        cursor={isDisabled ? "not-allowed" : "pointer"}
        opacity={isDisabled ? 0.65 : 1}
        onClick={() => {
          if (isDisabled) return;
          setOpen(true);
        }}
      >
        <Flex
          align="center"
          gap={1}
          flex={1}
          minW={0}
          flexWrap={allowWrap ? "wrap" : "nowrap"}
          rowGap={allowWrap ? 1 : 0}
          overflowX={allowWrap ? "visible" : "auto"}
          overflowY="hidden"
          css={
            allowWrap
              ? undefined
              : {
                  scrollbarWidth: "none",
                  "&::-webkit-scrollbar": { display: "none" },
                }
          }
        >
          {value.length === 0 ? (
            <Text fontSize="sm" color="fg.subtle" px={1} userSelect="none" whiteSpace="nowrap">
              {resolvedPlaceholder}
            </Text>
          ) : (
            value.map((status) => (
              <Flex
                key={status}
                align="center"
                gap={0.5}
                px={1.5}
                h="22px"
                flexShrink={0}
                borderRadius="md"
                bg="bg.muted"
                border="1px solid"
                borderColor="border"
                onClick={(e) => e.stopPropagation()}
              >
                <Text
                  fontSize="xs"
                  fontWeight="semibold"
                  color="fg"
                  textTransform="uppercase"
                  whiteSpace="nowrap"
                  lineHeight="1"
                >
                  {status}
                </Text>
                <IconButton
                  aria-label={`Remove ${status}`}
                  variant="ghost"
                  size="xs"
                  minW="14px"
                  h="14px"
                  p={0}
                  color="fg.muted"
                  disabled={isDisabled}
                  _hover={{ color: "fg", bg: "gray.200" }}
                  onClick={() => removeOption(status)}
                >
                  <FiX size={11} />
                </IconButton>
              </Flex>
            ))
          )}
        </Flex>

        <Flex
          align="center"
          gap={0}
          flexShrink={0}
          h={allowWrap ? "22px" : undefined}
          onClick={(e) => e.stopPropagation()}
        >
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

      {renderFloatingMenuPortal(
        placement,
        open && !isDisabled && placement ? (
          <Box
            ref={menuRef}
            id={menuId}
            bg="bg.panel"
            border="1px solid"
            borderColor="border"
            borderRadius="md"
            boxShadow="lg"
            py={1}
            maxH={`${placement.maxHeight}px`}
            overflowY="auto"
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            <Box px={2} pb={1} pt={1}>
              <Input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                size="xs"
                placeholder="Filter statuses…"
                borderRadius="md"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setOpen(false);
                    setQuery("");
                  }
                }}
              />
            </Box>
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
                    <Box
                      w="3px"
                      alignSelf="stretch"
                      borderRadius="full"
                      bg={option.color}
                      flexShrink={0}
                      minH="18px"
                    />
                    <Text fontSize="sm" fontWeight="semibold" color="fg" minW={0}>
                      {option.label}
                    </Text>
                  </Box>
                );
              })
            )}
          </Box>
        ) : null,
        FLOATING_MENU_Z_INDEX
      )}
    </Box>
  );
}
