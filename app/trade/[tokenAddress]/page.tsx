"use client";

import { use, useState } from "react";
import { isAddress } from "viem";
import { TokenHeader } from "@/components/trading/token-header";
import { TokenSwitcher } from "@/components/trading/token-switcher";
import { CandlestickChart } from "@/components/trading/candlestick-chart";
import { RecentTrades } from "@/components/trading/recent-trades";
import { SwapCard } from "@/components/swap/swap-card";
import { getChain } from "@/src/config/chains";

type Tab = "trades" | "info";

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
    <div className="px-3 pt-2 pb-4 space-y-2">
      {/* Header row: stats + switcher */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <TokenHeader tokenAddress={tokenAddress} />
        </div>
        <div>
          <TokenSwitcher currentAddress={tokenAddress} />
        </div>
      </div>

      {/* Main grid: chart + tabs left, swap right */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-3">
        <div className="space-y-2 min-w-0">
          <div className="bg-hood-panel border border-hood-border rounded-2xl overflow-hidden shadow-card">
            <CandlestickChart tokenAddress={tokenAddress} />
          </div>

          <div className="bg-hood-panel border border-hood-border rounded-2xl overflow-hidden shadow-card">
            <div className="flex border-b border-hood-border bg-hood-bg/50">
              {(["trades", "info"] as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-5 py-3 text-xs uppercase tracking-wider transition-colors relative ${
                    tab === t
                      ? "text-hood-green font-bold"
                      : "text-hood-muted hover:text-hood-text"
                  }`}
                >
                  {tab === t && (
                    <span className="absolute bottom-0 left-0 w-full h-[2px] bg-hood-green rounded-t-sm" />
                  )}
                  {t === "trades" ? "Trades" : "Info"}
                </button>
              ))}
            </div>
            <div className={tab === "trades" ? "" : "hidden"}>
              <RecentTradesBare tokenAddress={tokenAddress} />
            </div>
            {tab === "info" && <TokenInfoPanel tokenAddress={tokenAddress} />}
          </div>
        </div>

        <div className="min-w-0">
          <div className="lg:sticky lg:top-2">
            <SwapCard fixedTokenAddress={tokenAddress} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** RecentTrades renders its own panel chrome; inside the tabbed container we
 *  reuse it as-is but strip the duplicate outer padding via a wrapper. */
function RecentTradesBare({ tokenAddress }: { tokenAddress: string }) {
  return (
    <div className="[&>div]:border-0 [&>div]:rounded-none [&>div]:p-3">
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
