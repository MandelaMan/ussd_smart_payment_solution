import { useEffect, useMemo, useState } from "react";
import {
  Badge,
  Box,
  Flex,
  Stack,
  Table,
  Text,
} from "@chakra-ui/react";
import { api, formatDate, type ApartmentHistoryEntry } from "../lib/api";
import { useApartmentDetail } from "./ApartmentDetailLayout";
import {
  ApartmentHistoryTimeline,
  ApartmentHistoryTimelineSkeleton,
} from "../components/apartments/ApartmentHistoryTimeline";
import { DisplayText } from "../components/ui/DisplayText";
import { PageErrorBanner } from "../components/ui/pageLayout";
import { DataTable, DataTableCard } from "../components/ui/DataTable";
import { dataTableCellProps } from "../components/ui/DataTable";

const REASON_LABELS: Record<string, string> = {
  signup: "Signed up",
  switch_in: "Moved in",
  switch_out: "Moved out",
  cancel: "Cancelled",
};

export function ApartmentUnitHistoryPage() {
  const { apartment } = useApartmentDetail();
  const [history, setHistory] = useState<ApartmentHistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .getApartmentUnitHistory(
        apartment.buildingId,
        apartment.apartmentNumber
      )
      .then((res) => {
        if (!cancelled) setHistory(res.history || []);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load history"
          );
          setHistory([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apartment.buildingId, apartment.apartmentNumber]);

  const ipTrail = useMemo(() => {
    const seen = new Set<string>();
    const trail: { ip: string; from: string; to: string | null; reason: string }[] =
      [];
    const chronological = [...history].sort(
      (a, b) =>
        new Date(a.movedInAt).getTime() - new Date(b.movedInAt).getTime()
    );
    for (const entry of chronological) {
      const ip = entry.ipAddress?.trim();
      if (!ip || seen.has(ip)) continue;
      seen.add(ip);
      trail.push({
        ip,
        from: entry.movedInAt,
        to: entry.movedOutAt,
        reason: entry.reason,
      });
    }
    return trail;
  }, [history]);

  return (
    <Stack gap={4}>
      {error ? <PageErrorBanner>{error}</PageErrorBanner> : null}

      <Box
        bg="bg.panel"
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="lg"
        p={4}
      >
        <Flex align="center" justify="space-between" gap={3} mb={3} flexWrap="wrap">
          <Box>
            <Text fontSize="sm" fontWeight="semibold">
              Current setup
            </Text>
            <Text fontSize="sm" color="fg.muted" mt={0.5}>
              {apartment.buildingName} · Unit {apartment.apartmentNumber} ·{" "}
              {apartment.ipSetup}
              {apartment.currentIp ? ` · IP ${apartment.currentIp}` : ""}
            </Text>
          </Box>
          <Badge
            colorPalette={apartment.occupied ? "green" : "gray"}
            variant="subtle"
          >
            {apartment.occupied ? "Occupied" : "Vacant"}
          </Badge>
        </Flex>

        {loading ? (
          <ApartmentHistoryTimelineSkeleton />
        ) : (
          <ApartmentHistoryTimeline
            entries={history}
            emptyMessage="No occupancy history for this apartment yet."
          />
        )}
      </Box>

      <Box
        bg="bg.panel"
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="lg"
        p={4}
      >
        <Text fontSize="sm" fontWeight="semibold" mb={3}>
          IP address history
        </Text>
        {loading ? (
          <Text fontSize="sm" color="fg.subtle">
            Loading…
          </Text>
        ) : ipTrail.length === 0 ? (
          <Text fontSize="sm" color="fg.subtle">
            No IP addresses recorded for this apartment yet. New moves will
            store the assigned IP here.
          </Text>
        ) : (
          <DataTableCard>
            <DataTable>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader>IP address</Table.ColumnHeader>
                  <Table.ColumnHeader>First seen</Table.ColumnHeader>
                  <Table.ColumnHeader>Last tenure end</Table.ColumnHeader>
                  <Table.ColumnHeader>Event</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {ipTrail.map((row) => (
                  <Table.Row key={`${row.ip}-${row.from}`}>
                    <Table.Cell {...dataTableCellProps}>
                      <DisplayText value={row.ip} fontFamily="mono" />
                    </Table.Cell>
                    <Table.Cell {...dataTableCellProps}>
                      {formatDate(row.from)}
                    </Table.Cell>
                    <Table.Cell {...dataTableCellProps}>
                      {row.to ? formatDate(row.to) : "Present"}
                    </Table.Cell>
                    <Table.Cell {...dataTableCellProps}>
                      {REASON_LABELS[row.reason] || row.reason}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </DataTable>
          </DataTableCard>
        )}
      </Box>
    </Stack>
  );
}
