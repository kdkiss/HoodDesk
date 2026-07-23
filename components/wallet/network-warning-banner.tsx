"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { getChain } from "@/src/config/chains";

const expectedChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);

export function NetworkWarningBanner() {
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending } = useSwitchChain();

  if (!isConnected || chainId === undefined || chainId === expectedChainId) {
    return null;
  }

  let expectedName = `chain ${expectedChainId}`;
  try {
    expectedName = getChain(expectedChainId).name;
  } catch {
    // fall back to numeric id above
  }

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2 bg-hood-redDim border-b border-hood-red/40 text-hood-red text-sm">
      <span>
        Wrong network detected (connected to chain {chainId}). HoodDesk requires{" "}
        <strong>{expectedName}</strong> ({expectedChainId}) to trade.
      </span>
      <button
        onClick={() => switchChain({ chainId: expectedChainId })}
        disabled={isPending}
        className="px-3 py-1 rounded-lg bg-hood-red text-black font-semibold text-xs hover:brightness-110 disabled:opacity-50 transition whitespace-nowrap"
      >
        {isPending ? "Switching…" : "Switch Network"}
      </button>
    </div>
  );
}
