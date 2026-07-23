import { Box, Flex, Text } from "@chakra-ui/react";
import type { ReactNode } from "react";
import {
  FiChevronRight,
  FiHome,
  FiLogIn,
  FiLogOut,
  FiUserPlus,
  FiXCircle,
} from "react-icons/fi";
import { formatDate, type ApartmentHistoryEntry } from "../../lib/api";
import { formatTitleCase } from "../../lib/formatText";
import { BRAND } from "../../theme";
import { SkeletonBlock } from "../ui/SkeletonBlock";

const REASON_LABELS: Record<string, string> = {
  signup: "Signed up",
  switch_in: "Moved in",
  switch_out: "Moved out",
  cancel: "Cancelled",
};

const REASON_DESCRIPTIONS: Record<string, string> = {
  signup: "Registered and started occupancy in this apartment.",
  switch_in: "Switched into this apartment from another unit.",
  switch_out: "Left this apartment for another unit.",
  cancel: "Subscription ended while in this apartment.",
};

/** Brand-aligned gradient stops (cerulean → azure → sandy). */
const TIMELINE_STOPS = [
  BRAND.cerulean,
  "#2a8fa8",
  BRAND.paleAzure,
  "#4db8d4",
  BRAND.sandyBrown,
  "#c97a38",
  "#12596d",
] as const;

function reasonLabel(reason: string) {
  return REASON_LABELS[reason] || reason.replace(/_/g, " ");
}

function stepColor(index: number, total: number) {
  if (total <= 1) return TIMELINE_STOPS[0];
  const t = index / Math.max(total - 1, 1);
  const scaled = t * (TIMELINE_STOPS.length - 1);
  const lower = Math.floor(scaled);
  const upper = Math.min(lower + 1, TIMELINE_STOPS.length - 1);
  const mix = scaled - lower;
  return mix < 0.5 ? TIMELINE_STOPS[lower] : TIMELINE_STOPS[upper];
}

function ReasonIcon({ reason, color }: { reason: string; color: string }) {
  const props = { size: 22, color, strokeWidth: 1.75 };
  switch (reason) {
    case "signup":
      return <FiUserPlus {...props} />;
    case "switch_in":
      return <FiLogIn {...props} />;
    case "switch_out":
      return <FiLogOut {...props} />;
    case "cancel":
      return <FiXCircle {...props} />;
    default:
      return <FiHome {...props} />;
  }
}

function Diamond({ color }: { color: string }) {
  return (
    <Box
      w="7px"
      h="7px"
      bg={color}
      transform="rotate(45deg)"
      flexShrink={0}
      borderRadius="1px"
    />
  );
}

type TimelineStepProps = {
  entry: ApartmentHistoryEntry;
  index: number;
  total: number;
  highlight?: boolean;
};

function TimelineStep({ entry, index, total, highlight }: TimelineStepProps) {
  const color = stepColor(index, total);
  const dateRange = entry.movedOutAt
    ? `${formatDate(entry.movedInAt)} – ${formatDate(entry.movedOutAt)}`
    : `${formatDate(entry.movedInAt)} – Present`;

  return (
    <Flex direction="column" align="center" flex="1" minW={{ base: "148px", md: "160px" }} maxW="200px">
      <Box
        position="relative"
        w="72px"
        h="72px"
        borderRadius="full"
        border="2px solid"
        borderColor={color}
        bg="bg.panel"
        boxShadow={highlight ? `0 4px 16px ${color}44` : "0 2px 10px rgba(0,0,0,0.08)"}
        display="flex"
        alignItems="center"
        justifyContent="center"
        zIndex={1}
      >
        <ReasonIcon reason={entry.reason} color={color} />
        {highlight ? (
          <Box
            position="absolute"
            inset="-4px"
            borderRadius="full"
            border="2px solid"
            borderColor={color}
            opacity={0.35}
          />
        ) : null}
      </Box>

      <Text
        mt={4}
        fontSize="xs"
        fontWeight="bold"
        color="fg"
        textTransform="uppercase"
        letterSpacing="0.06em"
        lineHeight="1.35"
        textAlign="center"
      >
        {reasonLabel(entry.reason)}
      </Text>

      <Text
        mt={1.5}
        fontSize="sm"
        fontWeight="semibold"
        color="fg"
        lineHeight="1.4"
        textAlign="center"
        lineClamp={2}
      >
        {formatTitleCase(entry.customerName)}
      </Text>

      <Text mt={1} fontSize="xs" color="fg.muted" lineHeight="1.45" textAlign="center">
        {dateRange}
      </Text>

      <Text mt={1.5} fontSize="xs" color="fg.muted" lineHeight="1.5" textAlign="center" px={1}>
        {entry.customerNumber}
        {entry.productName
          ? ` · ${entry.productMbps ? `${entry.productMbps} Mbps` : entry.productName}`
          : ""}
      </Text>

      {entry.ipAddress ? (
        <Text
          mt={1}
          fontSize="2xs"
          fontFamily="mono"
          color="fg.muted"
          lineHeight="1.45"
          textAlign="center"
          px={1}
        >
          IP {entry.ipAddress}
        </Text>
      ) : null}

      <Text mt={1} fontSize="2xs" color="fg.subtle" lineHeight="1.45" textAlign="center" px={1}>
        {REASON_DESCRIPTIONS[entry.reason] || "Occupancy record for this apartment."}
      </Text>
    </Flex>
  );
}

