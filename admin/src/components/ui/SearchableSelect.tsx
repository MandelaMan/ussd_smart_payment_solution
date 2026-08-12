import {
  Box,
  Flex,
  Input,
  Text,
  type InputProps,
} from "@chakra-ui/react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { FiChevronDown, FiSearch } from "react-icons/fi";
import { embeddedFieldInputStyles, FILTER_CONTROL_HEIGHT } from "../../theme";
import {
  FLOATING_MENU_Z_INDEX,
  renderFloatingMenuPortal,
  useFloatingMenuPosition,
} from "./floatingMenu";

export const SEARCHABLE_SELECT_MENU_Z_INDEX = FLOATING_MENU_Z_INDEX;

export type SearchableSelectOption = {
  value: string;
  label: string;
  description?: string;
  keywords?: string;
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
  /** @deprecated Menus always portal to document.body to avoid modal clipping. */
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

/**
 * Chrome attaches its history dropdown on focus if the field is editable.
 * Keep read-only through focus, then unlock after a short delay (rAF alone is
 * too early on Chromium).
 */
function unlockInputAfterFocus(input: HTMLInputElement) {
  input.readOnly = true;
  window.setTimeout(() => {
    if (document.activeElement !== input) return;
    input.readOnly = false;
    const len = input.value.length;
    try {
      input.setSelectionRange(len, len);
    } catch {
      /* ignored */
    }
  }, 50);
}

/**
 * Chrome ignores autocomplete=off and also heuristics off nearby labels
 * ("Building"). `chrome-off` / `one-time-code` are the values Chromium
 * currently respects for custom comboboxes.
 */
const SEARCH_SELECT_AUTOFILL_PROPS = {
  autoComplete: "chrome-off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  "data-1p-ignore": "",
  "data-lpignore": "true",
  "data-bwignore": "true",
  "data-form-type": "other",
} as const;

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
  usePortal: _usePortal = true,
}: Props) {
  const isDisabled = disabled || isLoading;
  const resolvedPlaceholder = isLoading ? "Loading…" : placeholder;
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuId = useId();
  // Unique per instance so Chrome does not reuse shared field history.
  const fieldKey = `ss-${menuId.replace(/:/g, "")}`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightIndex, setHighlightIndex] = useState(0);
  const placement = useFloatingMenuPosition(open && !isDisabled, rootRef, 240);

  const selected = options.find((option) => option.value === value);
  const resolvedMenuZIndex = menuZIndex ?? SEARCHABLE_SELECT_MENU_Z_INDEX;

  const filtered = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed) return options;
    return options.filter((option) => matchesOption(option, trimmed));
  }, [options, query]);

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
      setHighlightIndex((index) =>
        Math.min(index + 1, Math.max(filtered.length - 1, 0))
      );
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

  // Never put the selected label into <input value> — Chrome learns those
  // strings and resurfaces them in its native autofill popup.
  const inputValue = open ? query : "";
  const closedLabel = selected?.label;
  const showClosedLabel = !open && !!closedLabel;

  const menuItems =
    filtered.length === 0 ? (
      <Text px={3} py={3} fontSize="sm" color="fg.muted">
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
            borderColor="border.muted"
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
              color="fg"
            >
              {option.label}
            </Text>
            {option.description ? (
              <Text fontSize="xs" color="fg.muted" mt={0.5}>
                {option.description}
              </Text>
            ) : null}
          </Box>
        );
      })
    );

  const menuContent =
    open && !isDisabled && placement ? (
      <Box
        ref={menuRef}
        id={menuId}
        role="listbox"
        bg="bg.panel"
        border="1px solid"
        borderColor="border"
        borderRadius="md"
        boxShadow="lg"
        maxH={`${placement.maxHeight}px`}
        overflowY="auto"
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {menuItems}
      </Box>
    ) : null;

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
        <Box ps={3} color="fg.subtle" flexShrink={0}>
          <FiSearch size={14} />
        </Box>
        <Box position="relative" flex="1" minW={0} h="100%">
          {showClosedLabel ? (
            <Text
              position="absolute"
              inset={0}
              px={2}
              display="flex"
              alignItems="center"
              fontSize="sm"
              color="fg"
              truncate
              pointerEvents="none"
              userSelect="none"
              zIndex={1}
            >
              {closedLabel}
            </Text>
          ) : null}
          <Input
            ref={inputRef}
            id={fieldKey}
            name={fieldKey}
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            aria-busy={isLoading || undefined}
            aria-label={closedLabel || resolvedPlaceholder}
            {...SEARCH_SELECT_AUTOFILL_PROPS}
            value={inputValue}
            onChange={(e) => {
              setQuery(e.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={(e) => {
              unlockInputAfterFocus(e.currentTarget);
              openMenu();
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              open
                ? searchPlaceholder
                : showClosedLabel
                  ? undefined
                  : resolvedPlaceholder
            }
            disabled={isDisabled}
            size={size}
            h="100%"
            minW={0}
            w="full"
            px={2}
            // Closed: read-only + empty value so Chrome has nothing to suggest.
            // Open: still start read-only; unlockInputAfterFocus enables typing.
            readOnly={!open}
            color={showClosedLabel ? "transparent" : undefined}
            caretColor={showClosedLabel ? "transparent" : undefined}
            onClick={() => {
              if (!open) openMenu();
            }}
            {...embeddedFieldInputStyles}
          />
        </Box>
        <Flex
          pe={3}
          color="fg.muted"
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

      {renderFloatingMenuPortal(placement, menuContent, resolvedMenuZIndex)}
    </Box>
  );
}
