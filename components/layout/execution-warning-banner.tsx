"use client";

import { useNetworkHealth } from "@/src/hooks/use-network-health";

export function ExecutionWarningBanner() {
  const { data: health } = useNetworkHealth();

  if (!health || !health.executionEnabled || health.chainId !== 4663) {
    return null;
  }

  return (
    <div className="px-4 py-2 bg-hood-redDim border-b border-hood-red/40 text-hood-red text-sm text-center font-semibold">
      Automated execution is LIVE on mainnet (chain 4663). Orders may be filled automatically with
      real funds.
    </div>
  );
}
