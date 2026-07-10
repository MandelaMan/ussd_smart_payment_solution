import { Button } from "@chakra-ui/react";
import { useState } from "react";
import { FiDownload } from "react-icons/fi";
import {
  DEFAULT_EXPORT_FORMATS,
  type ExportColumnOption,
  type ExportFormat,
  type ExportOptions,
  type ExportScope,
} from "../../lib/tableExport";
import { ExportScopeDialog } from "./ExportScopeDialog";

type Props = {
  entityLabel?: string;
  viewCount: number;
  totalCount: number;
  formats?: ExportFormat[];
  columnOptions?: ExportColumnOption[];
  loading?: boolean;
  onExport: (
    scope: ExportScope,
    format: ExportFormat,
    options?: ExportOptions
  ) => Promise<void>;
  size?: "sm" | "md";
};

export function DataTableExportButton({
  entityLabel = "records",
  viewCount,
  totalCount,
  formats = DEFAULT_EXPORT_FORMATS,
  columnOptions,
  loading = false,
  onExport,
  size = "sm",
}: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function handleConfirm(
    scope: ExportScope,
    format: ExportFormat,
    options?: ExportOptions
  ) {
    setConfirming(true);
    try {
      await onExport(scope, format, options);
      setDialogOpen(false);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <>
      <Button
        size={size}
        variant="outline"
        colorPalette="brand"
        loading={loading || confirming}
        onClick={() => setDialogOpen(true)}
      >
        <FiDownload />
        Export
      </Button>

      <ExportScopeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        entityLabel={entityLabel}
        viewCount={viewCount}
        totalCount={totalCount}
        formats={formats}
        columnOptions={columnOptions}
        confirming={confirming}
        onConfirm={(scope, format, options) => void handleConfirm(scope, format, options)}
      />
    </>
  );
}