type ApartmentHistoryTimelineProps = {
  entries: ApartmentHistoryEntry[];
  /** Highlight steps for this customer (e.g. when opened from their card). */
  highlightCustomerId?: number;
  /** Highlight a specific occupancy record (e.g. expanded table row). */
  highlightEntryId?: number;
  emptyMessage?: ReactNode;
};

export function ApartmentHistoryTimeline({
  entries,
  highlightCustomerId,
  highlightEntryId,
  emptyMessage,
}: ApartmentHistoryTimelineProps) {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.movedInAt).getTime() - new Date(b.movedInAt).getTime()
  );

  if (sorted.length === 0) {
    return (
      <Text color="fg.muted" fontSize="sm" py={6} textAlign="center" lineHeight="1.5">
        {emptyMessage ?? "No occupancy history recorded"}
      </Text>
    );
  }

  const gradient = `linear-gradient(90deg, ${TIMELINE_STOPS.join(", ")})`;

  return (
    <Box
      overflowX="auto"
      mx={{ base: -2, sm: 0 }}
      px={{ base: 2, sm: 0 }}
      css={{
        scrollbarWidth: "thin",
        WebkitOverflowScrolling: "touch",
      }}
    >
      <Box position="relative" minW={`max(100%, ${sorted.length * 168}px)`} pt={2} pb={2}>
        <Box
          position="absolute"
          top="38px"
          left="calc(72px / 2)"
          right="calc(72px / 2)"
          h="2px"
          bg={gradient}
          borderRadius="full"
          zIndex={0}
        />

        <Flex align="flex-start" justify="space-between" gap={0} position="relative">
          {sorted.map((entry, index) => (
            <Flex key={entry.id} align="flex-start" flex={1} minW={0}>
              <TimelineStep
                entry={entry}
                index={index}
                total={sorted.length}
                highlight={
                  highlightEntryId != null
                    ? entry.id === highlightEntryId
                    : highlightCustomerId != null
                      ? entry.customerId === highlightCustomerId
                      : entry.isCurrent
                }
              />
              {index < sorted.length - 1 ? (
                <Flex
                  align="center"
                  pt="34px"
                  px={{ base: 0.5, md: 1 }}
                  flexShrink={0}
                  color="gray.300"
                  aria-hidden
                >
                  <Diamond color={stepColor(index + 0.5, sorted.length)} />
                  <FiChevronRight size={14} style={{ marginLeft: 2, marginRight: 2 }} />
                  <Diamond color={stepColor(index + 1, sorted.length)} />
                </Flex>
              ) : null}
            </Flex>
          ))}
        </Flex>
      </Box>
    </Box>
  );
}

export function ApartmentHistoryTimelineSkeleton({ steps = 4 }: { steps?: number }) {
  const gradient = `linear-gradient(90deg, ${TIMELINE_STOPS.join(", ")})`;

  return (
    <Box overflowX="auto" mx={{ base: -2, sm: 0 }} px={{ base: 2, sm: 0 }}>
      <Box position="relative" minW={`max(100%, ${steps * 168}px)`} pt={2} pb={2}>
        <Box
          position="absolute"
          top="38px"
          left="calc(72px / 2)"
          right="calc(72px / 2)"
          h="2px"
          bg={gradient}
          opacity={0.4}
          borderRadius="full"
        />
        <Flex justify="space-between" gap={2}>
          {Array.from({ length: steps }).map((_, i) => (
            <Flex key={i} direction="column" align="center" flex={1} minW="148px">
              <SkeletonBlock boxSize="72px" borderRadius="full" />
              <SkeletonBlock height="12px" width="72px" mt={4} borderRadius="sm" />
              <SkeletonBlock height="14px" width="90px" mt={2} borderRadius="sm" />
              <SkeletonBlock height="11px" width="110px" mt={2} borderRadius="sm" />
            </Flex>
          ))}
        </Flex>
      </Box>
    </Box>
  );
}
