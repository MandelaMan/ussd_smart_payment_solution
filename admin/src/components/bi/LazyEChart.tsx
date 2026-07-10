import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";
import { Box } from "@chakra-ui/react";
import { useMemo } from "react";

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
      <ReactECharts
        option={merged as EChartsOption}
        style={{ width: "100%", height: "100%" }}
        opts={{ renderer: "canvas" }}
        notMerge
        lazyUpdate
        onEvents={onEvents}
      />
    </Box>
  );
}
