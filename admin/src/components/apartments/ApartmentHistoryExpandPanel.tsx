import { useEffect, useState } from "react";
import { Badge, Box, Flex, Stack, Text } from "@chakra-ui/react";
import {
  api,
  formatCurrency,
  formatDate,
  type ApartmentHistoryEntry,
  type CustomerEvent,
} from "../../lib/api";
import { formatTitleCase } from "../../lib/formatText";
import { displayCustomerStatus } from "../../lib/customerStatus";
import { DetailCard, DetailGrid } from "../module/EntityExpandShell";
import { TextStatus } from "../ui/TextStatus";
import { DataTableLoadingSkeleton } from "../PageSkeletons";
import {
  ApartmentHistoryTimeline,
  ApartmentHistoryTimelineSkeleton,
} from "./ApartmentHistoryTimeline";

function paymentFrequencyLabel(entry: ApartmentHistoryEntry) {
  if (entry.paymentFrequency === "custom" && entry.customPeriodDays) {
    return `Custom (${entry.customPeriodDays} days)`;
  }
  return entry.paymentFrequency;
}

type Props = {
  entry: ApartmentHistoryEntry;
  /** When the parent already loaded this unit's timeline, reuse it to avoid duplicate fetches. */
  unitHistory?: ApartmentHistoryEntry[];
  unitHistoryLoading?: boolean;
};

function unitCacheKey(entry: ApartmentHistoryEntry) {
  return `${entry.buildingId}:${entry.apartmentNumber}`;
}

