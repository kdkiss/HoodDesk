"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { generateAuthMessage } from "@/src/lib/security/signature";
import { ArrowDown, ArrowUp, ArrowUpDown, Star, Search } from "lucide-react";

interface Token {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  dexLive: boolean;
  priceEth?: string | null;
  change24hPct?: number | null;
  volume24hUsd?: number | null;
}

type VolumeSort = "none" | "desc" | "asc";

function mergeTokens(primary: Token[], additional: Token[]) {
  const merged = new Map<string, Token>();
  for (const token of [...primary, ...additional]) {
    const key = token.address.toLowerCase();
    merged.set(key, { ...merged.get(key), ...token });
  }
  return [...merged.values()];
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

function formatChange(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

const volumeFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 2,
});

function validVolume(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function formatVolume(value: number | null | undefined) {
  const volume = validVolume(value);
  return volume === null ? "-" : volumeFormatter.format(volume);
}

export default function MarketsPage() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [watched, setWatched] = useState<Set<string>>(new Set());
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [volumeSort, setVolumeSort] = useState<VolumeSort>("none");
  const [watchError, setWatchError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Removed localStorage for manual address since we use connected wallet

  useEffect(() => {
    fetch("/api/tokens")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? "Failed to load markets");
        }
        return data;
      })
      // Preserve tokens loaded explicitly for the connected wallet even when
      // they fall outside the general 100-token market page.
      .then((data) =>
        setTokens((current) => mergeTokens(data.tokens ?? [], current))
      )
      .catch((error) => {
        console.error(error);
        setWatchError(
          error instanceof Error ? error.message : "Failed to load markets"
        );
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      setWatched(new Set());
      return;
    }
    fetch(`/api/watchlist?owner=${address}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error ?? "Failed to load watchlist");
        }
        return data;
      })
      .then(async (data) => {
        const list: { tokenAddress: string }[] = data.watchlist ?? [];
        const watchedAddresses = list.map((item) =>
          item.tokenAddress.toLowerCase()
        );
        setWatched(new Set(watchedAddresses));

        if (watchedAddresses.length === 0) return;
        const response = await fetch(
          `/api/tokens?addresses=${encodeURIComponent(watchedAddresses.join(","))}`
        );
        const tokenData = await response.json();
        if (!response.ok) {
          throw new Error(
            tokenData.error ?? "Failed to load watched token prices"
          );
        }
        setTokens((current) =>
          mergeTokens(current, tokenData.tokens ?? [])
        );
      })
      .catch((error) => {
        console.error(error);
        setWatchError(
          error instanceof Error ? error.message : "Failed to load watchlist"
        );
      });
  }, [address]);

  useEffect(() => {
    const query = search.trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(query)) {
      setSearchError(null);
      return;
    }
    if (tokens.some((token) => token.address.toLowerCase() === query)) {
      setSearchError(null);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/tokens?address=${encodeURIComponent(query)}`,
          { signal: controller.signal }
        );
        const data = await response.json();
        if (!response.ok || !data.token) {
          throw new Error(data.error ?? "Token was not found");
        }
        setTokens((current) => mergeTokens([data.token], current));
        setSearchError(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        setSearchError(
          error instanceof Error
            ? error.message
            : "Unable to resolve that token address"
        );
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [search, tokens]);

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
  const displayed =
    volumeSort === "none"
      ? filtered
      : [...filtered].sort((a, b) => {
          const aVolume = validVolume(a.volume24hUsd);
          const bVolume = validVolume(b.volume24hUsd);
          if (aVolume === null && bVolume === null) return 0;
          if (aVolume === null) return 1;
          if (bVolume === null) return -1;
          return volumeSort === "desc"
            ? bVolume - aVolume
            : aVolume - bVolume;
        });

  function toggleVolumeSort() {
    setVolumeSort((current) =>
      current === "none" ? "desc" : current === "desc" ? "asc" : "none"
    );
  }

  return (
    <div className="hd-page">
      <div className="flex items-center justify-between mb-6">
        <h1 className="hd-h1">Markets</h1>
        <span className="text-xs text-hood-muted">{displayed.length} tokens</span>
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
      {searchError && (
        <div className="hd-error mb-4 max-w-xl">{searchError}</div>
      )}

      <div className="hd-card overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 bg-hood-well/50 rounded-lg animate-pulse-soft" />
            ))}
          </div>
        ) : displayed.length === 0 ? (
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
                  <th
                    className="text-right"
                    aria-sort={
                      volumeSort === "none"
                        ? "none"
                        : volumeSort === "desc"
                          ? "descending"
                          : "ascending"
                    }
                  >
                    <button
                      type="button"
                      onClick={toggleVolumeSort}
                      className="ml-auto inline-flex items-center gap-1 text-hood-muted transition-colors hover:text-hood-text"
                      aria-label="Sort by 24-hour volume"
                      title="24-hour USD volume indexed by Blockscout"
                    >
                      24h Volume
                      {volumeSort === "desc" ? (
                        <ArrowDown className="h-3 w-3" />
                      ) : volumeSort === "asc" ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3" />
                      )}
                    </button>
                  </th>
                  <th className="pr-4 text-right">Address</th>
                </tr>
              </thead>
              <tbody>
                {displayed.map((token) => {
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
                        className={`text-right font-mono tabular-nums ${
                          token.change24hPct === null ||
                          token.change24hPct === undefined
                            ? "text-hood-muted"
                            : token.change24hPct >= 0
                              ? "text-hood-green"
                              : "text-hood-red"
                        }`}
                        title={
                          token.change24hPct === null ||
                          token.change24hPct === undefined
                            ? "No reliable onchain price was available at the 24-hour boundary."
                            : "Change from the onchain price at the 24-hour boundary."
                        }
                      >
                        {formatChange(token.change24hPct)}
                      </td>
                      <td
                        className="font-mono text-right tabular-nums text-hood-muted"
                        title={
                          validVolume(token.volume24hUsd) === null
                            ? "Blockscout does not currently provide indexed 24-hour volume for this token."
                            : "24-hour USD volume indexed by Blockscout."
                        }
                      >
                        {formatVolume(token.volume24hUsd)}
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
