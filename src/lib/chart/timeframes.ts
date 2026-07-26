export const CHART_TIMEFRAME_IDS = [
  "1D",
  "5D",
  "1M",
  "3M",
  "6M",
  "1Y",
  "5Y",
] as const;

export type ChartTimeframe = (typeof CHART_TIMEFRAME_IDS)[number];

export const CHART_RESOLUTION_IDS = [
  "1",
  "5",
  "15",
  "60",
  "240",
  "1D",
  "1W",
] as const;

export type ChartResolution = (typeof CHART_RESOLUTION_IDS)[number];

export const DEFAULT_CHART_TIMEFRAME: ChartTimeframe = "1M";
export const DEFAULT_CHART_RESOLUTION: ChartResolution = "60";

export const CHART_TIMEFRAME_OPTIONS: Array<{
  id: ChartTimeframe;
  label: string;
  lookbackSeconds: number;
}> = [
  { id: "1D", label: "1d", lookbackSeconds: 24 * 60 * 60 },
  { id: "5D", label: "5d", lookbackSeconds: 5 * 24 * 60 * 60 },
  { id: "1M", label: "1m", lookbackSeconds: 30 * 24 * 60 * 60 },
  { id: "3M", label: "3m", lookbackSeconds: 90 * 24 * 60 * 60 },
  { id: "6M", label: "6m", lookbackSeconds: 180 * 24 * 60 * 60 },
  { id: "1Y", label: "1y", lookbackSeconds: 365 * 24 * 60 * 60 },
  { id: "5Y", label: "5y", lookbackSeconds: 5 * 365 * 24 * 60 * 60 },
];

export const CHART_RESOLUTION_OPTIONS: Array<{
  id: ChartResolution;
  label: string;
  bucketSeconds: number;
}> = [
  { id: "1", label: "1m", bucketSeconds: 60 },
  { id: "5", label: "5m", bucketSeconds: 5 * 60 },
  { id: "15", label: "15m", bucketSeconds: 15 * 60 },
  { id: "60", label: "1h", bucketSeconds: 60 * 60 },
  { id: "240", label: "4h", bucketSeconds: 4 * 60 * 60 },
  { id: "1D", label: "1d", bucketSeconds: 24 * 60 * 60 },
  { id: "1W", label: "1w", bucketSeconds: 7 * 24 * 60 * 60 },
];

export function chartTimeframeConfig(timeframe: ChartTimeframe) {
  return CHART_TIMEFRAME_OPTIONS.find((option) => option.id === timeframe)!;
}

export function chartResolutionConfig(resolution: ChartResolution) {
  return CHART_RESOLUTION_OPTIONS.find((option) => option.id === resolution)!;
}
