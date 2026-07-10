import {
  Box,
  Flex,
  Input,
  Portal,
  Text,
  type InputProps,
} from "@chakra-ui/react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { FiChevronDown, FiSearch } from "react-icons/fi";
import { embeddedFieldInputStyles, FILTER_CONTROL_HEIGHT } from "../../theme";
import { MODAL_Z_INDEX } from "./ModalShell";

export const SEARCHABLE_SELECT_MENU_Z_INDEX = MODAL_Z_INDEX + 100;

export type SearchableSelectOption = {
  value: string;
  label: string;
  description?: string;
  keywords?: string;
};

type DropdownRect = {
  top: number;
  left: number;
  width: number;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  disabled?: boolean;
  /** When true, the control is disabled and shows a loading placeholder. */
  isLoading?: boolean;
  size?: InputProps["size"];
  menuZIndex?: number;
  usePortal?: boolean;
};

function matchesOption(option: SearchableSelectOption, query: string) {
  const haystack = [option.label, option.description, option.keywords]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function eventPathIncludesNode(event: PointerEvent, node: HTMLElement | null) {
  if (!node) return false;
  return event.composedPath().includes(node);
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyLabel = "No matches",
  disabled = false,
  isLoading = false,
  size = "md",
  menuZIndex,
  usePortal = true,
}: Props) {
  const isDisabled = disabled || isLoading;
  const resolvedPlaceholder = isLoading ? "Loading…" : placeholder;
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [dropdownRect, setDropdownRect] = useState<DropdownRect | null>(null);

  const selected = options.find((option) => option.value === value);
  const resolvedMenuZIndex = menuZIndex ?? SEARCHABLE_SELECT_MENU_Z_INDEX;

  const filtered = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return options;
    return options.filter((option) => matchesOption(option, trimmed));
  }, [options, query]);

  const updateDropdownPosition = useCallback(() => {
    if (!rootRef.current) return;
    const rect = rootRef.current.getBoundingClientRect();
    setDropdownRect({
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    });
  }, []);

  const selectOption = useCallback(
    (option: SearchableSelectOption) => {
      onChange(option.value);
      setOpen(false);
      setQuery("");
    },
    [onChange]
  );

  useEffect(() => {
    setHighlightIndex(0);
  }, [query, open]);

  useLayoutEffect(() => {
    if (!open || !usePortal) {
      setDropdownRect(null);
      return;
    }
    updateDropdownPosition();
    const onScrollOrResize = () => updateDropdownPosition();
    window.addEventListener("resize", onScrollOrResize);
    document.addEventListener("scroll", onScrollOrResize, true);
    return () => {
      window.removeEventListener("resize", onScrollOrResize);
      document.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, updateDropdownPosition, usePortal]);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (eventPathIncludesNode(event, rootRef.current)) return;
      if (eventPathIncludesNode(event, menuRef.current)) return;
      setOpen(false);
      setQuery("");
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function openMenu() {
    if (isDisabled) return;
    setOpen(true);
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!open && (event.key === "ArrowDown" || event.key === "Enter")) {
      event.preventDefault();
      openMenu();
      return;
    }
    if (!open) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((index) => Math.min(index + 1, Math.max(filtered.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter" && filtered[highlightIndex]) {
      event.preventDefault();
      selectOption(filtered[highlightIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setQuery("");
    }
  }

  const displayValue = open ? query : selected?.label ?? "";

  const menuItems =
    filtered.length === 0 ? (
      <Text px={3} py={3} fontSize="sm" color="gray.500">
        {emptyLabel}
      </Text>
    ) : (
      filtered.map((option, index) => {
        const isSelected = option.value === value;
        const isHighlighted = index === highlightIndex;
        return (
          <Box
            key={`${option.value}-${index}`}
            role="option"
            aria-selected={isSelected}
            px={3}
            py={2.5}
            cursor="pointer"
            bg={isHighlighted ? "brand.50" : isSelected ? "gray.50" : "white"}
            borderBottom="1px solid"
            borderColor="gray.100"
            _last={{ borderBottom: "none" }}
            _hover={{ bg: "brand.50" }}
            onMouseEnter={() => setHighlightIndex(index)}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              selectOption(option);
            }}
          >
            <Text
              fontSize="sm"
              fontWeight={isSelected ? "semibold" : "medium"}
              color="gray.900"
            >
              {option.label}
            </Text>
            {option.description ? (
              <Text fontSize="xs" color="gray.500" mt={0.5}>
                {option.description}
              </Text>
            ) : null}
          </Box>
        );
      })
    );

  const menuContent = (
    <Box
      ref={menuRef}
      id={menuId}
      role="listbox"
      bg="white"
      border="1px solid"
      borderColor="gray.200"
      borderRadius="md"
      boxShadow="lg"
      maxH="240px"
      overflowY="auto"
      isolation="isolate"
    >
      {menuItems}
    </Box>
  );

  return (
    <Box ref={rootRef} position="relative" w="100%" maxW="100%">
      <Flex
        align="center"
        w="100%"
        maxW="100%"
        h={FILTER_CONTROL_HEIGHT}
        minH={FILTER_CONTROL_HEIGHT}
        borderWidth="1px"
        borderColor={open ? "brand.500" : "gray.200"}
        borderRadius="md"
        bg={isDisabled ? "gray.50" : "white"}
        boxShadow={open ? "0 0 0 1px var(--chakra-colors-brand-500)" : "sm"}
        overflow="hidden"
      >
        <Box ps={3} color="gray.400" flexShrink={0}>
          <FiSearch size={14} />
        </Box>
        <Input
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? menuId : undefined}
          aria-busy={isLoading || undefined}
          value={displayValue}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={openMenu}
          onKeyDown={handleKeyDown}
          placeholder={open ? searchPlaceholder : selected ? undefined : resolvedPlaceholder}
          disabled={isDisabled}
          size={size}
          flex="1"
          minW={0}
          w="full"
          px={2}
          readOnly={!open && !!selected}
          onClick={() => {
            if (!open) openMenu();
          }}
          {...embeddedFieldInputStyles}
        />
        <Flex
          pe={3}
          color="gray.500"
          flexShrink={0}
          cursor={isDisabled ? "not-allowed" : "pointer"}
          onMouseDown={(e) => {
            e.preventDefault();
            if (isDisabled) return;
            if (open) {
              setOpen(false);
              setQuery("");
            } else {
              openMenu();
            }
          }}
        >
          <FiChevronDown size={14} />
        </Flex>
      </Flex>

      {open && !isDisabled ? (
        usePortal && dropdownRect ? (
          <Portal>
            <Box
              position="fixed"
              top={`${dropdownRect.top}px`}
              left={`${dropdownRect.left}px`}
              width={`${dropdownRect.width}px`}
              zIndex={resolvedMenuZIndex}
              bg="white"
              borderRadius="md"
            >
              {menuContent}
            </Box>
          </Portal>
        ) : (
          <Box
            position="absolute"
            top="calc(100% + 4px)"
            left={0}
            right={0}
            zIndex={resolvedMenuZIndex}
            bg="white"
            borderRadius="md"
          >
            {menuContent}
          </Box>
        )
      ) : null}
    </Box>
  );
}
