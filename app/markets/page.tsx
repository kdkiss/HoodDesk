"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { generateAuthMessage } from "@/src/lib/security/signature";
import { Star, Search } from "lucide-react";

interface Token {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  dexLive: boolean;
  priceEth?: string | null;
}

function formatEthPrice(value: string | null | undefined) {
  if (!value) return "-";
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) return "-";
  const formatted = price < 0.000001
    ? price.toFixed(12).replace(/0+$/, "").replace(/\.$/, "")
    : price.toPrecision(6);
  return `${formatted} ETH`;
}

export default function MarketsPage() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);

  // Removed localStorage for manual address since we use connected wallet

  useEffect(() => {
    fetch("/api/tokens")
      .then((r) => r.json())
      .then((data) => setTokens(data.tokens ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      setWatched(new Set());
      return;
    }
    fetch(`/api/watchlist?owner=${address}`)
      .then((r) => r.json())
      .then((data) => {
        const list: { tokenAddress: string }[] = data.watchlist ?? [];
        setWatched(new Set(list.map((w) => w.tokenAddress.toLowerCase())));
      })
      .catch(console.error);
  }, [address]);

  async function toggleWatch(tokenAddress: string) {
    if (!address) {
      setWatchError("Connect your wallet to use the watchlist");
      return;
    }
      setWatchError(null);
      const lower = tokenAddress.toLowerCase();
      const isWatched = watched.has(lower);
    try {
      if (isWatched) {
        const timestamp = Date.now();
        const message = generateAuthMessage("Remove from Watchlist", address, timestamp, { tokenAddress: lower });
        const signature = await signMessageAsync({ message });
        await fetch(`/api/watchlist/${tokenAddress}?owner=${address}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature, timestamp }),
        });
        setWatched((prev) => {
          const next = new Set(prev);
          next.delete(lower);
          return next;
        });
      } else {
        const timestamp = Date.now();
        const message = generateAuthMessage("Add to Watchlist", address, timestamp, { tokenAddress: lower });
        const signature = await signMessageAsync({ message });

        const res = await fetch("/api/watchlist", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownerAddress: address, tokenAddress: lower, signature, timestamp }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to add to watchlist");
        setWatched((prev) => new Set(prev).add(lower));
      }
    } catch (e) {
      setWatchError(e instanceof Error ? e.message : "Watchlist action failed");
    }
  }

  const filtered = tokens
    .filter(
      (t) =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.symbol.toLowerCase().includes(search.toLowerCase()) ||
        t.address.toLowerCase().includes(search.toLowerCase())
    )
    .filter((t) => !watchlistOnly || watched.has(t.address.toLowerCase()));

  return (
    <div className="hd-page">
      <div className="flex items-center justify-between mb-6">
        <h1 className="hd-h1">Markets</h1>
        <span className="text-xs text-hood-muted">{filtered.length} tokens</span>
      </div>

      <div className="flex flex-wrap gap-2 mb-4 items-center">
        <div className="relative w-full max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-hood-muted" strokeWidth={1.5} />
          <input
            type="text"
            placeholder="Search by name, symbol, or address..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="hd-input w-full pl-9"
          />
        </div>
        <div className="flex gap-1 p-1 bg-hood-bg rounded-xl border border-hood-border">
          <button
            onClick={() => setWatchlistOnly(false)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-[0.98] ${
              !watchlistOnly
                ? "bg-hood-green text-black shadow-sm"
                : "text-hood-muted hover:text-hood-text"
            }`}
          >
            All
          </button>
          <button
            onClick={() => setWatchlistOnly(true)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all active:scale-[0.98] ${
              watchlistOnly
                ? "bg-hood-green text-black shadow-sm"
                : "text-hood-muted hover:text-hood-text"
            }`}
          >
            Watchlist
          </button>
        </div>
      </div>

      {watchError && <div className="hd-error mb-4 max-w-xl">{watchError}</div>}

      <div className="hd-card overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 bg-hood-well/50 rounded-lg animate-pulse-soft" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-hood-muted text-sm">
              {watchlistOnly
                ? "No tokens watched yet."
                : "No tokens found. Tokens appear here after discovery from RobinFun."}
            </p>
            {watchlistOnly && (
              <p className="text-hood-muted/60 text-xs mt-2">Star a token to add it to your watchlist.</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="hd-table">
              <thead>
                <tr>
                  <th className="pl-4 w-8"></th>
                  <th>Token</th>
                  <th>Symbol</th>
                  <th>Status</th>
                  <th className="text-right">Price (ETH)</th>
                  <th className="text-right">24h Change</th>
                  <th className="pr-4 text-right">Address</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((token) => {
                  const isWatched = watched.has(token.address.toLowerCase());
                  return (
                    <tr key={token.address}>
                      <td className="pl-4">
                        <button
                          onClick={() => toggleWatch(token.address)}
                          aria-label={isWatched ? "Remove from watchlist" : "Add to watchlist"}
                          className={`p-1 rounded transition-all active:scale-90 ${
                            isWatched
                              ? "text-hood-green"
                              : "text-hood-muted hover:text-hood-text"
                          }`}
                        >
                          <Star
                            className="w-4 h-4"
                            strokeWidth={1.5}
                            fill={isWatched ? "currentColor" : "none"}
                          />
                        </button>
                      </td>
                      <td>
                        <Link
                          href={`/trade/${token.address}`}
                          className="font-medium hover:text-hood-green transition-colors"
                        >
                          {token.name}
                        </Link>
                      </td>
                      <td className="font-mono text-hood-muted">{token.symbol}</td>
                      <td>
                        <span className={token.dexLive ? "hd-badge-green" : "hd-badge-amber"}>
                          {token.dexLive ? "DEX" : "Curve"}
                        </span>
                      </td>
                      <td className="font-mono text-right tabular-nums">
                        {formatEthPrice(token.priceEth)}
                      </td>
                      <td
                        className="text-right tabular-nums text-hood-muted"
                        title="24-hour change is unavailable until a reliable on-chain trade history exists."
                      >
                        -
                      </td>
                      <td className="pr-4 font-mono text-hood-muted text-right">
                        <a
                          href={`https://robinhoodchain.blockscout.com/address/${token.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:text-hood-green transition-colors"
                        >
                          {token.address.slice(0, 6)}...{token.address.slice(-4)}
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
