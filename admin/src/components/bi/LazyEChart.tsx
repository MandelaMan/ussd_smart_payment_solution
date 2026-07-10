import { Box, Flex, Spinner } from "@chakra-ui/react";
import { lazy, Suspense, useMemo } from "react";
import type { EChartsOption } from "echarts";
import { BRAND } from "../../theme";

const ReactECharts = lazy(() => import("echarts-for-react"));

type Props = {
  option: object;
  height?: string;
  onEvents?: Record<string, (params: unknown) => void>;
};

export function LazyEChart({ option, height = "260px", onEvents }: Props) {
  const merged = useMemo(
    () => ({
      ...option,
      animation: true,
      textStyle: { fontFamily: "inherit" },
    }),
    [option]
  );

  return (
    <Box w="100%" h={height}>
      <Suspense
        fallback={
          <Flex h="100%" align="center" justify="center">
            <Spinner color={BRAND.cerulean} size="md" borderWidth="2px" />
          </Flex>
        }
      >
        <ReactECharts
          option={merged as EChartsOption}
          style={{ width: "100%", height: "100%" }}
          opts={{ renderer: "canvas" }}
          notMerge
          lazyUpdate
          onEvents={onEvents}
        />
      </Suspense>
    </Box>
  );
}
