import { NativeSelect, type NativeSelectRootProps } from "@chakra-ui/react";
import { FiChevronDown } from "react-icons/fi";
import type { ComponentProps, ReactNode } from "react";
import { FILTER_CONTROL_HEIGHT } from "../../theme";

type FieldProps = ComponentProps<typeof NativeSelect.Field>;

type Props = NativeSelectRootProps & {
  fieldProps?: Omit<FieldProps, "children">;
  children: ReactNode;
  /** When true, the select is disabled (e.g. options still loading). */
  isLoading?: boolean;
};

export function SelectField({
  children,
  fieldProps,
  size,
  isLoading = false,
  disabled,
  ...rootProps
}: Props) {
  const controlHeight = size === "sm" ? FILTER_CONTROL_HEIGHT : undefined;
  const isDisabled = Boolean(disabled || isLoading);
  return (
    <NativeSelect.Root
      width="100%"
      size={size}
      disabled={isDisabled}
      {...rootProps}
    >
      <NativeSelect.Field
        {...fieldProps}
        h={fieldProps?.h ?? controlHeight}
        pe={fieldProps?.pe ?? 8}
      >
        {children}
      </NativeSelect.Field>
      <NativeSelect.Indicator color="gray.500" pointerEvents="none">
        <FiChevronDown size={14} />
      </NativeSelect.Indicator>
    </NativeSelect.Root>
  );
}
