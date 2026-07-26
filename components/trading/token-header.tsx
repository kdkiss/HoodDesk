"use client";

import { useState } from "react";
import { useTokenInfo } from "./use-token-info";
import { useTokenStats } from "./use-token-stats";
import { getChain } from "@/src/config/chains";
import { Copy, Check, ExternalLink } from "lucide-react";

function shorten(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatUsd(v: number | null): string | undefined {
  if (v === null) return undefined;
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  if (v >= 1) return `$${v.toFixed(2)}`;
  if (v === 0) return "$0";
  // tiny prices: show meaningful sig figs
  return `$${v.toPrecision(3)}`;
}

function formatEth(v: string): string {
  const n = Number(v);
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (n >= 1) return n.toFixed(4);
  if (n === 0) return "0";
  return n.toPrecision(4);
}

function formatTokenPriceEth(v: string): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "-";
  if (n === 0) return "0";
  if (n >= 0.0001) return n.toFixed(8).replace(/\.?0+$/, "");
  if (n >= 0.00000001) return n.toFixed(12).replace(/\.?0+$/, "");
  return n.toPrecision(6);
}

export function TokenHeader({ tokenAddress }: { tokenAddress: string }) {
  const infoQuery = useTokenInfo(tokenAddress);
  const statsQuery = useTokenStats(tokenAddress);
  const [copied, setCopied] = useState(false);

  const info = infoQuery.data;
  const stats = statsQuery.data;

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
  let explorerUrl = "";
  try {
    explorerUrl = getChain(chainId).explorerUrl;
  } catch {
    explorerUrl = "";
  }

  function copyAddress() {
    navigator.clipboard.writeText(tokenAddress).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const change = stats?.change24hPct ?? null;
  const changeColor = change === null ? "text-hood-muted" : change >= 0 ? "text-hood-green" : "text-hood-red";

  return (
    <div className="flex items-center">
      <div className="flex w-full flex-wrap items-center gap-x-7 gap-y-3">
        {/* Identity */}
        <div className="flex min-w-[210px] items-center gap-2">
          <div className="min-w-0">
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-lg font-bold text-hood-text">{info?.name ?? "…"}</span>
              <span className="shrink-0 font-mono text-sm text-hood-muted">{info?.symbol ?? ""}</span>
              {stats && (
                <span
                  className={`hd-badge shrink-0 ${
                    stats.graduated
                      ? "bg-hood-greenDim text-hood-green"
                      : "bg-hood-amberDim text-hood-amber"
                  }`}
                >
                  {stats.graduated ? "DEX" : "CURVE"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-hood-muted font-mono">
              <span>{shorten(tokenAddress)}</span>
              <button
                onClick={copyAddress}
                className="p-0.5 rounded hover:text-hood-text hover:bg-hood-well transition-colors"
                aria-label="Copy token address"
              >
                {copied ? (
                  <Check className="w-3 h-3 text-hood-green" strokeWidth={2} />
                ) : (
                  <Copy className="w-3 h-3" strokeWidth={1.5} />
                )}
              </button>
              {explorerUrl && (
                <a
                  href={`${explorerUrl}/address/${tokenAddress}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-0.5 rounded hover:text-hood-green hover:bg-hood-well transition-colors"
                  aria-label="View on Blockscout"
                >
                  <ExternalLink className="w-3 h-3" strokeWidth={1.5} />
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Price — ETH-denominated; USD unavailable on this chain (no canonical
            ETH/USD oracle), see /api/tokens/[address]/stats */}
        <Stat
          label="Price"
          value={stats ? `${formatTokenPriceEth(stats.priceEth)} ETH` : "…"}
          sub={stats ? formatUsd(stats.priceUsd) : undefined}
        />

        {/* 24h change */}
        <Stat
          label="24h"
          value={
            stats === undefined ? "..." : change === null ? "-" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`
          }
          valueClass={changeColor}
        />

        {/* Liquidity */}
        <Stat
          label="Liquidity"
          value={stats ? `${formatEth(stats.liquidityEth)} ETH` : "…"}
          sub={stats ? formatUsd(stats.liquidityUsd) : undefined}
        />

        {/* Market cap */}
        <Stat
          label="Mkt Cap"
          value={stats ? (stats.marketCapEth !== null ? `${formatEth(String(stats.marketCapEth))} ETH` : "-") : "..."}
          sub={stats ? formatUsd(stats.marketCapUsd) : undefined}
        />

        {/* Holders */}
        <Stat
          label="Holders"
          value={stats === undefined ? "..." : stats.holdersCount === null ? "-" : String(stats.holdersCount)}
        />

        {/* Curve progress (pre-graduation only) */}
        {stats?.curve && (
          <div className="min-w-32">
            <div className="flex items-baseline justify-between mb-1">
              <div className="text-[10px] uppercase tracking-wider text-hood-muted">Graduation</div>
              <div className="text-[10px] font-mono text-hood-text">{stats.curve.progressPct.toFixed(1)}%</div>
            </div>
            <div className="h-1 w-36 bg-hood-well rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-hood-green/60 to-hood-green rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, stats.curve.progressPct)}%` }}
              />
            </div>
            <div className="text-[10px] text-hood-muted mt-1 font-mono">
              of {formatEth(stats.curve.raiseTarget)} ETH
            </div>
          </div>
        )}
      </div>

      {statsQuery.isError && (
        <span className="text-[10px] text-hood-red ml-auto shrink-0">
          Stats unavailable - retrying...
        </span>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="min-w-[90px]">
      <div className="text-[10px] font-medium uppercase tracking-wide text-hood-muted">{label}</div>
      <div className={`mt-0.5 whitespace-nowrap font-mono text-sm font-semibold ${valueClass ?? "text-hood-text"}`}>
        {value}
      </div>
      {sub && <div className="font-mono text-[11px] text-hood-muted">{sub}</div>}
    </div>
  );
}
