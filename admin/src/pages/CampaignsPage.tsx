import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Dialog,
  Field,
  Flex,
  Grid,
  Heading,
  Input,
  Stack,
  Text,
  Textarea,
} from "@chakra-ui/react";
import { FiPlus, FiRefreshCw } from "react-icons/fi";
import {
  api,
  formatCurrency,
  type Campaign,
  type CampaignMetrics,
} from "../lib/api";
import { useAuth } from "../lib/authContext";
import { canMutateCampaigns } from "../lib/rbac";
import { toaster } from "../components/ui/toaster";
import { AppDialog } from "../components/ui/AppDialog";
import { DateField } from "../components/ui/DateField";
import { SelectField } from "../components/ui/SelectField";
import { PAGE_STACK_GAP, PageErrorBanner, PageHeader } from "../components/ui/pageLayout";
import { SettingsPanelSkeleton } from "../components/PageSkeletons";
import { MetricCard } from "../components/MetricCard";
import { BRAND } from "../theme";
import {
  CampaignActionMenu,
  type CampaignAction,
} from "../components/campaigns/CampaignActionMenu";

function toDateInputValue(value: string | null | undefined) {
  if (!value) return "";
  const s = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function isCampaignLiveNow(campaign: Campaign) {
  if (campaign.status !== "active") return false;
  if (!campaign.startsAt || !campaign.endsAt) return false;
  const now = Date.now();
  const start = new Date(campaign.startsAt).getTime();
  const end = new Date(campaign.endsAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  return now >= start && now <= end;
}

function emptyMetrics(): CampaignMetrics {
  return {
    applications: 0,
    discountAmountTotal: 0,
    referralsPending: 0,
    referralsQualified: 0,
    referralsRewarded: 0,
    referralsCancelled: 0,
    rewardsQueued: 0,
    rewardsApplied: 0,
    rewardsRestored: 0,
    rewardsFailed: 0,
  };
}

type Draft = {
  id?: number;
  code: string;
  name: string;
  status: "draft" | "active" | "paused" | "ended";
  startsAt: string;
  endsAt: string;
  newCustomerDiscountPercent: string;
  referrerRewardPercent: string;
  priority: string;
  description: string;
};

function draftFromCampaign(c?: Campaign | null): Draft {
  if (!c) {
    const start = new Date();
    const end = new Date();
    end.setDate(end.getDate() + 30);
    return {
      code: "",
      name: "",
      status: "draft",
      startsAt: start.toISOString().slice(0, 10),
      endsAt: end.toISOString().slice(0, 10),
      newCustomerDiscountPercent: "50",
      referrerRewardPercent: "10",
      priority: "100",
      description: "",
    };
  }
  return {
    id: c.id,
    code: c.code,
    name: c.name,
    status: c.status,
    startsAt: toDateInputValue(c.startsAt),
    endsAt: toDateInputValue(c.endsAt),
    newCustomerDiscountPercent: String(c.newCustomerDiscountPercent ?? 50),
    referrerRewardPercent: String(c.referrerRewardPercent ?? 10),
    priority: String(c.priority ?? 100),
    description: c.description || "",
  };
}

const TILE_ACCENTS = {
  live: {
    bg: "linear-gradient(145deg, #ecfdf5 0%, #d1fae5 100%)",
    border: "#6ee7b7",
    label: "#047857",
    value: "#065f46",
  },
  signup: {
    bg: `linear-gradient(145deg, #e6f3f7 0%, #c5e4ef 100%)`,
    border: BRAND.paleAzure,
    label: BRAND.cerulean,
    value: "#0e4858",
  },
  discount: {
    bg: `linear-gradient(145deg, #fff4e8 0%, #ffe0bd 100%)`,
    border: BRAND.sandyBrown,
    label: "#b45309",
    value: "#9a3412",
  },
  referral: {
    bg: `linear-gradient(145deg, #f7f9e8 0%, ${BRAND.mindaro} 100%)`,
    border: "#c5cb6a",
    label: "#4d7c0f",
    value: "#365314",
  },
  pending: {
    bg: "linear-gradient(145deg, #eff6ff 0%, #dbeafe 100%)",
    border: "#93c5fd",
    label: "#1d4ed8",
    value: "#1e3a8a",
  },
  flight: {
    bg: "linear-gradient(145deg, #eef9fd 0%, #c5eaf8 100%)",
    border: "#6dcff6",
    label: "#166a82",
    value: "#0e4858",
  },
} as const;

type TileAccent = keyof typeof TILE_ACCENTS;

function MetricTile({
  label,
  value,
  hint,
  accent = "signup",
}: {
  label: string;
  value: string | number;
  hint?: string;
  accent?: TileAccent;
}) {
  const style = TILE_ACCENTS[accent];
  return (
    <Box
      border="1px solid"
      borderColor={style.border}
      borderRadius="md"
      bg={style.bg}
      px={3}
      py={2.5}
      minW={0}
    >
      <Text fontSize="xs" fontWeight="semibold" color={style.label} mb={0.5}>
        {label}
      </Text>
      <Text
        fontWeight="bold"
        fontSize="lg"
        fontFamily="mono"
        color={style.value}
        letterSpacing="-0.02em"
      >
        {value}
      </Text>
      {hint ? (
        <Text fontSize="xs" color={style.label} mt={0.5} opacity={0.85}>
          {hint}
        </Text>
      ) : null}
    </Box>
  );
}

function statusBadgePalette(status: Campaign["status"], live: boolean) {
  if (live) return "green";
  if (status === "paused") return "yellow";
  if (status === "active") return "blue";
  if (status === "ended") return "orange";
  return "gray";
}

function campaignCardAccent(live: boolean, status: Campaign["status"]) {
  if (live) {
    return {
      borderLeftColor: "#10b981",
      headerBg: "linear-gradient(90deg, #ecfdf5 0%, transparent 70%)",
    };
  }
  if (status === "paused") {
    return {
      borderLeftColor: "#eab308",
      headerBg: "linear-gradient(90deg, #fefce8 0%, transparent 70%)",
    };
  }
  if (status === "active") {
    return {
      borderLeftColor: BRAND.cerulean,
      headerBg: `linear-gradient(90deg, #e6f3f7 0%, transparent 70%)`,
    };
  }
  if (status === "ended") {
    return {
      borderLeftColor: BRAND.sandyBrown,
      headerBg: `linear-gradient(90deg, #fff4e8 0%, transparent 70%)`,
    };
  }
  return {
    borderLeftColor: "#94a3b8",
    headerBg: "linear-gradient(90deg, #f1f5f9 0%, transparent 70%)",
  };
}

export function CampaignsPage() {
  const { user } = useAuth();
  const canMutate = canMutateCampaigns(user);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftFromCampaign());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Campaign | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [actionBusyId, setActionBusyId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api.listCampaigns({ metrics: "true" });
      setCampaigns(res.campaigns || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    return campaigns.reduce((acc, c) => {
      const m = c.metrics || emptyMetrics();
      acc.applications += m.applications;
      acc.discountAmountTotal += m.discountAmountTotal;
      acc.referralsRewarded += m.referralsRewarded;
      acc.rewardsApplied += m.rewardsApplied;
      acc.live += isCampaignLiveNow(c) ? 1 : 0;
      return acc;
    }, {
      applications: 0,
      discountAmountTotal: 0,
      referralsRewarded: 0,
      rewardsApplied: 0,
      live: 0,
    });
  }, [campaigns]);

  function openCreate() {
    setDraft(draftFromCampaign());
    setDialogOpen(true);
  }

  function openEdit(c: Campaign) {
    setDraft(draftFromCampaign(c));
    setDialogOpen(true);
  }

  async function setCampaignStatus(
    campaign: Campaign,
    status: "active" | "paused"
  ) {
    setActionBusyId(campaign.id);
    try {
      await api.updateCampaign(campaign.id, { status });
      toaster.create({
        title: status === "paused" ? "Campaign paused" : "Campaign resumed",
        type: "success",
      });
      await load();
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Update failed",
        type: "error",
      });
    } finally {
      setActionBusyId(null);
    }
  }

  async function handleCampaignAction(
    campaign: Campaign,
    action: CampaignAction
  ) {
    if (action === "edit") {
      openEdit(campaign);
      return;
    }
    if (action === "pause") {
      await setCampaignStatus(campaign, "paused");
      return;
    }
    if (action === "resume") {
      await setCampaignStatus(campaign, "active");
      return;
    }
    if (action === "delete") {
      setDeleting(campaign);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleting) return;
    setDeleteSubmitting(true);
    try {
      await api.deleteCampaign(deleting.id);
      toaster.create({ title: "Campaign deleted", type: "success" });
      setDeleting(null);
      await load();
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Delete failed",
        type: "error",
      });
    } finally {
      setDeleteSubmitting(false);
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) {
      toaster.create({ title: "Name is required", type: "error" });
      return;
    }
    if (!draft.id && !draft.code.trim()) {
      toaster.create({ title: "Code is required", type: "error" });
      return;
    }
    if (!draft.startsAt) {
      toaster.create({ title: "Start date is required", type: "error" });
      return;
    }
    if (!draft.endsAt) {
      toaster.create({ title: "End date is required", type: "error" });
      return;
    }
    if (draft.endsAt < draft.startsAt) {
      toaster.create({
        title: "End date must be on or after the start date",
        type: "error",
      });
      return;
    }
    const newPct = Number(draft.newCustomerDiscountPercent);
    const refPct = Number(draft.referrerRewardPercent);
    const priority = Number(draft.priority);
    if (!Number.isFinite(newPct) || newPct < 0 || newPct > 100) {
      toaster.create({ title: "New customer % must be 0–100", type: "error" });
      return;
    }
    if (!Number.isFinite(refPct) || refPct < 0 || refPct > 100) {
      toaster.create({ title: "Referrer % must be 0–100", type: "error" });
      return;
    }
    if (!Number.isFinite(priority)) {
      toaster.create({ title: "Priority must be a number", type: "error" });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        name: draft.name.trim(),
        status: draft.status,
        startsAt: `${draft.startsAt}T00:00:00.000Z`,
        endsAt: `${draft.endsAt}T23:59:59.999Z`,
        newCustomerDiscountPercent: newPct,
        referrerRewardPercent: refPct,
        priority,
        description: draft.description.trim() || null,
      };
      if (draft.id) {
        await api.updateCampaign(draft.id, payload);
        toaster.create({ title: "Campaign updated", type: "success" });
      } else {
        await api.createCampaign({
          ...payload,
          code: draft.code.trim().toUpperCase(),
        });
        toaster.create({ title: "Campaign created", type: "success" });
      }
      setDialogOpen(false);
      await load();
    } catch (err) {
      toaster.create({
        title: err instanceof Error ? err.message : "Save failed",
        type: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap={PAGE_STACK_GAP}>
      <PageHeader
        title="Campaigns"
        actions={
          <Flex gap={2}>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void load()}
              disabled={loading}
            >
              <FiRefreshCw />
              Refresh
            </Button>
            {canMutate ? (
              <Button size="sm" colorPalette="brand" onClick={openCreate}>
                <FiPlus />
                New campaign
              </Button>
            ) : null}
          </Flex>
        }
      />

      {error ? <PageErrorBanner>{error}</PageErrorBanner> : null}

      {loading && !campaigns.length ? (
        <SettingsPanelSkeleton />
      ) : (
        <>
          <Grid
            templateColumns={{
              base: "1fr 1fr",
              md: "repeat(4, minmax(0, 1fr))",
            }}
            gap={3}
          >
            <MetricCard label="Live now" value={totals.live} accent="teal" />
            <MetricCard
              label="Signups discounted"
              value={totals.applications}
              accent="cerulean"
            />
            <MetricCard
              label="Discount given"
              value={formatCurrency(totals.discountAmountTotal)}
              accent="sandy"
            />
            <MetricCard
              label="Referrals rewarded"
              value={totals.referralsRewarded}
              sub={`${totals.rewardsApplied} cycles applied`}
              accent="mindaro"
            />
          </Grid>

          <Stack gap={3}>
            {campaigns.map((c) => {
              const m = c.metrics || emptyMetrics();
              const live = isCampaignLiveNow(c);
              const cardAccent = campaignCardAccent(live, c.status);
              return (
                <Box
                  key={c.id}
                  border="1px solid"
                  borderColor="border.muted"
                  borderLeftWidth="4px"
                  borderLeftColor={cardAccent.borderLeftColor}
                  borderRadius="lg"
                  bg="bg.panel"
                  overflow="hidden"
                  boxShadow="sm"
                >
                  <Box
                    bg={cardAccent.headerBg}
                    px={{ base: 3, md: 4 }}
                    pt={{ base: 3, md: 4 }}
                    pb={3}
                  >
                    <Flex
                      justify="space-between"
                      align={{ base: "start", md: "center" }}
                      gap={3}
                      flexWrap="wrap"
                    >
                      <Box minW={0}>
                        <Flex align="center" gap={2} flexWrap="wrap" mb={1}>
                          <Heading size="sm">{c.name}</Heading>
                          <Badge
                            colorPalette={statusBadgePalette(c.status, live)}
                            variant="solid"
                            size="sm"
                          >
                            {live ? "Live" : c.status}
                          </Badge>
                          <Text
                            fontSize="xs"
                            color="fg.muted"
                            fontFamily="mono"
                          >
                            {c.code} · priority {c.priority}
                          </Text>
                        </Flex>
                        <Text fontSize="sm" color="fg.muted">
                          {toDateInputValue(c.startsAt) || "—"} →{" "}
                          {toDateInputValue(c.endsAt) || "—"} ·{" "}
                          {c.newCustomerDiscountPercent}% first invoice ·{" "}
                          {c.referrerRewardPercent}% referrer
                        </Text>
                      </Box>
                      {canMutate ? (
                        <CampaignActionMenu
                          campaign={c}
                          onAction={(campaign, action) => {
                            if (actionBusyId === campaign.id) return;
                            void handleCampaignAction(campaign, action);
                          }}
                        />
                      ) : null}
                    </Flex>
                  </Box>

                  <Grid
                    templateColumns={{
                      base: "1fr 1fr",
                      md: "repeat(5, minmax(0, 1fr))",
                    }}
                    gap={2}
                    px={{ base: 3, md: 4 }}
                    pb={{ base: 3, md: 4 }}
                  >
                    <MetricTile
                      label="Applications"
                      value={m.applications}
                      accent="signup"
                    />
                    <MetricTile
                      label="Discount $"
                      value={formatCurrency(m.discountAmountTotal)}
                      accent="discount"
                    />
                    <MetricTile
                      label="Referrals pending"
                      value={m.referralsPending}
                      accent="pending"
                    />
                    <MetricTile
                      label="Referrals rewarded"
                      value={m.referralsRewarded}
                      accent="referral"
                    />
                    <MetricTile
                      label="Rewards in flight"
                      value={m.rewardsQueued + m.rewardsApplied}
                      accent="flight"
                      hint={
                        m.rewardsFailed
                          ? `${m.rewardsFailed} failed`
                          : undefined
                      }
                    />
                  </Grid>
                </Box>
              );
            })}
            {!campaigns.length ? (
              <Text fontSize="sm" color="fg.muted">
                No campaigns yet.
              </Text>
            ) : null}
          </Stack>
        </>
      )}

      <AppDialog
        open={dialogOpen}
        onOpenChange={(d) => setDialogOpen(d.open)}
        maxW="lg"
      >
        <Dialog.Header pr={12}>
          <Dialog.Title>
            {draft.id ? "Edit campaign" : "New campaign"}
          </Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
        <form onSubmit={(e) => void save(e)}>
          <Stack gap={4}>
            {!draft.id ? (
              <Field.Root required>
                <Field.Label>Code</Field.Label>
                <Input
                  value={draft.code}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      code: e.target.value.toUpperCase(),
                    }))
                  }
                  placeholder="e.g. LAUNCH50"
                  fontFamily="mono"
                />
              </Field.Root>
            ) : null}
            <Field.Root required>
              <Field.Label>Name</Field.Label>
              <Input
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
              />
            </Field.Root>
            <Flex gap={4} direction={{ base: "column", md: "row" }}>
              <Field.Root flex="1">
                <Field.Label>Status</Field.Label>
                <SelectField
                  fieldProps={{
                    value: draft.status,
                    onChange: (e) =>
                      setDraft((d) => ({
                        ...d,
                        status: e.target.value as Draft["status"],
                      })),
                  }}
                >
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="ended">Ended</option>
                </SelectField>
              </Field.Root>
              <Field.Root flex="1">
                <Field.Label>Priority</Field.Label>
                <Input
                  type="number"
                  value={draft.priority}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, priority: e.target.value }))
                  }
                />
              </Field.Root>
            </Flex>
            <Flex gap={4} direction={{ base: "column", md: "row" }}>
              <Field.Root flex="1" required>
                <Field.Label>Start date</Field.Label>
                <DateField
                  value={draft.startsAt}
                  onChange={(v) => setDraft((d) => ({ ...d, startsAt: v }))}
                />
              </Field.Root>
              <Field.Root flex="1" required>
                <Field.Label>End date</Field.Label>
                <DateField
                  value={draft.endsAt}
                  onChange={(v) => setDraft((d) => ({ ...d, endsAt: v }))}
                  min={draft.startsAt || undefined}
                />
              </Field.Root>
            </Flex>
            <Flex gap={4} direction={{ base: "column", md: "row" }}>
              <Field.Root flex="1">
                <Field.Label>New customer discount %</Field.Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.newCustomerDiscountPercent}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      newCustomerDiscountPercent: e.target.value,
                    }))
                  }
                />
              </Field.Root>
              <Field.Root flex="1">
                <Field.Label>Referrer reward %</Field.Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={draft.referrerRewardPercent}
                  onChange={(e) =>
                    setDraft((d) => ({
                      ...d,
                      referrerRewardPercent: e.target.value,
                    }))
                  }
                />
              </Field.Root>
            </Flex>
            <Field.Root>
              <Field.Label>Description</Field.Label>
              <Textarea
                value={draft.description}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, description: e.target.value }))
                }
                rows={3}
              />
            </Field.Root>
            <Flex justify="flex-end" gap={2}>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" colorPalette="brand" loading={saving}>
                Save
              </Button>
            </Flex>
          </Stack>
        </form>
        </Dialog.Body>
      </AppDialog>

      <AppDialog
        open={Boolean(deleting)}
        onOpenChange={(d) => {
          if (!d.open && !deleteSubmitting) setDeleting(null);
        }}
        maxW="md"
      >
        <Dialog.Header pr={12}>
          <Dialog.Title>Delete campaign</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body>
          <Stack gap={4}>
            <Text fontSize="sm">
              Delete{" "}
              <Text as="span" fontWeight="semibold">
                {deleting?.name}
              </Text>
              {deleting?.code ? ` (${deleting.code})` : ""}? This cannot be
              undone. Campaigns with signup or referral history cannot be
              deleted — pause or end them instead.
            </Text>
            <Flex justify="flex-end" gap={2}>
              <Button
                type="button"
                variant="outline"
                disabled={deleteSubmitting}
                onClick={() => setDeleting(null)}
              >
                Cancel
              </Button>
              <Button
                colorPalette="red"
                loading={deleteSubmitting}
                onClick={() => void handleDeleteConfirm()}
              >
                Delete
              </Button>
            </Flex>
          </Stack>
        </Dialog.Body>
      </AppDialog>
    </Stack>
  );
}
