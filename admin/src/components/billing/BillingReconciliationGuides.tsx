import { Box, Collapsible, Flex, List, Stack, Text } from "@chakra-ui/react";
import { useState } from "react";
import { FiBookOpen, FiChevronDown, FiChevronRight, FiMapPin } from "react-icons/fi";
import { Link as RouterLink } from "react-router-dom";
import {
  BILLING_RECONCILIATION_GUIDES,
  type BillingGuideId,
} from "../../lib/billingReconciliationGuides";
import {
  BILLING_MODULES,
  billingModulePath,
  moduleCount,
  type BillingModuleId,
} from "../../lib/billingReconciliationNav";
import type { ReconciliationSummary } from "../../lib/api";

type Props = {
  summary: ReconciliationSummary | null;
  activeGuideId?: BillingGuideId;
};

const MODULE_GUIDE_IDS = new Set<BillingModuleId>([
  "unallocated-mpesa",
  "billing-gaps",
  "manual-review",
  "customer-communications",
]);

function guideCount(summary: ReconciliationSummary | null, id: BillingGuideId) {
  if (!summary || id === "sync" || id === "metrics") return null;
  if (!MODULE_GUIDE_IDS.has(id as BillingModuleId)) return null;
  const module = BILLING_MODULES.find((m) => m.id === id);
  if (!module) return null;
  return moduleCount(summary, module);
}

function GuideCard({
  guide,
  summary,
  active,
}: {
  guide: (typeof BILLING_RECONCILIATION_GUIDES)[number];
  summary: ReconciliationSummary | null;
  active: boolean;
}) {
  const count = guideCount(summary, guide.id);
  const module =
    guide.id !== "sync" && guide.id !== "metrics"
      ? BILLING_MODULES.find((m) => m.id === guide.id)
      : null;
  const [open, setOpen] = useState(active || (count != null && count > 0));

  return (
    <Box
      border="1px solid"
      borderColor={active ? "brand.300" : "brand.100"}
      borderRadius="md"
      bg="white"
      overflow="hidden"
    >
      <Flex
        align="center"
        gap={2}
        px={3}
        py={2.5}
        cursor="pointer"
        _hover={{ bg: "brand.50" }}
        w="full"
        onClick={() => setOpen((v) => !v)}
        role="button"
        aria-expanded={open}
      >
        {open ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}
        <Text fontSize="sm" fontWeight="semibold" color="brand.800" flex={1} minW={0} whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis">
          {guide.title}
        </Text>
        {count != null && count > 0 && (
          <Text fontSize="xs" fontWeight="bold" color="orange.600" flexShrink={0}>
            {count} open
          </Text>
        )}
      </Flex>

      <Collapsible.Root open={open}>
        <Collapsible.Content>
          <Box px={3} pb={3} pt={0} borderTop="1px solid" borderColor="gray.100">
            <Text fontSize="xs" color="gray.700" mt={2} lineHeight="1.5">
              {guide.whenToUse}
            </Text>

            <Text
              fontSize="2xs"
              fontWeight="semibold"
              color="brand.700"
              mt={3}
              mb={1}
              textTransform="uppercase"
            >
              What to do
            </Text>
            <List.Root
              fontSize="xs"
              color="gray.700"
              gap={1.5}
              pl={4}
              style={{ listStyleType: "decimal" }}
            >
              {guide.steps.map((step) => (
                <List.Item key={step} lineHeight="1.5">
                  {step}
                </List.Item>
              ))}
            </List.Root>

            <Flex align="center" gap={1.5} mt={3} mb={1}>
              <FiMapPin size={12} color="var(--chakra-colors-gray-500)" />
              <Text fontSize="2xs" fontWeight="semibold" color="brand.700" textTransform="uppercase">
                Where to check
              </Text>
            </Flex>
            <List.Root fontSize="xs" color="gray.700" gap={1} pl={4} style={{ listStyleType: "disc" }}>
              {guide.whereToCheck.map((item) => (
                <List.Item key={item} lineHeight="1.5">
                  {item}
                </List.Item>
              ))}
            </List.Root>

            {module && (
              <RouterLink to={billingModulePath(module)} style={{ textDecoration: "none" }}>
                <Text
                  fontSize="xs"
                  color="brand.600"
                  fontWeight="medium"
                  mt={3}
                  _hover={{ textDecoration: "underline" }}
                >
                  Open {module.label} →
                </Text>
              </RouterLink>
            )}
          </Box>
        </Collapsible.Content>
      </Collapsible.Root>
    </Box>
  );
}

export function BillingReconciliationGuides({ summary, activeGuideId }: Props) {
  return (
    <Box>
      <Box mb={3}>
        <Flex align="center" gap={2} minH="24px">
          <Box flexShrink={0} color="brand.600" lineHeight={0}>
            <FiBookOpen size={16} />
          </Box>
          <Text
            fontSize="sm"
            fontWeight="semibold"
            color="brand.800"
            whiteSpace="nowrap"
            lineHeight="1.25"
          >
            How to fix issues
          </Text>
        </Flex>
        <Text fontSize="xs" color="gray.600" mt={1} pl={6} lineHeight="1.45">
          Step-by-step guides for each billing problem and where to verify in the dashboard
        </Text>
      </Box>

      <Stack gap={2}>
        {BILLING_RECONCILIATION_GUIDES.map((guide) => (
          <GuideCard
            key={guide.id}
            guide={guide}
            summary={summary}
            active={activeGuideId === guide.id}
          />
        ))}
      </Stack>
    </Box>
  );
}