export function ApartmentHistoryExpandPanel({
  entry,
  unitHistory: prefetchedUnitHistory,
  unitHistoryLoading: prefetchedUnitHistoryLoading,
}: Props) {
  const [events, setEvents] = useState<CustomerEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [localUnitHistory, setLocalUnitHistory] = useState<ApartmentHistoryEntry[]>([]);
  const [loadingLocalUnitHistory, setLoadingLocalUnitHistory] = useState(
    prefetchedUnitHistory === undefined
  );
  const [loadedUnitKey, setLoadedUnitKey] = useState<string | null>(null);

  const usePrefetched = prefetchedUnitHistory !== undefined;
  const activeUnitKey = unitCacheKey(entry);
  const unitHistory = usePrefetched ? prefetchedUnitHistory : localUnitHistory;
  const loadingUnitHistory = usePrefetched
    ? Boolean(prefetchedUnitHistoryLoading)
    : loadingLocalUnitHistory;

  useEffect(() => {
    let cancelled = false;
    setLoadingEvents(true);
    api
      .getCustomer(entry.customerId)
      .then((res) => {
        if (!cancelled) setEvents(res.events.slice(0, 5));
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingEvents(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entry.customerId]);

  useEffect(() => {
    if (usePrefetched) return;

    if (loadedUnitKey === activeUnitKey && localUnitHistory.length > 0) {
      setLoadingLocalUnitHistory(false);
      return;
    }

    let cancelled = false;
    setLoadingLocalUnitHistory(true);
    api
      .getApartmentHistory(entry.buildingId, entry.apartmentNumber)
      .then((res) => {
        if (!cancelled) {
          setLocalUnitHistory(res.history);
          setLoadedUnitKey(activeUnitKey);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLocalUnitHistory([entry]);
          setLoadedUnitKey(activeUnitKey);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingLocalUnitHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeUnitKey, entry.buildingId, entry.apartmentNumber, loadedUnitKey, usePrefetched]);

  const relatedEvents = events.filter((event) => {
    if (entry.reason === "cancel" && event.eventType === "cancel") return true;
    if (
      entry.reason === "switch_in" &&
      event.eventType === "switch_apartment" &&
      event.newApartment === entry.apartmentNumber
    ) {
      return true;
    }
    if (
      entry.reason === "switch_out" &&
      event.eventType === "switch_apartment" &&
      event.oldApartment === entry.apartmentNumber
    ) {
      return true;
    }
    if (entry.reason === "signup" && event.eventType === "created") return true;
    return false;
  });

  return (
    <Box
      bg="bg.panel"
      borderRadius="lg"
      border="1px solid"
      borderColor="brand.200"
      boxShadow="lg"
      overflow="hidden"
    >
      <Flex
        align="start"
        justify="space-between"
        gap={{ base: 2, md: 3 }}
        px={{ base: 2.5, md: 4 }}
        py={{ base: 2.5, md: 4 }}
        borderBottom="1px solid"
        borderColor="border.muted"
      >
        <Box minW={0}>
          <Flex align="center" gap={2} flexWrap="wrap">
            <Text fontSize={{ base: "lg", md: "xl" }} fontWeight="bold" color="fg" lineHeight="1.3">
              {formatTitleCase(entry.customerName)}
            </Text>
            <TextStatus
              status={displayCustomerStatus({
                status: entry.customerStatus,
                subscriptionStatus: entry.subscriptionStatus,
              })}
            />
          </Flex>
          <Text fontSize={{ base: "xs", md: "sm" }} color="fg.muted" mt={1} lineHeight="1.45">
            {formatTitleCase(entry.buildingName)} · {entry.apartmentNumber} · {entry.customerNumber}
          </Text>
        </Box>
        <Flex align="center" gap={2} flexShrink={0} flexWrap="wrap" justify="flex-end">
          <Badge
            colorPalette={entry.customerType === "C2B" ? "brand" : "blue"}
            variant="subtle"
          >
            {entry.customerType}
          </Badge>
          {entry.isCurrent ? (
            <Badge colorPalette="green" variant="subtle">
              Current tenant
            </Badge>
          ) : (
            <Badge colorPalette="gray" variant="subtle">
              Former tenant
            </Badge>
          )}
        </Flex>
      </Flex>

      <Box p={{ base: 2, md: 3 }}>
        <Stack gap={{ base: 2.5, md: 4 }}>
          <Box
            bg="bg.subtle"
            border="1px solid"
            borderColor="border.muted"
            borderRadius="lg"
            px={{ base: 2.5, md: 3.5 }}
            py={{ base: 2, md: 3 }}
          >
            <Text fontSize="sm" fontWeight="semibold" color="fg" mb={1} lineHeight="1.4">
              Occupancy timeline — {entry.apartmentNumber}
            </Text>
            <Text fontSize="2xs" color="fg.muted" mb={2} lineHeight="1.45" display={{ base: "none", sm: "block" }}>
              All tenants for this apartment, oldest on the left. The selected record is highlighted.
            </Text>
            {loadingUnitHistory && unitHistory.length === 0 ? (
              <ApartmentHistoryTimelineSkeleton steps={3} />
            ) : (
              <Box opacity={loadingUnitHistory ? 0.65 : 1} transition="opacity 0.2s ease">
                <ApartmentHistoryTimeline
                  entries={unitHistory}
                  highlightEntryId={entry.id}
                  emptyMessage="No occupancy history for this apartment"
                />
              </Box>
            )}
          </Box>

          <DetailGrid>
            <DetailCard
              label="Package"
              value={
                entry.productMbps && entry.productName
                  ? `${entry.productMbps} Mbps — ${entry.productName}`
                  : entry.productName
              }
              highlight
            />
            <DetailCard
              label="Package price"
              value={entry.packagePrice != null ? formatCurrency(entry.packagePrice) : null}
            />
            <DetailCard label="Payment frequency" value={paymentFrequencyLabel(entry)} />
            <DetailCard
              label="Last payment"
              value={entry.lastPaymentDate ? formatDate(entry.lastPaymentDate) : null}
            />
            <DetailCard label="Phone" value={entry.phone} />
            <DetailCard label="Email" value={entry.email} />
          </DetailGrid>

          <Box>
            <Text fontSize="sm" fontWeight="semibold" color="fg" mb={2} lineHeight="1.4">
              Related activity
            </Text>
            {loadingEvents ? (
              <DataTableLoadingSkeleton columns={2} rows={2} fill={false} showHeader={false} />
            ) : relatedEvents.length === 0 ? (
              <Text fontSize="sm" color="fg.subtle" py={2} lineHeight="1.45">
                No related activity notes recorded
              </Text>
            ) : (
              <Stack gap={2}>
                {relatedEvents.map((event) => (
                  <Box
                    key={event.id}
                    bg="bg.panel"
                    border="1px solid"
                    borderColor="border.muted"
                    borderRadius="md"
                    px={3}
                    py={2}
                  >
                    <Text fontSize="sm" fontWeight="medium" textTransform="capitalize" lineHeight="1.4">
                      {event.eventType.replace(/_/g, " ")}
                    </Text>
                    <Text fontSize="xs" color="fg.muted" mt={0.5} lineHeight="1.45">
                      {formatDate(event.createdAt)}
                    </Text>
                    {event.notes ? (
                      <Text fontSize="sm" color="fg.muted" mt={1} lineHeight="1.45">
                        {event.notes}
                      </Text>
                    ) : null}
                    {event.oldApartment || event.newApartment ? (
                      <Text fontSize="sm" color="fg.muted" mt={1} lineHeight="1.45">
                        {event.oldApartment && event.newApartment
                          ? `${event.oldApartment} → ${event.newApartment}`
                          : event.oldApartment || event.newApartment}
                      </Text>
                    ) : null}
                    {event.oldProductName || event.newProductName ? (
                      <Text fontSize="sm" color="fg.muted" mt={1} lineHeight="1.45">
                        Package:{" "}
                        {event.oldProductName && event.newProductName
                          ? `${event.oldProductName} → ${event.newProductName}`
                          : event.newProductName || event.oldProductName}
                      </Text>
                    ) : null}
                  </Box>
                ))}
              </Stack>
            )}
          </Box>
        </Stack>
      </Box>
    </Box>
  );
}
