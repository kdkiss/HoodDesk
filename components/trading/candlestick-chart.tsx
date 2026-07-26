"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
  ColorType,
  CrosshairMode,
  LineType,
  PriceScaleMode,
  type MouseEventParams,
  type Time,
} from "lightweight-charts";
import { useTheme } from "@/components/theme/theme-provider";
import { useTokenInfo } from "@/components/trading/use-token-info";
import {
  CHART_RESOLUTION_OPTIONS,
  CHART_TIMEFRAME_OPTIONS,
  DEFAULT_CHART_RESOLUTION,
  DEFAULT_CHART_TIMEFRAME,
  chartResolutionConfig,
  type ChartResolution,
  type ChartTimeframe,
} from "@/src/lib/chart/timeframes";

const LIVE_POLL_MS = 15_000;
const LIVE_POLL_SHORT_MS = 5_000;

interface CandleResponse {
  token: string;
  timeframe: ChartTimeframe;
  resolution: ChartResolution;
  graduated: boolean;
  candles: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    observed: boolean;
  }>;
  insufficientData: boolean;
  message?: string;
  metric?: "marketCapUsd" | "marketCapEth" | "priceEth";
  unit?: "USD" | "ETH";
  ethUsd?: number | null;
  bucketSeconds?: number;
  observedCandles?: number;
  source?: "blockscout" | "rpc";
  truncated?: boolean;
}

interface LegendData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const NOT_AVAILABLE_MESSAGE = "Historical chart data is not yet available for this market.";

function shouldUseLineChart(candles: CandleResponse["candles"]): boolean {
  return candles.length < 2;
}

function precisionForPrice(price: number): { precision: number; minMove: number } {
  if (price >= 1) return { precision: 4, minMove: 0.0001 };
  if (price >= 0.0001) return { precision: 8, minMove: 0.00000001 };
  if (price >= 0.00000001) return { precision: 12, minMove: 0.000000000001 };
  return { precision: 18, minMove: 0.000000000000000001 };
}

function formatCompactNumber(value: number, fractionDigits = 2): string {
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(fractionDigits)}B`;
  if (absolute >= 1_000_000) return `${(value / 1_000_000).toFixed(fractionDigits)}M`;
  if (absolute >= 1_000) return `${(value / 1_000).toFixed(fractionDigits)}K`;
  return value.toFixed(fractionDigits);
}

function formatChartValue(value: number, unit: "USD" | "ETH"): string {
  if (!Number.isFinite(value)) return "-";
  if (unit === "USD") return `$${formatCompactNumber(value)}`;
  if (value >= 1) return `${value.toFixed(4)} ETH`;
  const { precision } = precisionForPrice(value);
  return `${value.toFixed(Math.min(precision, 18)).replace(/\.?0+$/, "")} ETH`;
}

function formatAxisValue(value: number, unit: "USD" | "ETH"): string {
  if (unit === "USD") return `$${formatCompactNumber(value, 1)}`;
  if (value >= 1_000) return formatCompactNumber(value, 1);
  if (value >= 1) return value.toFixed(2);
  const { precision } = precisionForPrice(value);
  return value.toFixed(Math.min(precision, 18)).replace(/\.?0+$/, "");
}

function formatInterval(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${seconds / 60}m`;
  if (seconds < 86_400) return `${seconds / 3_600}h`;
  return `${seconds / 86_400}d`;
}

