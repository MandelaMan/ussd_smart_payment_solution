import { Box, Portal, Text, type BoxProps } from "@chakra-ui/react";
import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { FiChevronDown } from "react-icons/fi";
import { fieldControlStyles, FILTER_CONTROL_HEIGHT } from "../../theme";
import { APP_DIALOG_Z_INDEX } from "./AppDialog";
import { MODAL_Z_INDEX } from "./ModalShell";

export const SELECT_FIELD_MENU_Z_INDEX = Math.max(MODAL_Z_INDEX, APP_DIALOG_Z_INDEX) + 100;

type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type FieldProps = Omit<BoxProps, "onChange" | "value" | "children"> & {
  value?: string | number | readonly string[];
  onChange?: (event: ChangeEvent<HTMLSelectElement>) => void;
  name?: string;
  id?: string;
  "aria-label"?: string;
};

type Props = Omit<BoxProps, "children" | "onChange" | "value"> & {
  children: ReactNode;
  fieldProps?: FieldProps;
  disabled?: boolean;
  isLoading?: boolean;
  size?: "sm" | "md" | "lg";
  menuZIndex?: number;
  usePortal?: boolean;
};

function flattenOptions(nodes: ReactNode): SelectOption[] {
  const options: SelectOption[] = [];
  Children.forEach(nodes, (child) => {
    if (!isValidElement(child)) return;
    const type = child.type;
    const props = child.props as {
      value?: string | number;
      disabled?: boolean;
      children?: ReactNode;
      label?: string;
    };

    if (type === "optgroup") {
      options.push(...flattenOptions(props.children));
      return;
    }

    if (type !== "option") return;

    const value =
      props.value !== undefined && props.value !== null
        ? String(props.value)
        : "";
    const label = String(props.children ?? props.label ?? value);
    options.push({
      value,
      label,
      disabled: Boolean(props.disabled),
    });
  });
  return options;
}

function eventPathIncludesNode(event: PointerEvent, node: HTMLElement | null) {
  if (!node) return false;
  return event.composedPath().includes(node);
}

function emitChange(
  onChange: FieldProps["onChange"],
  value: string,
  name?: string
) {
  if (!onChange) return;
  const event = {
    target: { value, name: name ?? "" },
    currentTarget: { value, name: name ?? "" },
  } as ChangeEvent<HTMLSelectElement>;
  onChange(event);
}

/**
 * Custom select with a full-width menu.
 * Native OS &lt;select&gt; popups cannot style option highlight width; this
 * listbox keeps the SelectField API while painting hover/selected rows edge-to-edge.
 */
