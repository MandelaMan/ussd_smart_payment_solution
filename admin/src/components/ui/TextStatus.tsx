import { Text } from "@chakra-ui/react";

const STATUS_COLORS: Record<string, string> = {
  paid: "green.600",
  success: "green.600",
  active: "green.600",
  synced: "green.600",
  pending: "orange.600",
  suspended: "orange.600",
  unknown: "gray.500",
  failed: "red.600",
  error: "red.600",
};

function resolveColor(status: string) {
  const key = status.trim().toLowerCase();
  if (STATUS_COLORS[key]) return STATUS_COLORS[key];
  if (key.includes("active")) return "green.600";
  if (key.includes("suspend")) return "orange.600";
  if (key.includes("unknown")) return "gray.500";
  if (key.includes("cancel")) return "gray.500";
  if (key.includes("fail") || key.includes("error")) return "red.600";
  return "gray.700";
}

export function TextStatus({
  status,
  variant = "default",
}: {
  status: string;
  variant?: "default" | "caption";
}) {
  const label = status.trim() || "—";
  const isCaption = variant === "caption";
  return (
    <Text
      fontSize={isCaption ? "2xs" : "sm"}
      fontWeight="semibold"
      color={resolveColor(label)}
      textTransform={isCaption ? "uppercase" : "capitalize"}
      letterSpacing={isCaption ? "0.04em" : undefined}
      lineHeight={isCaption ? "1.35" : "1.4"}
    >
      {label}
    </Text>
  );
}
