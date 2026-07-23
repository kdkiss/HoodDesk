"use client";

import Link from "next/link";
import { Activity, AlertTriangle, ArrowLeftRight, Cpu, Gauge, GitPullRequest, LayoutDashboard, Network, ShieldCheck } from "lucide-react";
import { useNetworkHealth } from "@/src/hooks/use-network-health";

export default function OverviewPage() {
  const { data: health, isError, isFetching } = useNetworkHealth();

  const rpcHealthy = Boolean(health && health.status === "ok") && !isError;

  return (
    <div className="hd-page">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="hd-h1">Command Center</h1>
          <p className="text-xs text-hood-muted mt-1">
            Robinhood Chain · {health?.chainName ?? "connecting"}
            {isFetching && <span className="ml-1 animate-pulse-soft">syncing</span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-hood-green" />
          <span className="text-hood-muted">System nominal</span>
        </div>
      </div>

      {isError && (
        <div className="hd-error mb-4 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>RPC unreachable. Check your connection.</span>
        </div>
      )}

      {/* Row 1: Network instrument cluster */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
        <InstrumentCluster
          value={health?.chainName ?? "-"}
          label="Network"
          icon={Network}
          mono={false}
        />
        <InstrumentCluster
          value={health?.blockNumber ?? "-"}
          label="Block"
          icon={Cpu}
          mono
        />
        <InstrumentCluster
          value={health ? `${health.gasPriceGwei} gwei` : "-"}
          label="Gas Price"
          icon={Gauge}
          mono
        />
        <InstrumentCluster
          value={health?.chainId ? String(health.chainId) : "-"}
          label="Chain ID"
          icon={GitPullRequest}
          mono
        />
      </div>

      {/* Row 2: Systems health + Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {/* Systems panel */}
        <div className="hd-card overflow-hidden">
          <div className="px-5 py-3 border-b border-hood-border flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-widest">Systems</h2>
            <span className="inline-flex items-center gap-1 text-[10px] text-hood-muted">
              <Activity className="w-3 h-3" />
              live
            </span>
          </div>
          <div className="p-5">
            <div className="space-y-3">
              <SystemRow
                label="RPC"
                status={rpcHealthy ? "healthy" : "unreachable"}
                healthy={rpcHealthy}
              />
              <SystemRow
                label="Execution"
                status={health?.executionEnabled ? "enabled" : "disabled"}
                healthy={health?.executionEnabled}
              />
              <SystemRow
                label="Emergency pause"
                status={health?.emergencyPause ? "active" : "inactive"}
                healthy={!health?.emergencyPause}
              />
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div className="hd-card overflow-hidden">
          <div className="px-5 py-3 border-b border-hood-border">
            <h2 className="text-xs font-semibold uppercase tracking-widest">Quick Actions</h2>
          </div>
          <div className="p-5">
            <p className="text-xs text-hood-muted mb-4 leading-relaxed">
              HoodDesk trades RobinFun launchpad tokens on Robinhood Chain.
              Bonding-curve markets before graduation, V2 pools after.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Link
                href="/swap"
                className="flex items-center justify-center gap-2 bg-hood-green text-black font-semibold text-sm rounded-xl px-4 py-2.5 hover:brightness-110 transition-all hover:shadow-glow active:scale-[0.98]"
              >
                <ArrowLeftRight className="w-4 h-4" strokeWidth={2} />
                Swap
              </Link>
              <Link
                href="/markets"
                className="flex items-center justify-center gap-2 bg-hood-well border border-hood-border text-hood-text hover:border-hood-borderLight hover:bg-hood-border/40 rounded-xl px-4 py-2.5 text-sm font-medium transition-all active:scale-[0.98]"
              >
                <LayoutDashboard className="w-4 h-4" strokeWidth={1.5} />
                Markets
              </Link>
              <Link
                href="/trade"
                className="flex items-center justify-center gap-2 bg-hood-well border border-hood-border text-hood-text hover:border-hood-borderLight hover:bg-hood-border/40 rounded-xl px-4 py-2.5 text-sm font-medium transition-all active:scale-[0.98]"
              >
                <Activity className="w-4 h-4" strokeWidth={1.5} />
                Terminal
              </Link>
              <Link
                href="/portfolio"
                className="flex items-center justify-center gap-2 bg-hood-well border border-hood-border text-hood-text hover:border-hood-borderLight hover:bg-hood-border/40 rounded-xl px-4 py-2.5 text-sm font-medium transition-all active:scale-[0.98]"
              >
                <ShieldCheck className="w-4 h-4" strokeWidth={1.5} />
                Portfolio
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Divider with chain status */}
      <div className="flex items-center gap-3 mb-2">
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-hood-border to-transparent" />
        <span className="text-[9px] text-hood-muted uppercase tracking-widest font-mono">
          {health?.chainName ?? "Robinhood Chain"}
        </span>
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-hood-border to-transparent" />
      </div>
    </div>
  );
}

function InstrumentCluster({
  value,
  label,
  icon: Icon,
  mono,
}: {
  value: string;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  mono?: boolean;
}) {
  return (
    <div className="hd-card p-4 relative overflow-hidden">
      {/* Accent bar at top */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-hood-amber/0 via-hood-amber/40 to-hood-amber/0" />
      <div className="flex items-start justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <Icon className="w-3 h-3 text-hood-muted" strokeWidth={1.5} />
            <span className="text-[11px] uppercase tracking-widest text-hood-muted font-medium">{label}</span>
          </div>
          <div className={`text-lg font-bold ${mono ? "font-mono" : ""} text-hood-text`}>
            {value}
          </div>
        </div>
      </div>
    </div>
  );
}

function SystemRow({
  label,
  status,
  healthy,
}: {
  label: string;
  status: string;
  healthy: boolean | undefined;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2.5">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${
          healthy === undefined ? "bg-hood-muted" :
          healthy ? "bg-hood-green" : "bg-hood-red"
        }`} />
        <span className="text-hood-text font-medium">{label}</span>
      </div>
      <span className={`font-mono text-xs ${
        healthy === undefined ? "text-hood-muted" :
        healthy ? "text-hood-green" : "text-hood-red"
      }`}>
        {status}
      </span>
    </div>
  );
}
