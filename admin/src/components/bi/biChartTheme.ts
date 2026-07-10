import type { EChartsOption } from "echarts";
import { BRAND } from "../../theme";

export const BI_COLORS = [
  BRAND.cerulean,
  BRAND.paleAzure,
  BRAND.sandyBrown,
  BRAND.mindaro,
  "#5b8a72",
  "#c45c5c",
  "#8b6bb1",
  "#e8a838",
];

export const baseGrid = { left: 48, right: 16, top: 40, bottom: 32, containLabel: true };

export function axisTooltip(): EChartsOption["tooltip"] {
  return { trigger: "axis", axisPointer: { type: "shadow" } };
}

export function itemTooltip(): EChartsOption["tooltip"] {
  return { trigger: "item" };
}

export function formatKes(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(Math.round(value));
}
