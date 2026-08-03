import { useEffect, useState } from "react";
import {
  Box,
  Button,
  Flex,
  Input,
  Stack,
  Text,
} from "@chakra-ui/react";
import { api, type ReportDefinition, type ReportSchedule } from "../lib/api";
import { toaster } from "./ui/toaster";
import { SelectField } from "./ui/SelectField";

type Props = {
  reports: ReportDefinition[];
};

export function ReportSchedulesPanel({ reports }: Props) {
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [reportId, setReportId] = useState("");
  const [recipients, setRecipients] = useState("");
  const [format, setFormat] = useState<"xlsx" | "pdf" | "csv">("xlsx");
  const [cronExpr, setCronExpr] = useState("0 7 1 * *");
  const [saving, setSaving] = useState(false);

  const available = reports.filter((r) => r.available !== false);

  async function reload() {
    setLoading(true);
    try {
      const res = await api.listReportSchedules();
      setSchedules(res.schedules);
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Failed to load schedules",
        type: "error",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    if (!reportId && available[0]) setReportId(available[0].id);
  }, [available, reportId]);

  async function handleCreate() {
    const emails = recipients
      .split(/[,;\s]+/)
      .map((e) => e.trim())
      .filter(Boolean);
    if (!reportId || !emails.length) {
      toaster.create({ title: "Pick a report and at least one email", type: "warning" });
      return;
    }
    setSaving(true);
    try {
      await api.createReportSchedule({
        reportId,
        format,
        cronExpr,
        recipients: emails,
      });
      setRecipients("");
      toaster.create({ title: "Schedule created", type: "success" });
      await reload();
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Could not create schedule",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleRun(id: number) {
    try {
      const res = await api.runReportSchedule(id);
      toaster.create({
        title: "Schedule run queued",
        description: res.message,
        type: "success",
      });
      await reload();
    } catch (e) {
      toaster.create({
        title: e instanceof Error ? e.message : "Run failed",
        type: "error",
      });
    }
  }

  return (
    <Box borderWidth="1px" borderColor="border" borderRadius="lg" p={4}>
      <Text fontWeight="semibold" mb={1}>
        Scheduled delivery (Phase 3)
      </Text>
      <Text fontSize="xs" color="fg.muted" mb={3}>
        Generate on a cadence and queue email. Mail transport connection enables automatic send.
      </Text>

      <Stack gap={3} mb={4}>
        <Box>
          <Text fontSize="xs" color="fg.muted" mb={1}>
            Report
          </Text>
          <SelectField
            size="sm"
            fieldProps={{
              value: reportId,
              onChange: (e) => setReportId(e.target.value),
            }}
          >
            {available.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </SelectField>
        </Box>
        <Flex gap={3} flexWrap="wrap">
          <Box flex="1" minW="160px">
            <Text fontSize="xs" color="fg.muted" mb={1}>
              Format
            </Text>
            <SelectField
              size="sm"
              fieldProps={{
                value: format,
                onChange: (e) => setFormat(e.target.value as "xlsx" | "pdf" | "csv"),
              }}
            >
              <option value="xlsx">Excel</option>
              <option value="csv">CSV</option>
              <option value="pdf">PDF</option>
            </SelectField>
          </Box>
          <Box flex="1" minW="160px">
            <Text fontSize="xs" color="fg.muted" mb={1}>
              Cron
            </Text>
            <Input size="sm" value={cronExpr} onChange={(e) => setCronExpr(e.target.value)} />
          </Box>
        </Flex>
        <Box>
          <Text fontSize="xs" color="fg.muted" mb={1}>
            Recipients (comma-separated)
          </Text>
          <Input
            size="sm"
            placeholder="cfo@company.com, ceo@company.com"
            value={recipients}
            onChange={(e) => setRecipients(e.target.value)}
          />
        </Box>
        <Button size="sm" colorPalette="brand" loading={saving} onClick={() => void handleCreate()}>
          Create schedule
        </Button>
      </Stack>

      {loading ? (
        <Text fontSize="sm" color="fg.muted">
          Loading schedules…
        </Text>
      ) : schedules.length === 0 ? (
        <Text fontSize="sm" color="fg.muted">
          No schedules yet.
        </Text>
      ) : (
        <Stack gap={2}>
          {schedules.map((s) => (
            <Flex
              key={s.id}
              justify="space-between"
              gap={3}
              align="center"
              borderWidth="1px"
              borderColor="border"
              borderRadius="md"
              p={2}
              flexWrap="wrap"
            >
              <Stack gap={0} minW={0}>
                <Text fontSize="sm" fontWeight="medium">
                  {s.title}
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  {s.reportId} · {s.format} · {s.cronExpr} · {s.recipients.join(", ")}
                  {s.active ? "" : " · paused"}
                </Text>
              </Stack>
              <Flex gap={2}>
                <Button size="xs" variant="outline" onClick={() => void handleRun(s.id)}>
                  Run now
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() =>
                    void api.setReportScheduleActive(s.id, !s.active).then(reload)
                  }
                >
                  {s.active ? "Pause" : "Resume"}
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  colorPalette="red"
                  onClick={() => void api.deleteReportSchedule(s.id).then(reload)}
                >
                  Delete
                </Button>
              </Flex>
            </Flex>
          ))}
        </Stack>
      )}
    </Box>
  );
}
