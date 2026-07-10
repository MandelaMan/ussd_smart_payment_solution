import { useEffect, useRef } from "react";
import { Box } from "@chakra-ui/react";

type Props = {
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  onChange: () => void;
  "aria-label": string;
};

export function RowCheckbox({
  checked,
  indeterminate = false,
  disabled = false,
  onChange,
  "aria-label": ariaLabel,
}: Props) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <Box
      as="label"
      display="inline-flex"
      alignItems="center"
      cursor={disabled ? "not-allowed" : "pointer"}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => {
          e.stopPropagation();
          onChange();
        }}
        style={{
          width: "16px",
          height: "16px",
          accentColor: "var(--chakra-colors-brand-600)",
          cursor: disabled ? "not-allowed" : "pointer",
        }}
      />
    </Box>
  );
}