function formatTime(ts: number, showSeconds: boolean): string {
  const d = new Date(ts * 1000);
  if (showSeconds) {
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatAxisTime(time: Time, timeframe: ChartTimeframe): string {
  if (typeof time !== "number") return "";
  const date = new Date(time * 1000);
  if (timeframe === "1D" || timeframe === "5D") {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function CandlestickChart({ tokenAddress }: { tokenAddress: string }) {
  const { theme } = useTheme();
  const tokenInfoQuery = useTokenInfo(tokenAddress);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const priceLineSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const candlesByTimeRef = useRef<Map<number, LegendData>>(new Map());
  const timeframeRef = useRef<ChartTimeframe>(DEFAULT_CHART_TIMEFRAME);

  const [timeframe, setTimeframe] = useState<ChartTimeframe>(
    DEFAULT_CHART_TIMEFRAME
  );
  const [resolution, setResolution] = useState<ChartResolution>(
    DEFAULT_CHART_RESOLUTION
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insufficientData, setInsufficientData] = useState(false);
  const [legend, setLegend] = useState<LegendData | null>(null);
  const [latestCandle, setLatestCandle] = useState<LegendData | null>(null);
  const [rangeOpenPrice, setRangeOpenPrice] = useState<number | null>(null);
  const [metric, setMetric] = useState<
    "marketCapUsd" | "marketCapEth" | "priceEth"
  >("priceEth");
  const [unit, setUnit] = useState<"USD" | "ETH">("ETH");
  const [bucketSeconds, setBucketSeconds] = useState(
    chartResolutionConfig(DEFAULT_CHART_RESOLUTION).bucketSeconds
  );
  const [observedCandles, setObservedCandles] = useState(0);
  const [ethUsd, setEthUsd] = useState<number | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [logScale, setLogScale] = useState(false);

  // Initialize chart once.
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#111722" },
        textColor: "#94a0b2",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(132, 150, 176, 0.09)" },
        horzLines: { color: "rgba(132, 150, 176, 0.09)" },
      },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      localization: {
        timeFormatter: (time: Time) =>
          formatAxisTime(time, timeframeRef.current),
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: "rgba(132, 150, 176, 0.14)",
        fixLeftEdge: true,
        fixRightEdge: true,
        rightOffset: 2,
        barSpacing: 6,
        minBarSpacing: 2,
        lockVisibleTimeRangeOnResize: true,
        tickMarkFormatter: (time: Time) =>
          formatAxisTime(time, timeframeRef.current),
      },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.08, bottom: 0.24 },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(148, 160, 178, 0.45)",
          width: 1,
          style: 2,
          labelBackgroundColor: "#252c39",
        },
        horzLine: {
          color: "rgba(148, 160, 178, 0.45)",
          width: 1,
          style: 2,
          labelBackgroundColor: "#252c39",
        },
      },
      handleScale: true,
      handleScroll: { vertTouchDrag: false },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#00bfa5",
      downColor: "#f23645",
      borderVisible: false,
      wickUpColor: "#00bfa5",
      wickDownColor: "#f23645",
      priceLineVisible: true,
      priceLineColor: "#00bfa5",
      priceLineWidth: 1,
      priceLineStyle: 2,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      color: "#00bfa5",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.78, bottom: 0 },
    });

    const priceLineSeries = chart.addSeries(LineSeries, {
      color: "#00bfa5",
      lineWidth: 2,
      lineType: LineType.WithSteps,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 3,
      lastValueVisible: true,
      priceLineVisible: true,
      priceLineColor: "#00bfa5",
      priceLineWidth: 1,
      priceLineStyle: 2,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    priceLineSeriesRef.current = priceLineSeries;

    // Crosshair legend
    chart.subscribeCrosshairMove((param: MouseEventParams) => {
      if (!param.time || !param.point) {
        setLegend(null);
        return;
      }
      const candle = candlesByTimeRef.current.get(Number(param.time));
      const volume = param.seriesData.get(volumeSeries) as { value: number } | undefined;
      if (!candle) {
        setLegend(null);
        return;
      }
      setLegend({
        time: candle.time,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: volume?.value ?? 0,
      });
    });

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry && chartRef.current) {
        chartRef.current.applyOptions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      priceLineSeriesRef.current = null;
      candlesByTimeRef.current.clear();
    };
  }, []);

  // Lightweight Charts renders to its own canvas, so it does not inherit our
  // CSS variables. Update its palette whenever the surrounding app changes.
  useEffect(() => {
    const isDark = theme === "dark";
    const chart = chartRef.current;
    if (!chart) return;

    chart.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: isDark ? "#111722" : "#f8fafc" },
        textColor: isDark ? "#94a0b2" : "#526176",
      },
      grid: {
        vertLines: {
          color: isDark
            ? "rgba(132, 150, 176, 0.09)"
            : "rgba(54, 71, 96, 0.10)",
        },
        horzLines: {
          color: isDark
            ? "rgba(132, 150, 176, 0.09)"
            : "rgba(54, 71, 96, 0.10)",
        },
      },
      timeScale: {
        borderColor: isDark
          ? "rgba(132, 150, 176, 0.14)"
          : "rgba(54, 71, 96, 0.18)",
      },
      crosshair: {
        vertLine: { labelBackgroundColor: isDark ? "#252c39" : "#526176" },
        horzLine: { labelBackgroundColor: isDark ? "#252c39" : "#526176" },
      },
    });
  }, [theme]);

  const applyCandles = useCallback(
    (candles: CandleResponse["candles"], valueUnit: "USD" | "ETH") => {
      if (candles.length === 0) return;

      const last = candles[candles.length - 1];
      const { precision, minMove } = precisionForPrice(last.close);
      candleSeriesRef.current?.applyOptions({
        priceFormat:
          valueUnit === "USD"
            ? {
                type: "custom",
                minMove: 0.01,
                formatter: (value: number) => formatAxisValue(value, "USD"),
              }
            : { type: "price", precision, minMove },
      });
      priceLineSeriesRef.current?.applyOptions({
        priceFormat:
          valueUnit === "USD"
            ? {
                type: "custom",
                minMove: 0.01,
                formatter: (value: number) => formatAxisValue(value, "USD"),
              }
            : { type: "price", precision, minMove },
      });

      const candleData = candles.map((candle) => ({
        time: candle.time as UTCTimestamp,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      }));

      const volumeData = candles.map((candle) => ({
        time: candle.time as UTCTimestamp,
        value: candle.volume,
        color:
          candle.close >= candle.open
            ? "rgba(0, 191, 165, 0.50)"
            : "rgba(242, 54, 69, 0.50)",
      }));

      const lineData = candles.map((candle) => ({
        time: candle.time as UTCTimestamp,
        value: candle.close,
      }));
      const useLine = shouldUseLineChart(candles);
      candleSeriesRef.current?.setData(useLine ? [] : candleData);
      priceLineSeriesRef.current?.setData(useLine ? lineData : []);
      volumeSeriesRef.current?.setData(volumeData);
      candlesByTimeRef.current = new Map(
        candles.map((candle) => [
          candle.time,
          {
            time: candle.time,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume,
          },
        ])
      );
      setLatestCandle(candlesByTimeRef.current.get(last.time) ?? null);
      setRangeOpenPrice(candles[0].open);
    },
    []
  );

  const loadCandles = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!tokenAddress) return;
      if (!opts.silent) setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams({
          token: tokenAddress,
          timeframe,
          resolution,
        });
        const res = await fetch(`/api/candles?${query.toString()}`);
        const data: CandleResponse = await res.json();
        if (!res.ok) {
          throw new Error(
            (data as unknown as { error?: string }).error ?? "Failed to load chart data"
          );
        }

        if (data.insufficientData || data.candles.length === 0) {
          setInsufficientData(true);
          candleSeriesRef.current?.setData([]);
          volumeSeriesRef.current?.setData([]);
          priceLineSeriesRef.current?.setData([]);
          candlesByTimeRef.current.clear();
          setLegend(null);
          setLatestCandle(null);
          setRangeOpenPrice(null);
          setObservedCandles(0);
          setBucketSeconds(
            data.bucketSeconds ??
              chartResolutionConfig(resolution).bucketSeconds
          );
          setTruncated(Boolean(data.truncated));
          setEthUsd(null);
          return;
        }

        const nextUnit = data.unit ?? "ETH";
        setInsufficientData(false);
        setMetric(data.metric ?? "priceEth");
        setUnit(nextUnit);
        setBucketSeconds(
          data.bucketSeconds ?? chartResolutionConfig(resolution).bucketSeconds
        );
        setObservedCandles(data.observedCandles ?? data.candles.length);
        setEthUsd(data.ethUsd ?? null);
        setTruncated(Boolean(data.truncated));
        applyCandles(data.candles, nextUnit);
        if (!opts.silent) chartRef.current?.timeScale().fitContent();
      } catch (e) {
        if (!opts.silent) {
          setError(e instanceof Error ? e.message : "Failed to load chart data");
          setInsufficientData(false);
        }
      } finally {
        if (!opts.silent) setLoading(false);
      }
    },
    [tokenAddress, timeframe, resolution, applyCandles]
  );

  useEffect(() => {
    loadCandles();
  }, [loadCandles]);

  // Live polling refreshes short candle intervals more aggressively.
  useEffect(() => {
    if (!tokenAddress) return;
    const pollMs =
      resolution === "1" || resolution === "5"
        ? LIVE_POLL_SHORT_MS
        : LIVE_POLL_MS;
    const id = setInterval(() => {
      loadCandles({ silent: true });
    }, pollMs);
    return () => clearInterval(id);
  }, [tokenAddress, resolution, loadCandles]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    timeframeRef.current = timeframe;
    chart.timeScale().applyOptions({ secondsVisible: false });
  }, [timeframe]);

  useEffect(() => {
    chartRef.current?.priceScale("right").applyOptions({
      mode: logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      autoScale: true,
    });
  }, [logScale]);

  const resetView = useCallback(() => {
    chartRef.current?.priceScale("right").applyOptions({ autoScale: true });
    chartRef.current?.timeScale().fitContent();
  }, []);

  // Use the latest real candle while the crosshair is idle.
  const displayed = legend ?? latestCandle;
  const pctChange =
    displayed && rangeOpenPrice && rangeOpenPrice > 0
      ? ((displayed.close - rangeOpenPrice) / rangeOpenPrice) * 100
      : null;
  const isUp = pctChange !== null && pctChange >= 0;
  const symbol = tokenInfoQuery.data?.symbol ?? "TOKEN";
  const metricLabel =
    metric === "marketCapUsd" || metric === "marketCapEth"
      ? "Market Cap"
      : "Price";

  return (
    <div>
      <div className="border-b border-hood-border bg-hood-panel px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="order-1 flex min-w-0 items-center gap-2 xl:order-none">
            <span
              className="h-2 w-2 shrink-0 rounded-full bg-hood-green shadow-[0_0_0_5px_rgba(0,209,143,0.12)]"
              title="Live indexed market data"
            />
            <h2 className="truncate text-sm font-semibold text-hood-text">
              {symbol}/WETH
              <span className="font-normal text-hood-muted"> ({metricLabel})</span>
            </h2>
            <span className="shrink-0 font-mono text-[11px] text-hood-muted">
              {formatInterval(bucketSeconds)}
            </span>
          </div>

          {displayed && (
            <div className="order-3 flex w-full min-w-0 flex-none items-center gap-x-2 overflow-x-auto whitespace-nowrap pb-1 font-mono text-[11px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden xl:order-none xl:w-auto xl:flex-1 xl:flex-wrap xl:pb-0">
              <span className="hidden text-hood-muted sm:inline">
                {formatTime(displayed.time, false)}
              </span>
              <ChartLegendValue label="O" value={formatChartValue(displayed.open, unit)} />
              <ChartLegendValue label="H" value={formatChartValue(displayed.high, unit)} />
              <ChartLegendValue label="L" value={formatChartValue(displayed.low, unit)} />
              <ChartLegendValue label="C" value={formatChartValue(displayed.close, unit)} />
              {pctChange !== null && (
                <span className={isUp ? "text-hood-green" : "text-hood-red"}>
                  {isUp ? "+" : ""}
                  {pctChange.toFixed(2)}%
                </span>
              )}
            </div>
          )}

          <div
            className="order-2 flex w-full max-w-full shrink-0 justify-between gap-0.5 overflow-x-auto rounded-lg border border-hood-border bg-hood-bg/70 p-0.5 xl:order-none xl:ml-auto xl:w-auto xl:justify-start"
            aria-label="Candle interval"
          >
            {CHART_RESOLUTION_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setResolution(option.id)}
                aria-pressed={resolution === option.id}
                className={`shrink-0 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  resolution === option.id
                    ? "bg-hood-green text-black"
                    : "text-hood-muted hover:bg-hood-well hover:text-hood-text"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[10px] text-hood-muted">
          <span>{observedCandles.toLocaleString()} traded intervals</span>
          <span>·</span>
          <span>
            {truncated
              ? "high-volume history may be capped by the indexer"
              : "gaps mean no indexed trade in that interval"}
          </span>
          {metric === "marketCapUsd" && ethUsd !== null && (
            <>
              <span>·</span>
              <span>
                USD values use the current indexed ETH/USD rate of{" "}
                {ethUsd.toLocaleString(undefined, {
                  style: "currency",
                  currency: "USD",
                  maximumFractionDigits: 2,
                })}
              </span>
            </>
          )}
          {truncated && (
            <>
              <span>·</span>
              <span className="text-hood-amber">partial indexed history</span>
            </>
          )}
        </div>
      </div>

      <div className="relative h-[380px] bg-hood-panel md:h-[440px] xl:h-[500px]">
        <div ref={containerRef} className="h-full w-full" />

        {!insufficientData && !loading && !error && displayed && (
          <div className="pointer-events-none absolute left-3 top-2 z-10 font-mono text-[11px]">
            <span className="text-hood-muted">Volume </span>
            <span
              className={
                displayed.close >= displayed.open
                  ? "text-hood-green"
                  : "text-hood-red"
              }
            >
              {displayed.volume < 0.0001
                ? displayed.volume.toPrecision(3)
                : displayed.volume.toFixed(4)}{" "}
              ETH
            </span>
          </div>
        )}

        {!insufficientData && !loading && !error && (
          <div className="absolute inset-x-2 bottom-1.5 z-10 flex items-center justify-between gap-2 text-[10px] text-hood-muted">
            <div
              className="flex min-w-0 items-center gap-0.5 overflow-x-auto rounded-md bg-hood-panel/90 p-0.5 backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              aria-label="Visible time frame"
            >
              {[...CHART_TIMEFRAME_OPTIONS].reverse().map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setTimeframe(option.id)}
                  aria-pressed={timeframe === option.id}
                  className={`shrink-0 rounded px-2 py-1 font-medium transition-colors ${
                    timeframe === option.id
                      ? "bg-hood-greenDim text-hood-green"
                      : "hover:bg-hood-well hover:text-hood-text"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="flex shrink-0 items-center gap-1 rounded-md bg-hood-panel/90 p-0.5 backdrop-blur-sm">
              <button
                type="button"
                onClick={() => setLogScale((enabled) => !enabled)}
                aria-pressed={logScale}
                className={`rounded px-2 py-1 transition-colors ${
                  logScale
                    ? "bg-hood-greenDim text-hood-green"
                    : "hover:bg-hood-well hover:text-hood-text"
                }`}
              >
                log
              </button>
              <button
                type="button"
                onClick={resetView}
                className="rounded px-2 py-1 transition-colors hover:bg-hood-well hover:text-hood-text"
              >
                auto
              </button>
            </div>
          </div>
        )}

        {(insufficientData || !tokenAddress) && !loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-hood-panel/95">
            <p className="px-6 text-center text-sm text-hood-muted">
              {tokenAddress ? NOT_AVAILABLE_MESSAGE : "Enter a token address to load chart data."}
            </p>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-hood-panel/95">
            <div className="w-48 space-y-2" aria-label="Loading chart">
              <div className="h-2 animate-pulse rounded bg-hood-well" />
              <div className="h-2 w-3/4 animate-pulse rounded bg-hood-well" />
            </div>
          </div>
        )}

        {error && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-hood-panel/95 px-6 text-center">
            <p className="text-sm text-hood-red">{error}</p>
            <button
              type="button"
              onClick={() => loadCandles()}
              className="hd-btn-ghost mt-3 px-3 py-1.5 text-xs"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ChartLegendValue({ label, value }: { label: string; value: string }) {
  return (
    <span className="shrink-0">
      <span className="text-hood-muted">{label} </span>
      <span className="text-hood-text">{value}</span>
    </span>
  );
}
