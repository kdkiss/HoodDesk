import { describe, expect, it } from "vitest";
import {
  CHART_RESOLUTION_IDS,
  CHART_TIMEFRAME_IDS,
  DEFAULT_CHART_RESOLUTION,
  DEFAULT_CHART_TIMEFRAME,
  chartResolutionConfig,
  chartTimeframeConfig,
} from "@/src/lib/chart/timeframes";

describe("chart timeframes", () => {
  it("defaults to an hourly one-month view for denser real candles", () => {
    expect(DEFAULT_CHART_TIMEFRAME).toBe("1M");
    expect(DEFAULT_CHART_RESOLUTION).toBe("60");
    expect(chartTimeframeConfig(DEFAULT_CHART_TIMEFRAME).lookbackSeconds).toBe(
      30 * 24 * 60 * 60
    );
    expect(chartResolutionConfig(DEFAULT_CHART_RESOLUTION).bucketSeconds).toBe(
      60 * 60
    );
  });

  it("exposes the TradingView-style timeframe and resolution choices", () => {
    expect(CHART_TIMEFRAME_IDS).toEqual([
      "1D",
      "5D",
      "1M",
      "3M",
      "6M",
      "1Y",
      "5Y",
    ]);
    expect(CHART_RESOLUTION_IDS).toEqual([
      "1",
      "5",
      "15",
      "60",
      "240",
      "1D",
      "1W",
    ]);
  });
});