export function SelectField({
  children,
  fieldProps,
  size,
  isLoading = false,
  disabled,
  menuZIndex,
  usePortal = true,
  width,
  w,
  ...rootProps
}: Props) {
  const isDisabled = Boolean(disabled || isLoading);
  const options = useMemo(() => flattenOptions(children), [children]);
  const value = fieldProps?.value != null ? String(fieldProps.value) : "";
  const selected = options.find((option) => option.value === value);
  const displayLabel = isLoading
    ? "Loading…"
    : selected?.label ?? options.find((o) => o.value === "")?.label ?? "";

  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [dropdownRect, setDropdownRect] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);

  const resolvedMenuZIndex = menuZIndex ?? SELECT_FIELD_MENU_Z_INDEX;
  const controlHeight =
    fieldProps?.h ?? (size === "sm" ? FILTER_CONTROL_HEIGHT : "40px");
  const resolvedWidth = w ?? width ?? "100%";

  const selectableIndexes = useMemo(
    () =>
      options
        .map((option, index) => ({ option, index }))
        .filter(({ option }) => !option.disabled)
        .map(({ index }) => index),
    [options]
  );

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
    (option: SelectOption) => {
      if (option.disabled) return;
      emitChange(fieldProps?.onChange, option.value, fieldProps?.name);
      setOpen(false);
    },
    [fieldProps?.onChange, fieldProps?.name]
  );

  useEffect(() => {
    if (!open) return;
    const selectedIndex = options.findIndex((option) => option.value === value);
    const fallback = selectableIndexes[0] ?? 0;
    setHighlightIndex(selectedIndex >= 0 ? selectedIndex : fallback);
  }, [open, options, selectableIndexes, value]);

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
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  function openMenu() {
    if (isDisabled) return;
    setOpen(true);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (
      !open &&
      (event.key === "ArrowDown" ||
        event.key === "ArrowUp" ||
        event.key === "Enter" ||
        event.key === " ")
    ) {
      event.preventDefault();
      openMenu();
      return;
    }
    if (!open) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlightIndex((current) => {
        const pos = selectableIndexes.indexOf(current);
        const nextPos = Math.min(pos + 1, selectableIndexes.length - 1);
        return selectableIndexes[nextPos] ?? current;
      });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightIndex((current) => {
        const pos = selectableIndexes.indexOf(current);
        const nextPos = Math.max(pos - 1, 0);
        return selectableIndexes[nextPos] ?? current;
      });
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = options[highlightIndex];
      if (option) selectOption(option);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  const menuItems = options.map((option, index) => {
    const isSelected = option.value === value;
    const isHighlighted = index === highlightIndex;
    return (
      <Box
        key={`${option.value}-${index}`}
        role="option"
        aria-selected={isSelected}
        aria-disabled={option.disabled || undefined}
        w="100%"
        px={3}
        py={2.5}
        cursor={option.disabled ? "not-allowed" : "pointer"}
        opacity={option.disabled ? 0.5 : 1}
        bg={
          option.disabled
            ? "transparent"
            : isHighlighted
              ? "gray.100"
              : isSelected
                ? "gray.50"
                : "transparent"
        }
        _hover={option.disabled ? undefined : { bg: "gray.100" }}
        onMouseEnter={() => {
          if (!option.disabled) setHighlightIndex(index);
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!option.disabled) selectOption(option);
        }}
      >
        <Text
          fontSize="sm"
          fontWeight={isSelected ? "semibold" : "normal"}
          color="fg"
          fontFamily={fieldProps?.fontFamily}
          whiteSpace="normal"
        >
          {option.label}
        </Text>
      </Box>
    );
  });

  const menuContent = (
    <Box
      ref={menuRef}
      id={menuId}
      role="listbox"
      w="100%"
      bg="bg.panel"
      border="1px solid"
      borderColor="border"
      borderRadius="md"
      boxShadow="lg"
      maxH="280px"
      overflowY="auto"
      overflowX="hidden"
      isolation="isolate"
      py={1}
      // Keep wheel/touch scrolling on the menu instead of a parent overflow container
      // (e.g. AppDialog body), which otherwise steals scroll and makes options unusable.
      onWheel={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
    >
      {menuItems}
    </Box>
  );

  return (
    <Box
      ref={rootRef}
      position="relative"
      w={resolvedWidth}
      maxW="100%"
      {...rootProps}
    >
      <Box
        role="button"
        tabIndex={isDisabled ? -1 : 0}
        id={fieldProps?.id}
        aria-label={fieldProps?.["aria-label"]}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-busy={isLoading || undefined}
        aria-disabled={isDisabled || undefined}
        w="100%"
        h={controlHeight}
        minH={controlHeight}
        px={3}
        pe={fieldProps?.pe ?? 8}
        display="flex"
        alignItems="center"
        textAlign="left"
        borderWidth="1px"
        borderColor={open ? "brand.500" : "border"}
        borderRadius={
          fieldProps?.borderRadius ?? fieldControlStyles.borderRadius
        }
        bg={isDisabled ? "bg.muted" : fieldControlStyles.bg}
        boxShadow={
          open
            ? "0 0 0 1px var(--chakra-colors-brand-500)"
            : fieldControlStyles.boxShadow
        }
        cursor={isDisabled ? "not-allowed" : "pointer"}
        opacity={isDisabled ? 0.85 : 1}
        position="relative"
        onClick={() => {
          if (isDisabled) return;
          setOpen((v) => !v);
        }}
        onKeyDown={handleKeyDown}
      >
        <Text
          flex="1"
          minW={0}
          fontSize="sm"
          color={selected || value === "" ? "fg" : "fg.muted"}
          fontFamily={fieldProps?.fontFamily}
          truncate
        >
          {displayLabel || "Select…"}
        </Text>
        <Box
          position="absolute"
          right={3}
          top="50%"
          transform="translateY(-50%)"
          color="fg.muted"
          pointerEvents="none"
        >
          <FiChevronDown size={14} />
        </Box>
      </Box>

      {open && !isDisabled ? (
        usePortal && dropdownRect ? (
          <Portal>
            <Box
              position="fixed"
              top={`${dropdownRect.top}px`}
              left={`${dropdownRect.left}px`}
              w={`${dropdownRect.width}px`}
              zIndex={resolvedMenuZIndex}
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
          >
            {menuContent}
          </Box>
        )
      ) : null}
    </Box>
  );
}
