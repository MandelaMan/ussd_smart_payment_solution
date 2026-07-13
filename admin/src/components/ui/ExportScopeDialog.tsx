import {
  Box,
  Button,
  Dialog,
  Flex,
  Grid,
  Stack,
  Text,
} from "@chakra-ui/react";
import { useEffect, useMemo, useState } from "react";
import { AppDialog } from "./AppDialog";
import { RowCheckbox } from "./RowCheckbox";
import {
  DEFAULT_EXPORT_FORMATS,
  type ExportColumnOption,
  type ExportFormat,
  type ExportOptions,
  type ExportScope,
} from "../../lib/tableExport";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entityLabel?: string;
  viewCount: number;
  totalCount: number;
  formats?: ExportFormat[];
  columnOptions?: ExportColumnOption[];
  onConfirm: (scope: ExportScope, format: ExportFormat, options?: ExportOptions) => void;
  confirming?: boolean;
};

type ColumnMode = "all" | "custom";

function formatLabel(value: ExportFormat) {
  if (value === "xls") return "XLS";
  if (value === "pdf") return "PDF";
  return "CSV";
}

function titleCase(label: string) {
  if (!label) return "Records";
  return label.charAt(0).toUpperCase() + label.slice(1);
}

type ScopeOptionProps = {
  selected: boolean;
  title: string;
  detail: string;
  onSelect: () => void;
};

function ScopeOption({ selected, title, detail, onSelect }: ScopeOptionProps) {
  return (
    <Box
      as="button"
      onClick={onSelect}
      w="full"
      textAlign="left"
      p={3}
      borderWidth="1px"
      borderColor={selected ? "brand.400" : "gray.200"}
      borderRadius="lg"
      bg={selected ? "brand.50" : "white"}
      boxShadow={selected ? "0 0 0 1px var(--chakra-colors-brand-400)" : "none"}
      transition="border-color 0.15s ease, background 0.15s ease"
      _hover={{
        borderColor: selected ? "brand.500" : "gray.300",
        bg: selected ? "brand.50" : "gray.50",
      }}
    >
      <Flex align="center" justify="space-between" gap={3}>
        <Box minW={0}>
          <Text fontWeight="semibold" color="fg">
            {title}
          </Text>
          <Text fontSize="sm" color="fg.muted" mt={0.5}>
            {detail}
          </Text>
        </Box>
        <Flex
          boxSize="18px"
          borderWidth="2px"
          borderColor={selected ? "brand.600" : "gray.300"}
          borderRadius="full"
          align="center"
          justify="center"
          flexShrink={0}
        >
          {selected ? (
            <Box boxSize="8px" borderRadius="full" bg="brand.600" />
          ) : null}
        </Flex>
      </Flex>
    </Box>
  );
}

