import { Box, Stack, Text } from "@chakra-ui/react";
import type { ForecastInsight } from "../../lib/api";

const TONE: Record<string, { border: string; bg: string; color: string }> = {
  success: { border: "green.200", bg: "green.50", color: "green.800" },
  warning: { border: "orange.200", bg: "orange.50", color: "orange.900" },
  danger: { border: "red.200", bg: "red.50", color: "red.800" },
  info: { border: "blue.200", bg: "blue.50", color: "blue.900" },
};

export function BiInsightsFeed({ insights }: { insights: ForecastInsight[] }) {
  if (!insights.length) return null;
  return (
    <Stack gap={2}>
      <Text fontSize="sm" fontWeight="semibold">
        AI-assisted insights
      </Text>
      <Text fontSize="xs" color="fg.muted" mb={1}>
        Rule-based recommendations from the shared forecast engine (Phase 3 foundation).
      </Text>
      {insights.map((insight, idx) => {
        const tone = TONE[insight.severity] || TONE.info;
        return (
          <Box
            key={`${insight.title}-${idx}`}
            borderWidth="1px"
            borderColor={tone.border}
            bg={tone.bg}
            borderRadius="lg"
            p={3}
          >
            <Text fontSize="sm" fontWeight="semibold" color={tone.color}>
              {insight.title}
            </Text>
            <Text fontSize="sm" color={tone.color} mt={1}>
              {insight.detail}
            </Text>
            {insight.action ? (
              <Text fontSize="xs" color="fg.muted" mt={2}>
                Next: {insight.action}
              </Text>
            ) : null}
          </Box>
        );
      })}
    </Stack>
  );
}
