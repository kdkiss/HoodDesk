"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Brain, Loader2, ShieldCheck } from "lucide-react";
import { AnalystOutput } from "@/components/ai/analyst-output";
import {
  DEFAULT_AI_SETTINGS,
  getProviderOption,
  loadAiSettings,
  type AiSettings,
} from "@/src/lib/ai/settings";
import { type AnalystResponse } from "@/src/lib/ai/analyst";
import { type PortfolioResponse } from "@/src/lib/portfolio/types";

const MAX_ANALYZED_HOLDINGS = 50;

function finiteNonnegative(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function PortfolioAnalystPanel({
  portfolio,
}: {
  portfolio: PortfolioResponse;
}) {
  const [settings, setSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [analysis, setAnalysis] = useState<AnalystResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSettings(loadAiSettings());
  }, []);

  useEffect(() => {
    setAnalysis(null);
    setError(null);
  }, [portfolio]);

  const valuation = useMemo(() => {
    const holdings = portfolio.holdings
      .map((holding) => ({
        holding,
        marketValueUsd: finiteNonnegative(holding.estimatedMarketValue),
      }))
      .sort(
        (left, right) =>
          (right.marketValueUsd ?? -1) - (left.marketValueUsd ?? -1)
      )
      .slice(0, MAX_ANALYZED_HOLDINGS);
    return {
      holdings,
      knownIncludedTokenValueUsd: holdings.reduce(
        (total, item) => total + (item.marketValueUsd ?? 0),
        0
      ),
      totalHoldings: portfolio.holdings.length,
      valuedHoldings: holdings.filter((item) => item.marketValueUsd !== null)
        .length,
    };
  }, [portfolio]);

  async function runAnalysis() {
    if (!settings.apiKey) return;
    setLoading(true);
    setError(null);
    setAnalysis(null);

    try {
      const response = await fetch("/api/analyst", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: settings.provider,
          model: settings.model,
          apiKey: settings.apiKey,
          snapshot: {
            kind: "portfolio",
            ethBalanceEth: portfolio.ethBalanceFormatted,
            ethUsd: portfolio.ethUsd,
            holdings: valuation.holdings.map(({ holding, marketValueUsd }) => ({
              name: holding.token.name,
              symbol: holding.token.symbol,
              balanceTokens: holding.balanceFormatted,
              marketValueUsd,
              trackedCostBasisEth: holding.trackedCostBasis?.eth ?? null,
              realizedPnlEth: holding.realizedPnl?.eth ?? null,
              unrealizedPnlEth: holding.unrealizedPnl?.eth ?? null,
              costBasisUnavailable: holding.costBasisUnavailable,
            })),
            knownIncludedTokenValueUsd:
              valuation.knownIncludedTokenValueUsd,
            totalHoldings: valuation.totalHoldings,
            includedHoldings: valuation.holdings.length,
            valuedHoldings: valuation.valuedHoldings,
            dataSources: [
              "Robinhood Chain RPC",
              "Blockscout",
              "HoodDesk tracked trades",
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
    <section className="hd-card overflow-hidden">
      <div className="space-y-4 p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 max-w-2xl">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-hood-green" strokeWidth={1.75} />
              <h2 className="text-sm font-semibold text-hood-text">
                Portfolio analyst
              </h2>
            </div>
            <p className="mt-1.5 text-sm leading-5 text-hood-muted">
              Summarizes visible allocation, concentration, tracked performance,
              and missing cost-basis data. It does not provide financial advice.
            </p>
          </div>
          <button
            type="button"
            onClick={runAnalysis}
            disabled={!ready || loading}
            className="hd-btn-secondary min-w-40 justify-center"
          >
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Analyzing...
              </span>
            ) : (
              "Analyze portfolio"
            )}
          </button>
        </div>

        <div className="flex gap-2 rounded-xl border border-hood-border bg-hood-well/40 p-3 text-xs leading-5 text-hood-muted">
          <ShieldCheck
            className="mt-0.5 h-4 w-4 shrink-0 text-hood-green"
            strokeWidth={1.75}
          />
          <p>
            Only summarized balances and available valuation/P&amp;L fields are
            sent when you click analyze. Wallet addresses, token contract
            addresses, and transaction hashes are excluded.
          </p>
        </div>

        {!ready ? (
          <div className="rounded-xl border border-hood-border bg-hood-well/50 p-3 text-sm text-hood-muted">
            Add your provider key in{" "}
            <Link href="/settings" className="hd-link">
              Settings
            </Link>{" "}
            to enable AI analysis.
          </div>
        ) : (
          <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-xl border border-hood-border bg-hood-well/40 px-3 py-2.5 text-xs text-hood-muted">
            <span>
              Provider{" "}
              <strong className="font-medium text-hood-text">
                {providerLabel}
              </strong>
            </span>
            <span className="min-w-0">
              Model{" "}
              <span className="break-all font-mono text-hood-text">
                {settings.model}
              </span>
            </span>
            <span>
              Coverage{" "}
              <strong className="font-medium text-hood-text">
                {valuation.valuedHoldings}/{valuation.holdings.length} token
                holdings valued
              </strong>
            </span>
          </div>
        )}

        {portfolio.holdings.length > MAX_ANALYZED_HOLDINGS && (
          <p className="text-xs text-hood-amber">
            The analysis includes the 50 highest-valued or first-listed token
            holdings.
          </p>
        )}

        {error && <div className="hd-error">{error}</div>}

        <AnalystOutput
          analysis={analysis}
          emptyText="Analyze this portfolio to generate a concise, data-bound brief."
        />
      </div>
    </section>
  );
}
