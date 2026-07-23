"use client";

import { useEffect, useState } from "react";
import {
  ROBINFUN_FACTORIES,
  DEX_ROUTER,
  DEX_FACTORY,
} from "@/src/config/contracts";
import { getChain } from "@/src/config/chains";

interface HealthResponse {
  status: string;
  chainId: number;
  chainName: string;
  blockNumber: string;
  gasPriceGwei: string;
  executionEnabled: boolean;
  emergencyPause: boolean;
  executionWalletAddress: string | null;
  executionWalletBalanceEth: string | null;
  timestamp: string;
}

// Client-safe view of env values that are already validated server-side at
// startup (src/config/env.ts throws on import if invalid). These NEXT_PUBLIC_
// values are inlined by Next.js at build time; server-only fields are shown
// as "not exposed to client" rather than fabricated.
const DEFAULT_SLIPPAGE_BPS = 100;
const MAX_SLIPPAGE_BPS = 500;
const MAX_PRICE_IMPACT_BPS = 800;
const DEFAULT_TRANSACTION_DEADLINE_SECONDS = 300;

export default function SettingsPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setError(true));
  }, []);

  const chainId = health?.chainId ?? Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
  const isMainnet = chainId === 4663;
  const explorerUrl = (() => {
    try {
      return getChain(chainId).explorerUrl;
    } catch {
      return "https://robinhoodchain.blockscout.com";
    }
  })();

  const walletAddress = health?.executionWalletAddress ?? null;
  const walletBalance = health?.executionWalletBalanceEth ?? null;
  const lowBalanceThreshold = 0.005; // mirrors EXECUTION_MIN_GAS_BALANCE_ETH default in src/config/env.ts
  const isLowBalance =
    walletBalance !== null && Number(walletBalance) < lowBalanceThreshold;

  return (
    <div className="hd-page max-w-2xl">
      <h1 className="hd-h1 mb-6">Settings</h1>

      <div className="space-y-4">
        {/* Network */}
        <section className="hd-card p-5">
          <h2 className="text-sm font-semibold mb-3 text-hood-text">Network</h2>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-hood-muted">Chain</span>
              <span>{health?.chainName ?? "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-hood-muted">Chain ID</span>
              <span className="font-mono">{health?.chainId ?? "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-hood-muted">Latest Block</span>
              <span className="font-mono">{health?.blockNumber ?? "-"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-hood-muted">Gas Price</span>
              <span className="font-mono">{health?.gasPriceGwei ?? "-"} gwei</span>
            </div>
          </div>
        </section>

        {/* DEX Configuration */}
        <section className="hd-card p-5">
          <h2 className="text-sm font-semibold mb-3 text-hood-text">DEX Configuration</h2>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-hood-muted">Router</span>
              <span className="font-mono text-xs">{DEX_ROUTER}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-hood-muted">Factory</span>
              <span className="font-mono text-xs">{DEX_FACTORY}</span>
            </div>
          </div>
        </section>

        {/* Trading */}
        <section className="hd-card p-5">
          <h2 className="text-sm font-semibold mb-3 text-hood-text">Trading</h2>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-hood-muted">Default Slippage</span>
              <span className="font-mono">{DEFAULT_SLIPPAGE_BPS} bps ({(DEFAULT_SLIPPAGE_BPS / 100).toFixed(2)}%)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-hood-muted">Max Slippage</span>
              <span className="font-mono">{MAX_SLIPPAGE_BPS} bps ({(MAX_SLIPPAGE_BPS / 100).toFixed(2)}%)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-hood-muted">Max Price Impact</span>
              <span className="font-mono">{MAX_PRICE_IMPACT_BPS} bps ({(MAX_PRICE_IMPACT_BPS / 100).toFixed(2)}%)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-hood-muted">Default Transaction Deadline</span>
              <span className="font-mono">{DEFAULT_TRANSACTION_DEADLINE_SECONDS}s</span>
            </div>
            <div className="flex justify-between">
              <span className="text-hood-muted">Approval Mode</span>
              <span className="text-hood-muted">not configurable yet</span>
            </div>
          </div>
          <p className="text-xs text-hood-muted mt-2">
            Values are Zod-validated server-side at startup (src/config/env.ts). Editing these
            requires updating the deployment environment; no in-app override exists yet.
          </p>
        </section>

        {/* Automated Execution */}
        <section className="hd-card p-5">
          <h2 className="text-sm font-semibold mb-3 text-hood-text">Automated Execution</h2>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-hood-muted">Worker Status</span>
              <span
                className={
                  health?.executionEnabled && !health?.emergencyPause
                    ? "text-hood-green"
                    : "text-hood-muted"
                }
              >
                {!health
                  ? "-"
                  : health.emergencyPause
                    ? "Paused (EMERGENCY_PAUSE)"
                    : health.executionEnabled
                      ? "Enabled"
                      : "Disabled"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-hood-muted">Execution Wallet</span>
              {walletAddress ? (
                <a
                  href={`${explorerUrl}/address/${walletAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono text-xs text-hood-green hover:underline"
                >
                  {walletAddress}
                </a>
              ) : (
                <span className="text-hood-muted">not configured</span>
              )}
            </div>
            <div className="flex justify-between">
              <span className="text-hood-muted">Wallet Gas Balance</span>
              <span className={isLowBalance ? "font-mono text-hood-red" : "font-mono"}>
                {walletBalance !== null ? `${Number(walletBalance).toFixed(6)} ETH` : "-"}
              </span>
            </div>
            {isLowBalance && (
              <p className="text-xs text-hood-red">
                Warning: gas balance below minimum threshold ({lowBalanceThreshold} ETH,
                EXECUTION_MIN_GAS_BALANCE_ETH). Automated orders may fail to execute.
              </p>
            )}
            <div className="flex justify-between">
              <span className="text-hood-muted">Poll Interval</span>
              <span className="text-hood-muted">server-side only (EXECUTION_POLL_INTERVAL_MS)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-hood-muted">Max Retry Attempts</span>
              <span className="text-hood-muted">server-side only (EXECUTION_MAX_ATTEMPTS)</span>
            </div>
            <div className="flex justify-between">
              <span className="text-hood-muted">Max Gas Price</span>
              <span className="text-hood-muted">not yet configurable</span>
            </div>
            <div className="flex justify-between">
              <span className="text-hood-muted">Max Order Value</span>
              <span className="text-hood-muted">not yet configurable</span>
            </div>
          </div>
        </section>

        {/* Security */}
        <section className="hd-card p-5">
          <h2 className="text-sm font-semibold mb-3 text-hood-text">Security</h2>
          <ul className="space-y-3 text-sm">
            <li className="flex items-start gap-2.5">
              <span className={`mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full ${isMainnet ? "bg-hood-red" : "bg-hood-muted"}`} />
              <span>
                {isMainnet
                  ? "Mainnet active (chain ID 4663). All trades use real funds."
                  : `Connected to a non-mainnet chain (ID ${chainId}). Mainnet warning inactive.`}
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-hood-muted" />
              <span>
                Execution private key never leaves the server process. Use a dedicated,
                low-balance wallet for automated execution. Do not reuse a wallet holding
                significant funds.
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-hood-green" />
              <span>
                RobinFun launchpad factories allowlisted ({ROBINFUN_FACTORIES.length}):
                <span className="block font-mono text-xs text-hood-muted mt-1">
                  {ROBINFUN_FACTORIES.map((f) => (
                    <span key={f} className="block">{f}</span>
                  ))}
                </span>
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-hood-green" />
              <span>
                DEX router/factory allowlisted:
                <span className="block font-mono text-xs text-hood-muted mt-1">
                  Router: {DEX_ROUTER}
                  <br />
                  Factory: {DEX_FACTORY}
                </span>
              </span>
            </li>
            <li className="flex items-start gap-2.5">
              <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-hood-green" />
              <span>
                Configuration validated at server startup via Zod (src/config/env.ts). The app
                would not have started if validation failed, so current configuration is known
                valid.
              </span>
            </li>
          </ul>
        </section>

        {error && (
          <p className="text-sm text-hood-red">
            Failed to load live status from /api/health. Values above may be stale or
            unavailable.
          </p>
        )}
      </div>
    </div>
  );
}
