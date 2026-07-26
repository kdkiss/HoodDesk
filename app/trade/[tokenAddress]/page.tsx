"use client";

import { use, useState } from "react";
import { isAddress } from "viem";
import { TokenHeader } from "@/components/trading/token-header";
import { TokenSwitcher } from "@/components/trading/token-switcher";
import { CandlestickChart } from "@/components/trading/candlestick-chart";
import { RecentTrades } from "@/components/trading/recent-trades";
import { SwapCard } from "@/components/swap/swap-card";
import { getChain } from "@/src/config/chains";
import { TokenAnalystPanel } from "@/components/ai/token-analyst-panel";
import { TokenHolders } from "@/components/trading/token-holders";

type Tab = "trades" | "holders" | "analyst" | "info";

export default function TokenTerminalPage({
  params,
}: {
  params: Promise<{ tokenAddress: string }>;
}) {
  const { tokenAddress } = use(params);
  const [tab, setTab] = useState<Tab>("trades");

  if (!isAddress(tokenAddress)) {
    return (
      <div className="p-6">
        <div className="bg-hood-red/10 border border-hood-red text-hood-red px-4 py-3 rounded text-sm max-w-lg">
          Invalid token address.
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1920px] space-y-3 p-3 md:p-4">
      {/* Market context */}
      <section className="flex flex-col gap-3 rounded-2xl border border-hood-border bg-hood-panel px-4 py-3 shadow-card sm:flex-row sm:items-start">
        <div className="flex-1 min-w-0">
          <TokenHeader tokenAddress={tokenAddress} />
        </div>
        <div className="shrink-0">
          <TokenSwitcher currentAddress={tokenAddress} />
        </div>
      </section>

      {/* Main grid: chart + tabs left, swap right */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-3">
          <div className="bg-hood-panel border border-hood-border rounded-2xl overflow-hidden shadow-card">
            <CandlestickChart tokenAddress={tokenAddress} />
          </div>

          <div className="bg-hood-panel border border-hood-border rounded-2xl overflow-hidden shadow-card">
            <div
              role="tablist"
              aria-label="Token terminal details"
              className="flex border-b border-hood-border bg-hood-well/30 px-2"
            >
              {(["trades", "holders", "analyst", "info"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  role="tab"
                  aria-selected={tab === t}
                  className={`relative min-h-11 px-4 text-xs font-semibold transition-colors ${
                    tab === t
                      ? "text-hood-green"
                      : "text-hood-muted hover:text-hood-text"
                  }`}
                >
                  {tab === t && (
                    <span className="absolute bottom-0 left-0 w-full h-[2px] bg-hood-green rounded-t-sm" />
                  )}
                  {t === "trades"
                    ? "Trades"
                    : t === "holders"
                      ? "Holders"
                      : t === "analyst"
                        ? "Analyst"
                        : "Info"}
                </button>
              ))}
            </div>
            <div className={tab === "trades" ? "" : "hidden"}>
              <RecentTradesBare tokenAddress={tokenAddress} />
            </div>
            {tab === "holders" && <TokenHolders tokenAddress={tokenAddress} />}
            {tab === "analyst" && <TokenAnalystPanel tokenAddress={tokenAddress} />}
            {tab === "info" && <TokenInfoPanel tokenAddress={tokenAddress} />}
          </div>
        </div>

        <aside className="min-w-0">
          <div className="xl:sticky xl:top-3">
            <SwapCard fixedTokenAddress={tokenAddress} />
          </div>
        </aside>
      </div>
    </div>
  );
}

/** RecentTrades renders its own panel chrome; inside the tabbed container we
 *  reuse it as-is but strip the duplicate outer padding via a wrapper. */
function RecentTradesBare({ tokenAddress }: { tokenAddress: string }) {
  return (
    <div className="[&>div]:rounded-none [&>div]:border-0 [&>div]:p-3 md:[&>div]:p-4">
      <RecentTrades tokenAddress={tokenAddress} />
    </div>
  );
}

function TokenInfoPanel({ tokenAddress }: { tokenAddress: string }) {
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
  let explorerUrl = "";
  try {
    explorerUrl = getChain(chainId).explorerUrl;
  } catch {
    explorerUrl = "";
  }

  return (
    <div className="p-4 space-y-2 text-sm">
      <InfoRow label="Contract">
        <a
          href={`${explorerUrl}/address/${tokenAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-hood-green hover:underline break-all"
        >
          {tokenAddress}
        </a>
      </InfoRow>
      <InfoRow label="Launchpad">
        <a
          href={`https://robinfun.live/token/${tokenAddress}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-hood-green hover:underline"
        >
          View on RobinFun ↗
        </a>
      </InfoRow>
      <InfoRow label="Network">Robinhood Chain ({chainId})</InfoRow>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-hood-muted shrink-0">{label}</span>
      <span className="text-right min-w-0">{children}</span>
    </div>
  );
}
