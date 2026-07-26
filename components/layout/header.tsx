"use client";

import { useNetworkHealth } from "@/src/hooks/use-network-health";
import { ConnectWallet } from "@/components/wallet/connect-wallet";
import { NetworkWarningBanner } from "@/components/wallet/network-warning-banner";
import { ExecutionWarningBanner } from "@/components/layout/execution-warning-banner";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export function Header() {
  const { data: health, isError, isFetching } = useNetworkHealth();

  const rpcHealthy = Boolean(health && health.status === "ok") && !isError;
  const emergencyPause = health?.emergencyPause ?? false;

  const statusColor = isError
    ? "bg-hood-red"
    : emergencyPause
      ? "bg-hood-red"
      : rpcHealthy
        ? "bg-hood-green"
        : "bg-hood-muted";

  const statusLabel = isError
    ? "RPC unreachable"
    : emergencyPause
      ? "Emergency pause active"
      : rpcHealthy
        ? "RPC healthy"
        : "Checking…";

  return (
    <header className="flex flex-col border-b border-hood-border bg-hood-panel/80 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3 px-3 py-2 sm:px-4">
        <div className="min-w-0 flex items-center gap-5 text-xs">
          <div className="flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${statusColor} ${isFetching ? "animate-pulse" : ""}`}
              title={statusLabel}
            />
            <span className="text-hood-muted">{statusLabel}</span>
          </div>

          <div className="hidden items-center gap-5 sm:flex">
            <StatusItem label="Network" value={health?.chainName ?? "-"} />
            <StatusItem label="Block" value={health?.blockNumber ?? "-"} mono />
            <StatusItem
              label="Gas"
              value={health ? `${health.gasPriceGwei} gwei` : "-"}
              mono
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <ThemeToggle />
          <ConnectWallet />
        </div>
      </div>

      <ExecutionWarningBanner />
      <NetworkWarningBanner />
    </header>
  );
}

function StatusItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-hood-muted">{label}</span>
      <span className={mono ? "font-mono" : ""}>{value}</span>
    </div>
  );
}
