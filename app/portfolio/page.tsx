"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { PortfolioAnalystPanel } from "@/components/ai/portfolio-analyst-panel";
import {
  type PortfolioMoneyAmount,
  type PnlUnavailableReason,
  type PortfolioResponse,
} from "@/src/lib/portfolio/types";

const STORAGE_KEY = "hooddesk-wallet-address";

function formatEth(value: string | null): string {
  if (value === null) return "-";
  const n = Number(value);
  return `${n.toFixed(6)} ETH`;
}

const UNAVAILABLE_LABELS: Record<PnlUnavailableReason, string> = {
  NO_TRACKED_BUYS: "No verified buy history",
  INCOMPLETE_HISTORY: "Tracked trades do not reconcile to the wallet balance",
  BALANCE_UNAVAILABLE: "Onchain balance is unavailable",
  PRICE_UNAVAILABLE: "A live sell quote is unavailable",
};

function PnlCell({
  pnl,
  reason,
}: {
  pnl: PortfolioMoneyAmount | null;
  reason?: PnlUnavailableReason | null;
}) {
  if (!pnl) {
    return (
      <span className="text-hood-muted" title={reason ? UNAVAILABLE_LABELS[reason] : undefined}>
        Unavailable
      </span>
    );
  }
  const n = Number(pnl.eth);
  const color = n > 0 ? "text-hood-green" : n < 0 ? "text-hood-red" : "text-hood-muted";
  const sign = n > 0 ? "+" : "";
  return (
    <span className={`font-mono ${color}`}>
      {sign}
      {n.toFixed(6)} ETH
    </span>
  );
}

export default function PortfolioPage() {
  const { address: connectedAddress } = useAccount();
  const [address, setAddress] = useState("");
  const [portfolio, setPortfolio] = useState<PortfolioResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (connectedAddress) {
      setAddress(connectedAddress);
    } else {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setAddress(saved);
    }
  }, [connectedAddress]);

  const load = useCallback(async (targetAddress: string) => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(targetAddress)) {
      setError("Enter a valid 0x address");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/portfolio?address=${targetAddress}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPortfolio(data);
      window.localStorage.setItem(STORAGE_KEY, targetAddress);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (/^0x[a-fA-F0-9]{40}$/.test(address)) {
      load(address);
    }
  }, [address, load]);


  return (
    <div className="hd-page">
      <h1 className="hd-h1 mb-6">Portfolio</h1>

      <div className="flex gap-2 mb-6 max-w-xl">
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="0x wallet address"
          className="hd-input flex-1 font-mono"
        />
        <button onClick={() => load(address)} disabled={loading} className="hd-btn-primary">
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Loading
            </span>
          ) : (
            "Load"
          )}
        </button>
      </div>

      {error && <div className="hd-error mb-4 max-w-xl">{error}</div>}

      {loading && !portfolio && (
        <div className="space-y-4">
          <div className="hd-card p-5 h-20 animate-pulse-soft" />
          <div className="hd-card p-4 space-y-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-10 bg-hood-well/50 rounded-lg animate-pulse-soft" />
            ))}
          </div>
        </div>
      )}

      {portfolio && (
        <div className="space-y-4 animate-fade-in">
          <div className="hd-card p-5">
            <div className="text-[10px] uppercase tracking-widest text-hood-muted">ETH Balance</div>
            <div className="text-3xl font-mono font-semibold mt-1.5 tabular-nums">
              {Number(portfolio.ethBalanceFormatted).toFixed(6)} <span className="text-lg text-hood-muted">ETH</span>
            </div>
          </div>

          <PortfolioAnalystPanel portfolio={portfolio} />

          <div className="text-xs text-hood-muted max-w-3xl">
            Cost basis is derived only from trades executed or recorded through HoodDesk.
            Tokens acquired before tracking began, or transferred in from elsewhere, show
            &quot;Cost basis unavailable&quot; instead of an estimated figure. P&amp;L
            excludes gas and network fees.
          </div>

          {portfolio.holdings.length === 0 ? (
            <div className="hd-card p-12 text-center">
              <p className="text-hood-muted text-sm">No token holdings found for this address.</p>
              <p className="text-hood-muted/60 text-xs mt-2">Holdings appear here once the wallet holds tracked tokens.</p>
            </div>
          ) : (
            <div className="hd-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="hd-table">
                  <thead>
                    <tr>
                      <th className="pl-4">Token</th>
                      <th>Symbol</th>
                      <th className="text-right">Balance</th>
                      <th className="text-right">Market Value</th>
                      <th className="text-right">Cost Basis</th>
                      <th className="text-right">Realized</th>
                      <th className="pr-4 text-right">Unrealized</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.holdings.map((h) => (
                      <tr key={h.token.address}>
                        <td className="pl-4 font-medium">{h.token.name}</td>
                        <td className="font-mono text-hood-muted">{h.token.symbol}</td>
                        <td className="font-mono text-right">
                          {Number(h.balanceFormatted).toLocaleString(undefined, {
                            maximumFractionDigits: 4,
                          })}
                        </td>
                        <td className="font-mono text-right">
                          {h.estimatedMarketValue ? `$${h.estimatedMarketValue}` : "-"}
                        </td>
                        <td className="text-right">
                          {h.costBasisUnavailable ? (
                            <span
                              className="hd-badge-muted"
                              title={
                                h.costBasisUnavailableReason
                                  ? UNAVAILABLE_LABELS[h.costBasisUnavailableReason]
                                  : undefined
                              }
                            >
                              Unavailable
                            </span>
                          ) : (
                            <span className="font-mono">
                              {formatEth(h.trackedCostBasis?.eth ?? null)}
                            </span>
                          )}
                        </td>
                        <td className="text-right">
                          <PnlCell
                            pnl={h.realizedPnl}
                            reason={h.realizedPnlUnavailableReason}
                          />
                        </td>
                        <td className="pr-4 text-right">
                          <PnlCell
                            pnl={h.unrealizedPnl}
                            reason={h.unrealizedPnlUnavailableReason}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
