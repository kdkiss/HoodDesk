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
  type MouseEventParams,
} from "lightweight-charts";
import { useTheme } from "@/components/theme/theme-provider";

type TimeRange = "5M" | "15M" | "1H" | "1D" | "1W" | "1M" | "3M" | "1Y";

const RANGES: TimeRange[] = ["5M", "15M", "1H", "1D", "1W", "1M", "3M", "1Y"];
const LIVE_POLL_MS = 15_000;
const LIVE_POLL_SHORT_MS = 5_000;

interface CandleResponse {
  token: string;
  range: TimeRange;
  graduated: boolean;
  candles: Array<{
    time: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  insufficientData: boolean;
  message?: string;
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

function computeSMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(null);
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j];
    result.push(sum / period);
  }
  return result;
}

/** Pick a sensible decimal precision for very small ETH-denominated prices. */
function precisionForPrice(price: number): { precision: number; minMove: number } {
  if (price >= 1) return { precision: 4, minMove: 0.0001 };
  if (price >= 0.0001) return { precision: 8, minMove: 0.00000001 };
  if (price >= 0.00000001) return { precision: 12, minMove: 0.000000000001 };
  return { precision: 18, minMove: 0.000000000000000001 };
}

function formatPrice(v: number, precision: number): string {
  if (v === 0) return "0";
  if (v >= 1) return v.toFixed(4);
  // For tiny values use precision digits, trimmed of trailing zeros
  const s = v.toFixed(Math.min(precision, 18));
  return s.replace(/\.?0+$/, "");
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

export function CandlestickChart({ tokenAddress }: { tokenAddress: string }) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const maSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const [range, setRange] = useState<TimeRange>("1D");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [insufficientData, setInsufficientData] = useState(false);
  const [legend, setLegend] = useState<LegendData | null>(null);
  const [lastPrice, setLastPrice] = useState<number | null>(null);
  const [precision, setPrecision] = useState(8);
  const [totalSupply, setTotalSupply] = useState<number | null>(null);

  // Fetch totalSupply once per token for market cap display
  useEffect(() => {
    if (!tokenAddress) return;
    let cancelled = false;
    fetch(`/api/tokens/${tokenAddress}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const supply = data?.totalSupply ? Number(data.totalSupply) : null;
        if (supply && Number.isFinite(supply) && supply > 0) setTotalSupply(supply);
        else setTotalSupply(null);
      })
      .catch(() => !cancelled && setTotalSupply(null));
    return () => {
      cancelled = true;
    };
  }, [tokenAddress]);

  // Initialize chart once.
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "#0b0c0f" },
        textColor: "#8b919e",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 11,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.02)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      timeScale: {
        timeVisible: true,
        secondsVisible: true,
        borderColor: "#1a1d24",
        fixLeftEdge: true,
        fixRightEdge: true,
        rightOffset: 4,
        barSpacing: 8,
      },
      rightPriceScale: {
        borderColor: "#1a1d24",
        scaleMargins: { top: 0.06, bottom: 0.18 },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: "rgba(0,209,143,0.35)",
          width: 1,
          style: 2,
          labelBackgroundColor: "#1a1d24",
        },
        horzLine: {
          color: "rgba(0,209,143,0.35)",
          width: 1,
          style: 2,
          labelBackgroundColor: "#1a1d24",
        },
      },
      handleScroll: { vertTouchDrag: false },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#00d18f",
      downColor: "#f6465d",
      borderVisible: false,
      wickUpColor: "#00d18f",
      wickDownColor: "#f6465d",
      priceLineVisible: true,
      priceLineColor: "#3b82f6",
      priceLineWidth: 1,
      priceLineStyle: 2,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      color: "#3B82F6",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    });

    const maSeries = chart.addSeries(LineSeries, {
      color: "#F5A623",
      lineWidth: 2,
      crosshairMarkerVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    maSeriesRef.current = maSeries;

    // Crosshair legend
    chart.subscribeCrosshairMove((param: MouseEventParams) => {
      if (!param.time || !param.point) {
        setLegend(null);
        return;
      }
      const candle = param.seriesData.get(candleSeries) as
        | { time: UTCTimestamp; open: number; high: number; low: number; close: number }
        | undefined;
      const volume = param.seriesData.get(volumeSeries) as { value: number } | undefined;
      if (!candle) {
        setLegend(null);
        return;
      }
      setLegend({
        time: candle.time as number,
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
      maSeriesRef.current = null;
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
        background: { type: ColorType.Solid, color: isDark ? "#0b0c0f" : "#ffffff" },
        textColor: isDark ? "#8b919e" : "#546275",
      },
      grid: {
        vertLines: { color: isDark ? "rgba(255,255,255,0.02)" : "rgba(20,27,38,0.05)" },
        horzLines: { color: isDark ? "rgba(255,255,255,0.04)" : "rgba(20,27,38,0.07)" },
      },
      timeScale: { borderColor: isDark ? "#1a1d24" : "#d3dbe5" },
      rightPriceScale: { borderColor: isDark ? "#1a1d24" : "#d3dbe5" },
      crosshair: {
        vertLine: { labelBackgroundColor: isDark ? "#1a1d24" : "#d3dbe5" },
        horzLine: { labelBackgroundColor: isDark ? "#1a1d24" : "#d3dbe5" },
      },
    });
  }, [theme]);

  const applyCandles = useCallback((candles: CandleResponse["candles"]) => {
    if (candles.length === 0) return;

    // Auto precision from the last close
    const last = candles[candles.length - 1];
    const { precision: p, minMove } = precisionForPrice(last.close);
    setPrecision(p);
    candleSeriesRef.current?.applyOptions({
      priceFormat: { type: "price", precision: p, minMove },
    });

    const candleData = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volumeData = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      value: c.volume,
      color: c.close >= c.open ? "rgba(0,209,143,0.45)" : "rgba(246,70,93,0.45)",
    }));

    const closes = candles.map((c) => c.close);
    const maPeriod = Math.min(20, Math.max(2, Math.floor(closes.length / 4)));
    const smaValues = computeSMA(closes, maPeriod);
    const maData = candles
      .map((c, i) => ({ time: c.time as UTCTimestamp, value: smaValues[i] }))
      .filter((d): d is { time: UTCTimestamp; value: number } => d.value !== null);

    candleSeriesRef.current?.setData(candleData);
    volumeSeriesRef.current?.setData(volumeData);
    maSeriesRef.current?.setData(maData);
    setLastPrice(last.close);
  }, []);

  const loadCandles = useCallback(
    async (opts: { silent?: boolean } = {}) => {
      if (!tokenAddress) return;
      if (!opts.silent) setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/candles?token=${tokenAddress}&range=${range}`);
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
          maSeriesRef.current?.setData([]);
          setLastPrice(null);
          return;
        }

        setInsufficientData(false);
        applyCandles(data.candles);
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
    [tokenAddress, range, applyCandles]
  );

  useEffect(() => {
    loadCandles();
  }, [loadCandles]);

  // Live polling — refresh silently and update the last bar in place.
  // Short windows (5M/15M) poll more aggressively so the live bar feels alive.
  useEffect(() => {
    if (!tokenAddress) return;
    const pollMs = range === "5M" || range === "15M" ? LIVE_POLL_SHORT_MS : LIVE_POLL_MS;
    const id = setInterval(() => {
      loadCandles({ silent: true });
    }, pollMs);
    return () => clearInterval(id);
  }, [tokenAddress, range, loadCandles]);

  // Derive market cap from lastPrice * totalSupply (display units × display units).
  const marketCapEth =
    lastPrice !== null && totalSupply !== null && totalSupply > 0
      ? lastPrice * totalSupply
      : null;

  const showSeconds = range === "5M" || range === "15M";

  // % change between first and last candle in the visible dataset
  const displayed = legend;
  const pctChange =
    displayed && displayed.open > 0 ? ((displayed.close - displayed.open) / displayed.open) * 100 : null;
  const isUp = pctChange !== null && pctChange >= 0;

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-3 border-b border-hood-border bg-hood-well/50">
        <h2 className="text-xs font-semibold text-hood-text uppercase tracking-widest">Chart</h2>
        <div className="flex gap-0.5 bg-hood-bg rounded-xl p-0.5 border border-hood-border shadow-inner">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-2.5 py-1 text-[11px] rounded-lg font-medium transition-all ${
                range === r
                  ? "bg-hood-green text-black shadow-sm"
                  : "text-hood-muted hover:text-hood-text"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="relative" style={{ height: 420 }}>
        <div ref={containerRef} className="w-full h-full" />

        {/* Dexscreener-style OHLC / market-cap legend overlay */}
        {!insufficientData && !loading && !error && tokenAddress && (
          <div className="absolute top-2 left-3 pointer-events-none z-10 font-mono text-[11px] leading-tight">
            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-hood-muted">{formatTime(displayed?.time ?? 0, showSeconds)}</span>
              {displayed ? (
                <>
                  <span>
                    <span className="text-hood-muted">O </span>
                    <span className={displayed.close >= displayed.open ? "text-hood-green" : "text-hood-red"}>
                      {formatPrice(displayed.open, precision)}
                    </span>
                  </span>
                  <span>
                    <span className="text-hood-muted">H </span>
                    <span className="text-hood-green">{formatPrice(displayed.high, precision)}</span>
                  </span>
                  <span>
                    <span className="text-hood-muted">L </span>
                    <span className="text-hood-red">{formatPrice(displayed.low, precision)}</span>
                  </span>
                  <span>
                    <span className="text-hood-muted">C </span>
                    <span className={displayed.close >= displayed.open ? "text-hood-green" : "text-hood-red"}>
                      {formatPrice(displayed.close, precision)}
                    </span>
                  </span>
                  {pctChange !== null && (
                    <span className={isUp ? "text-hood-green" : "text-hood-red"}>
                      {isUp ? "+" : ""}
                      {pctChange.toFixed(2)}%
                    </span>
                  )}
                  <span className="text-hood-muted">Vol {displayed.volume.toFixed(4)} ETH</span>
                </>
              ) : lastPrice !== null ? (
                <>
                  <span className="text-hood-text font-semibold">{formatPrice(lastPrice, precision)} ETH</span>
                  {marketCapEth !== null && (
                    <span className="text-hood-muted">MCap {marketCapEth.toFixed(2)} ETH</span>
                  )}
                </>
              ) : null}
            </div>
          </div>
        )}

        {(insufficientData || !tokenAddress) && !loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-hood-panel/90">
            <p className="text-hood-muted text-sm text-center px-6">
              {tokenAddress ? NOT_AVAILABLE_MESSAGE : "Enter a token address to load chart data."}
            </p>
          </div>
        )}

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-hood-panel/90">
            <p className="text-hood-muted text-sm">Loading chart...</p>
          </div>
        )}

        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-hood-panel/90">
            <p className="text-hood-red text-sm text-center px-6">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
