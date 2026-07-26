"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Brain, Loader2 } from "lucide-react";
import { useTokenInfo } from "@/components/trading/use-token-info";
import { useTokenStats } from "@/components/trading/use-token-stats";
import {
  DEFAULT_AI_SETTINGS,
  getProviderOption,
  loadAiSettings,
  type AiSettings,
} from "@/src/lib/ai/settings";
import { type AnalystResponse } from "@/src/lib/ai/analyst";
import { AnalystOutput } from "@/components/ai/analyst-output";

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

interface HolderSnapshot {
  address: string;
  name: string | null;
  balance: string;
  sharePct: number | null;
}

export function TokenAnalystPanel({ tokenAddress }: { tokenAddress: string }) {
  const infoQuery = useTokenInfo(tokenAddress);
  const statsQuery = useTokenStats(tokenAddress);
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [analysis, setAnalysis] = useState<AnalystResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSettings(loadAiSettings());
  }, []);

  async function runAnalysis() {
    if (!settings.apiKey) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);

    try {
      const [tradesResponse, holdersResponse] = await Promise.all([
        fetch(`/api/trades?token=${tokenAddress}&limit=15`, { cache: "no-store" }),
        fetch(`/api/tokens/${tokenAddress}/holders`, { cache: "no-store" }),
      ]);
      const tradesData = await tradesResponse.json();
      const holdersData = await holdersResponse.json();
      const recentTrades = tradesResponse.ok ? ((tradesData.trades ?? []) as RecentTrade[]) : [];
      const topHolders = holdersResponse.ok
        ? ((holdersData.holders ?? []) as HolderSnapshot[])
        : [];
      const stats = statsQuery.data;

      const response = await fetch("/api/analyst", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: settings.provider,
          model: settings.model,
          apiKey: settings.apiKey,
          snapshot: {
            kind: "token",
            token: {
              address: tokenAddress,
              name: infoQuery.data?.name ?? null,
              symbol: infoQuery.data?.symbol ?? null,
              dexLive: infoQuery.data?.dexLive ?? null,
              isRobinFun: infoQuery.data?.isRobinFun ?? null,
            },
            stats: stats
              ? {
                  priceEth: stats.priceEth,
                  priceUsd: stats.priceUsd,
                  ethUsd: stats.ethUsd,
                  change24hPct: stats.change24hPct,
                  liquidityEth: stats.liquidityEth,
                  liquidityUsd: stats.liquidityUsd,
                  marketCapEth: stats.marketCapEth,
                  marketCapUsd: stats.marketCapUsd,
                  holdersCount: stats.holdersCount,
                  totalSupplyTokens: stats.totalSupplyTokens,
                  graduated: stats.graduated,
                  curve: stats.curve,
                }
              : null,
            recentTrades: recentTrades.map((trade) => ({
              timestamp: trade.timestamp,
              direction: trade.direction,
              priceEthPerToken: trade.price,
              amountToken: trade.amountToken,
              amountEth: trade.amountEth,
            })),
            topHolders: topHolders.map((holder) => ({
              name: holder.name,
              address: holder.address,
              balanceTokens: holder.balance,
              sharePct: holder.sharePct,
            })),
            dataSources: [
              "Robinhood Chain RPC",
              ...(stats?.marketDataSource ? [stats.marketDataSource] : []),
            ],
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Unable to run analyst");
      setAnalysis(data.analysis as AnalystResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to run analyst");
    } finally {
      setLoading(false);
    }
  }

  const providerLabel = getProviderOption(settings.provider).label;
  const ready = Boolean(settings.apiKey && settings.model);

  return (
    <div className="space-y-4 p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-2xl">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-hood-green" strokeWidth={1.75} />
            <h2 className="text-sm font-semibold text-hood-text">AI analyst</h2>
          </div>
          <p className="mt-1.5 text-sm leading-5 text-hood-muted">
            Summaries use HoodDesk token stats and recent onchain trades. They are not financial advice.
          </p>
        </div>
        <button
          type="button"
          onClick={runAnalysis}
          disabled={!ready || loading || infoQuery.isLoading || statsQuery.isLoading}
          className="hd-btn-secondary min-w-36 justify-center"
        >
          {loading ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Analyzing...
            </span>
          ) : (
            "Analyze token"
          )}
        </button>
      </div>

      {!ready && (
        <div className="rounded-xl border border-hood-border bg-hood-well/50 p-3 text-sm text-hood-muted">
          Add your provider key in{" "}
          <Link href="/settings" className="hd-link">
            Settings
          </Link>{" "}
          to enable AI analysis.
        </div>
      )}

      {ready && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-xl border border-hood-border bg-hood-well/40 px-3 py-2.5 text-xs text-hood-muted">
          <span>
            Provider <strong className="font-medium text-hood-text">{providerLabel}</strong>
          </span>
          <span className="min-w-0">
            Model <span className="break-all font-mono text-hood-text">{settings.model}</span>
          </span>
        </div>
      )}

      {error && <div className="hd-error">{error}</div>}

      <AnalystOutput
        analysis={analysis}
        emptyText="Analyze this token to generate a concise, data-bound brief."
      />
    </div>
  );
}
