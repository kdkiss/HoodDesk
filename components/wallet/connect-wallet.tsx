"use client";

import { useState } from "react";
import { useAccount, useBalance, useConnect, useDisconnect } from "wagmi";
import { formatUnits } from "viem";
import { getChain } from "@/src/config/chains";
import { LogOut, Copy, ExternalLink } from "lucide-react";

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function ConnectWallet() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { data: balance } = useBalance({
    address,
    query: { enabled: Boolean(address) },
  });
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const injectedConnector = connectors.find((c) => c.id === "injected") ?? connectors[0];

  if (!isConnected || !address) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          onClick={() => injectedConnector && connect({ connector: injectedConnector })}
          disabled={isPending || !injectedConnector}
          className="px-4 py-2 rounded-xl bg-hood-green text-black text-sm font-semibold hover:brightness-110 hover:shadow-glow active:scale-[0.98] disabled:opacity-50 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hood-green/50"
        >
          {isPending ? (
            <span className="flex items-center gap-2">
              <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Connecting
            </span>
          ) : (
            "Connect Wallet"
          )}
        </button>
        {error && (
          <span className="text-xs text-hood-red max-w-[220px] text-right">
            {error.message}
          </span>
        )}
      </div>
    );
  }

  let explorerUrl: string | undefined;
  try {
    explorerUrl = chainId ? `${getChain(chainId).explorerUrl}/address/${address}` : undefined;
  } catch {
    explorerUrl = undefined;
  }

  const handleCopy = async () => {
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setMenuOpen((v) => !v)}
        className="flex items-center gap-2.5 px-3 py-2 rounded-xl border border-hood-amber/40 bg-hood-well text-sm hover:border-hood-amber/70 hover:bg-hood-well/70 transition-all active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hood-amber/30"
      >
        <span className="w-2 h-2 rounded-full bg-hood-amber shadow-[0_0_6px_rgba(217,119,6,0.5)]" />
        <span className="font-mono">{shortenAddress(address)}</span>
        {balance && (
          <span className="text-hood-muted font-mono">
            {Number(formatUnits(balance.value, balance.decimals)).toFixed(4)} {balance.symbol}
          </span>
        )}
      </button>

      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute right-0 mt-2 w-60 bg-hood-panel border border-hood-border rounded-xl shadow-pop z-50 text-sm overflow-hidden animate-fade-in">
            <div className="px-3.5 py-3 border-b border-hood-border bg-hood-well/40">
              <div className="text-[10px] uppercase tracking-widest text-hood-muted mb-1">Connected</div>
              <div className="font-mono text-xs text-hood-amber truncate">{address}</div>
            </div>
            <button
              onClick={handleCopy}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-hood-well transition-colors text-left"
            >
              <Copy className="w-3.5 h-3.5 text-hood-muted" strokeWidth={1.5} />
              {copied ? <span className="text-hood-green">Copied</span> : "Copy address"}
            </button>
            {explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 px-3.5 py-2.5 hover:bg-hood-well transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5 text-hood-muted" strokeWidth={1.5} />
                View on Blockscout
              </a>
            )}
            <div className="border-t border-hood-border/60" />
            <button
              onClick={() => {
                disconnect();
                setMenuOpen(false);
              }}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-hood-red hover:bg-hood-redDim transition-colors text-left"
            >
              <LogOut className="w-3.5 h-3.5" strokeWidth={1.5} />
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  );
}
