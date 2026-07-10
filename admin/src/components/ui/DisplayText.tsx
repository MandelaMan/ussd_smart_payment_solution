import { Text, type TextProps } from "@chakra-ui/react";
import {
  DISPLAY_TEXT_MAX_LENGTH,
  formatDisplayText,
  getDisplayTextFull,
} from "../../lib/formatText";

type Props = TextProps & {
  value: string | null | undefined;
  maxLength?: number | null;
  titleCase?: boolean;
  fallback?: string;
};

export function DisplayText({
  value,
  maxLength = DISPLAY_TEXT_MAX_LENGTH,
  titleCase,
  fallback = "—",
  title,
  ...props
}: Props) {
  const raw = String(value || "").trim();
  if (!raw) {
    return <Text {...props}>{fallback}</Text>;
  }

  const full = getDisplayTextFull(raw, titleCase);
  const shown =
    maxLength == null ? full : formatDisplayText(raw, maxLength, titleCase);
  const tip = title ?? (shown !== full ? full : undefined);

  return (
    <Text title={tip} textTransform="none" {...props}>
      {shown}
    </Text>
  );
}