function SegmentButton({
  selected,
  label,
  onClick,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      borderRadius={0}
      h="32px"
      px={3}
      fontWeight="semibold"
      color={selected ? "brand.700" : "gray.600"}
      bg={selected ? "brand.50" : "white"}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

export function ExportScopeDialog({
  open,
  onOpenChange,
  entityLabel = "records",
  viewCount,
  totalCount,
  formats = DEFAULT_EXPORT_FORMATS,
  columnOptions,
  onConfirm,
  confirming = false,
}: Props) {
  const [scope, setScope] = useState<ExportScope>("view");
  const [format, setFormat] = useState<ExportFormat>(formats[0] ?? "csv");
  const [columnMode, setColumnMode] = useState<ColumnMode>("all");
  const [includedOptionalKeys, setIncludedOptionalKeys] = useState<Set<string>>(
    () => new Set()
  );

  const optionalColumns = useMemo(
    () => columnOptions?.filter((col) => !col.required) ?? [],
    [columnOptions]
  );

  useEffect(() => {
    if (!open) return;
    setScope("view");
    setFormat(formats[0] ?? "csv");
    setColumnMode("all");
    setIncludedOptionalKeys(new Set(optionalColumns.map((col) => col.key)));
  }, [open, formats, optionalColumns]);

  const label = titleCase(entityLabel);
  const optionalSelectedCount = optionalColumns.filter((col) =>
    includedOptionalKeys.has(col.key)
  ).length;

  function toggleOptionalColumn(key: string) {
    setIncludedOptionalKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function handleConfirm() {
    let options: ExportOptions | undefined;
    if (columnOptions?.length) {
      if (columnMode === "all") {
        options = { columns: "all" };
      } else {
        options = {
          columns: [
            ...columnOptions.filter((col) => col.required).map((col) => col.key),
            ...optionalColumns
              .filter((col) => includedOptionalKeys.has(col.key))
              .map((col) => col.key),
          ],
        };
      }
    }
    onConfirm(scope, format, options);
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={(details) => onOpenChange(details.open)}
      maxW={columnOptions?.length ? "lg" : "md"}
    >
      <Box
        px={5}
        py={3.5}
        pr={12}
        borderBottomWidth="1px"
        borderColor="border.muted"
        w="full"
      >
        <Text fontSize="lg" fontWeight="semibold" color="fg" lineHeight="1.25">
          Export {label.toLowerCase()}
        </Text>
        <Text fontSize="sm" color="fg.muted" mt={1} lineHeight="1.4">
          Choose format, records, and columns to export.
        </Text>
      </Box>

      <Dialog.Body px={5} pt={2.5} pb={3.5}>
        <Stack gap={3}>
          {formats.length > 1 ? (
            <Box>
              <Text fontSize="sm" fontWeight="medium" color="fg" mb={1.5}>
                Format
              </Text>
              <Flex
                borderWidth="1px"
                borderColor="border"
                borderRadius="md"
                overflow="hidden"
                w="fit-content"
              >
                {formats.map((item) => {
                  const selected = format === item;
                  return (
                    <Button
                      key={item}
                      size="sm"
                      variant="ghost"
                      borderRadius={0}
                      h="32px"
                      px={3}
                      fontWeight="semibold"
                      color={selected ? "brand.700" : "gray.600"}
                      bg={selected ? "brand.50" : "white"}
                      borderRightWidth={item !== formats[formats.length - 1] ? "1px" : undefined}
                      borderColor="border"
                      onClick={() => setFormat(item)}
                    >
                      {formatLabel(item)}
                    </Button>
                  );
                })}
              </Flex>
            </Box>
          ) : null}

          <Box>
            <Text fontSize="sm" fontWeight="medium" color="fg" mb={1.5}>
              Records
            </Text>
            <Stack gap={1.5}>
              <ScopeOption
                selected={scope === "view"}
                title="Filtered page"
                detail={`${viewCount.toLocaleString()} rows with current filters`}
                onSelect={() => setScope("view")}
              />
              <ScopeOption
                selected={scope === "all"}
                title="All records"
                detail={`${totalCount.toLocaleString()} rows with current filters`}
                onSelect={() => setScope("all")}
              />
            </Stack>
          </Box>

          {columnOptions?.length ? (
            <Box>
              <Flex align="center" justify="space-between" gap={2} mb={1.5}>
                <Text fontSize="sm" fontWeight="medium" color="fg">
                  Columns
                </Text>
                {columnMode === "custom" ? (
                  <Text fontSize="xs" color="fg.muted">
                    {optionalSelectedCount} of {optionalColumns.length} optional selected
                  </Text>
                ) : null}
              </Flex>
              <Flex
                borderWidth="1px"
                borderColor="border"
                borderRadius="md"
                overflow="hidden"
                w="fit-content"
                mb={2}
              >
                <SegmentButton
                  selected={columnMode === "all"}
                  label="All columns"
                  onClick={() => setColumnMode("all")}
                />
                <Box borderLeftWidth="1px" borderColor="border" />
                <SegmentButton
                  selected={columnMode === "custom"}
                  label="Select columns"
                  onClick={() => setColumnMode("custom")}
                />
              </Flex>

              {columnMode === "custom" ? (
                <Box
                  borderWidth="1px"
                  borderColor="border"
                  borderRadius="md"
                  p={3}
                  bg="bg.subtle"
                  maxH="220px"
                  overflowY="auto"
                >
                  <Grid templateColumns={{ base: "1fr", sm: "1fr 1fr" }} gap={2}>
                    {columnOptions.map((col) => {
                      const checked = col.required || includedOptionalKeys.has(col.key);
                      return (
                        <Flex key={col.key} align="center" gap={2} minW={0}>
                          <RowCheckbox
                            checked={checked}
                            disabled={col.required}
                            onChange={() => toggleOptionalColumn(col.key)}
                            aria-label={col.label}
                          />
                          <Text
                            fontSize="sm"
                            color={col.required ? "gray.800" : "gray.700"}
                            fontWeight={col.required ? "medium" : "normal"}
                            truncate
                          >
                            {col.label}
                            {col.required ? (
                              <Text as="span" fontSize="xs" color="fg.muted" ml={1}>
                                (required)
                              </Text>
                            ) : null}
                          </Text>
                        </Flex>
                      );
                    })}
                  </Grid>
                </Box>
              ) : (
                <Text fontSize="sm" color="fg.muted">
                  All {columnOptions.length} columns will be included.
                </Text>
              )}
            </Box>
          ) : null}
        </Stack>
      </Dialog.Body>

      <Dialog.Footer
        gap={2}
        px={5}
        py={3}
        borderTopWidth="1px"
        borderColor="border.muted"
        justifyContent="flex-end"
      >
        <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={confirming}>
          Cancel
        </Button>
        <Button colorPalette="brand" loading={confirming} onClick={handleConfirm}>
          Export {formatLabel(format)}
        </Button>
      </Dialog.Footer>
    </AppDialog>
  );
}
