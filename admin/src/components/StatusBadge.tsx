import { Badge, type BadgeProps } from "@chakra-ui/react";

export function StatusBadge({ status }: { status: string }) {
  const colorPalette = (
    status.toUpperCase() === "SUCCESS" || status.toLowerCase() === "paid"
      ? "green"
      : status.toUpperCase() === "PENDING"
        ? "yellow"
        : "red"
  ) as BadgeProps["colorPalette"];

  return (
    <Badge colorPalette={colorPalette} variant="subtle" px={2}>
      {status}
    </Badge>
  );
}
