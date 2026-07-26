"use client";

import { useEffect, useState, useCallback } from "react";
import { getChain } from "@/src/config/chains";

interface RecentTrade {
  txHash: string;
  blockNumber: string;
  timestamp: number;
  direction: "Buy" | "Sell" | "Swap";
  price: string;
  amountToken: string;
  amountEth: string;
  wallet: string;
}

function abbreviateAddress(address: string): string {
  if (!address || address.length < 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatTradePrice(price: string): string {
  const value = Number(price);
  if (!Number.isFinite(value)) return "-";
  if (value === 0) return "0";
  if (value >= 0.0001) return value.toFixed(8).replace(/\.?0+$/, "");
  if (value >= 0.00000001) return value.toFixed(12).replace(/\.?0+$/, "");
  return value.toPrecision(6);
}

export function RecentTrades({ tokenAddress }: { tokenAddress: string }) {
  const [trades, setTrades] = useState<RecentTrade[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
  let explorerUrl = "";
  try {
    explorerUrl = getChain(chainId).explorerUrl;
  } catch {
    explorerUrl = "";
  }

  const loadTrades = useCallback(async () => {
    if (!tokenAddress) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/trades?token=${tokenAddress}&limit=30`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load trades");
      setTrades(data.trades ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load trades");
      setTrades([]);
    } finally {
      setLoading(false);
    }
  }, [tokenAddress]);

  useEffect(() => {
    loadTrades();
  }, [loadTrades]);

  return (
    <div className="hd-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-hood-text">Recent trades</h2>
          <p className="mt-0.5 text-xs text-hood-muted">Latest onchain activity for this token</p>
        </div>
        {loading && (
          <span className="w-3 h-3 border-2 border-hood-green/40 border-t-hood-green rounded-full animate-spin" />
        )}
      </div>

      {!tokenAddress && (
        <div className="py-8 text-center">
          <p className="text-hood-muted text-sm">Enter a token address to view recent trades.</p>
        </div>
      )}

      {tokenAddress && loading && trades.length === 0 && (
        <div className="space-y-1.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 bg-hood-well/50 rounded-lg animate-pulse-soft" />
          ))}
        </div>
      )}

      {tokenAddress && error && !loading && (
        <div className="py-8 text-center">
          <p className="text-sm font-medium text-hood-text">Recent trades are temporarily unavailable.</p>
          <p className="mt-1 text-xs text-hood-muted">The onchain data provider did not respond successfully.</p>
          <button type="button" onClick={loadTrades} className="hd-btn-ghost mt-3 px-3 py-1.5 text-xs">
            Try again
          </button>
        </div>
      )}

      {tokenAddress && !loading && !error && trades.length === 0 && (
        <div className="py-8 text-center">
          <p className="text-hood-muted text-sm">No recent trades found for this market.</p>
          <p className="text-hood-muted/60 text-xs mt-1">Trades appear here as they execute onchain.</p>
        </div>
      )}

      {tokenAddress && !error && trades.length > 0 && (
        <div className="overflow-x-auto -mx-1">
          <table className="w-full min-w-[720px] text-xs font-mono">
            <thead>
              <tr className="border-b border-hood-border/60 text-[11px] uppercase tracking-wide text-hood-muted">
                <th className="px-3 py-2 text-left font-medium">Time</th>
                <th className="px-3 py-2 text-left font-medium">Side</th>
                <th className="px-3 py-2 text-right font-medium">Price (ETH/token)</th>
                <th className="px-3 py-2 text-right font-medium">Token amount</th>
                <th className="px-3 py-2 text-left font-medium">Wallet</th>
                <th className="px-3 py-2 text-left font-medium">Transaction</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade, idx) => (
                <tr
                  key={`${trade.txHash}-${trade.blockNumber}-${idx}`}
                  className="border-b border-hood-border/30 hover:bg-hood-well/40 transition-colors"
                >
                  <td className="py-2.5 px-3 text-hood-muted tabular-nums">{formatTime(trade.timestamp)}</td>
                  <td className="py-2.5 px-3">
                    <span
                      className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        trade.direction === "Buy"
                          ? "bg-hood-greenDim text-hood-green"
                          : trade.direction === "Sell"
                            ? "bg-hood-redDim text-hood-red"
                            : "bg-hood-well text-hood-muted"
                      }`}
                    >
                      {trade.direction}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums">
                    {formatTradePrice(trade.price)}
                  </td>
                  <td className="py-2.5 px-3 text-right tabular-nums">
                    {Number(trade.amountToken).toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}
                  </td>
                  <td className="py-2.5 px-3 text-hood-muted">{abbreviateAddress(trade.wallet)}</td>
                  <td className="py-2.5 px-3">
                    {explorerUrl ? (
                      <a
                        href={`${explorerUrl}/tx/${trade.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-hood-muted hover:text-hood-green transition-colors"
                      >
                        {abbreviateAddress(trade.txHash)}
                      </a>
                    ) : (
                      abbreviateAddress(trade.txHash)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
