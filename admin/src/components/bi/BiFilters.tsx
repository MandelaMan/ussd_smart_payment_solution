import { Box, Button, Flex, Grid, NativeSelect } from "@chakra-ui/react";
import type { BiDashboardFilters, BiFilterOptions } from "../../lib/api";

type Props = {
  filters: BiDashboardFilters;
  options: BiFilterOptions | null;
  onChange: (next: BiDashboardFilters) => void;
  onApply: () => void;
  onReset: () => void;
};

function SelectField({
  label,
  value,
  onChange,
  children,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Box>
      <Box as="label" fontSize="xs" fontWeight="medium" color="fg.muted" mb={1} display="block">
        {label}
      </Box>
      <NativeSelect.Root size="sm" disabled={disabled}>
        <NativeSelect.Field
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {children}
        </NativeSelect.Field>
      </NativeSelect.Root>
    </Box>
  );
}

export function BiFilters({ filters, options, onChange, onApply, onReset }: Props) {
  const optionsLoading = options == null;
  const set = (key: keyof BiDashboardFilters, value: string) => {
    onChange({ ...filters, [key]: value || undefined });
  };

  return (
    <Box
      bg="bg.panel"
      border="1px solid"
      borderColor="border.muted"
      borderRadius="xl"
      p={4}
      boxShadow="sm"
    >
      <Grid
        templateColumns={{ base: "1fr", md: "repeat(2, 1fr)", xl: "repeat(4, 1fr)" }}
        gap={3}
      >
        <Box>
          <Box as="label" fontSize="xs" fontWeight="medium" color="fg.muted" mb={1} display="block">
            From
          </Box>
          <input
            type="date"
            value={filters.from || ""}
            onChange={(e) => set("from", e.target.value)}
            disabled={optionsLoading}
            style={{
              width: "100%",
              padding: "6px 10px",
              borderRadius: "6px",
              border: "1px solid var(--chakra-colors-gray-200)",
              fontSize: "14px",
              opacity: optionsLoading ? 0.65 : 1,
            }}
          />
        </Box>
        <Box>
          <Box as="label" fontSize="xs" fontWeight="medium" color="fg.muted" mb={1} display="block">
            To
          </Box>
          <input
            type="date"
            value={filters.to || ""}
            onChange={(e) => set("to", e.target.value)}
            disabled={optionsLoading}
            style={{
              width: "100%",
              padding: "6px 10px",
              borderRadius: "6px",
              border: "1px solid var(--chakra-colors-gray-200)",
              fontSize: "14px",
              opacity: optionsLoading ? 0.65 : 1,
            }}
          />
        </Box>
        <SelectField
          label="Area (Building)"
          value={filters.buildingId || ""}
          onChange={(v) => set("buildingId", v)}
          disabled={optionsLoading}
        >
          <option value="">{optionsLoading ? "Loading…" : "All areas"}</option>
          {(options?.buildings || []).map((b) => (
            <option key={b.id} value={String(b.id)}>
              {b.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Package"
          value={filters.productId || ""}
          onChange={(v) => set("productId", v)}
          disabled={optionsLoading}
        >
          <option value="">{optionsLoading ? "Loading…" : "All packages"}</option>
          {(options?.products || []).map((p) => (
            <option key={p.id} value={String(p.id)}>
              {p.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Sales Agent (Agency)"
          value={filters.agencyId || ""}
          onChange={(v) => set("agencyId", v)}
          disabled={optionsLoading}
        >
          <option value="">{optionsLoading ? "Loading…" : "All agents"}</option>
          {(options?.agencies || []).map((a) => (
            <option key={a.id} value={String(a.id)}>
              {a.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Customer Status"
          value={filters.customerStatus || ""}
          onChange={(v) => set("customerStatus", v)}
          disabled={optionsLoading}
        >
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="cancelled">Cancelled</option>
        </SelectField>
        <SelectField
          label="TV Package"
          value={
            filters.internetTv === "true"
              ? "tv"
              : filters.internetOnly === "true"
                ? "internet"
                : ""
          }
          onChange={(v) => {
            onChange({
              ...filters,
              internetOnly: v === "internet" ? "true" : undefined,
              internetTv: v === "tv" ? "true" : undefined,
            });
          }}
          disabled={optionsLoading}
        >
          <option value="">All</option>
          <option value="internet">Internet only</option>
          <option value="tv">Internet + TV</option>
        </SelectField>
        <SelectField
          label="Subscription Status"
          value={filters.subscriptionStatus || ""}
          onChange={(v) => set("subscriptionStatus", v)}
          disabled={optionsLoading}
        >
          <option value="">All</option>
          <option value="active">Active</option>
          <option value="suspend">Suspended</option>
          <option value="disconnect">Disconnected</option>
        </SelectField>
      </Grid>
      <Flex mt={4} gap={2} justify="flex-end" flexWrap="wrap">
        <Button size="sm" variant="outline" onClick={onReset} disabled={optionsLoading}>
          Reset
        </Button>
        <Button size="sm" colorPalette="brand" onClick={onApply} disabled={optionsLoading}>
          Apply filters
        </Button>
      </Flex>
    </Box>
  );
}
