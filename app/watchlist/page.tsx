"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface WatchlistToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  dexLive: boolean;
  isRobinFun: boolean;
  priceEth?: string | null;
  change24hPct?: number | null;
}

interface WatchlistEntry {
  watchlistId: string;
  tokenAddress: string;
  chainId: number;
  addedAt: string;
  token: WatchlistToken | null;
}

const STORAGE_KEY = "hooddesk-wallet-address";

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

export default function WatchlistPage() {
  const [address, setAddress] = useState("");
  const [entries, setEntries] = useState<WatchlistEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) setAddress(saved);
  }, []);

  useEffect(() => {
    if (/^0x[a-fA-F0-9]{40}$/.test(address)) {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  async function load() {
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      setError("Enter a valid 0x wallet address");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/watchlist?owner=${address}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const watchlist: WatchlistEntry[] = data.watchlist ?? [];
      const addresses = watchlist.map((entry) => entry.tokenAddress).join(",");
      const prices = addresses
        ? await fetch(`/api/tokens?addresses=${encodeURIComponent(addresses)}`).then((response) => response.json())
        : { tokens: [] };
      const byAddress = new Map<string, WatchlistToken>(
        (prices.tokens ?? []).map((token: WatchlistToken) => [token.address.toLowerCase(), token])
      );
      setEntries(watchlist.map((entry) => ({
        ...entry,
        token: entry.token
          ? {
              ...entry.token,
              priceEth:
                byAddress.get(entry.tokenAddress.toLowerCase())?.priceEth ??
                null,
              change24hPct:
                byAddress.get(entry.tokenAddress.toLowerCase())
                  ?.change24hPct ?? null,
            }
          : null,
      })));
      window.localStorage.setItem(STORAGE_KEY, address);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load watchlist");
    } finally {
      setLoading(false);
    }
  }

  async function remove(tokenAddress: string) {
    try {
      await fetch(`/api/watchlist/${tokenAddress}?owner=${address}`, {
        method: "DELETE",
      });
      setEntries((prev) => prev.filter((e) => e.tokenAddress !== tokenAddress));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove token");
    }
  }

  return (
    <div className="hd-page">
      <h1 className="hd-h1 mb-6">Watchlist</h1>

      <div className="flex gap-2 mb-6 max-w-xl">
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="0x wallet address"
          className="hd-input flex-1 font-mono"
        />
        <button onClick={load} disabled={loading} className="hd-btn-primary">
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

      {!address ? (
        <div className="hd-card p-12 text-center">
          <p className="text-hood-muted text-sm">Enter your wallet address above to view your watchlist.</p>
        </div>
      ) : loading && entries.length === 0 ? (
        <div className="hd-card p-4 space-y-1.5">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 bg-hood-well/50 rounded-lg animate-pulse-soft" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="hd-card p-12 text-center">
          <p className="text-hood-muted text-sm">No tokens watched yet.</p>
          <p className="text-hood-muted/60 text-xs mt-2">
            Star tokens from{" "}
            <Link href="/markets" className="hd-link">
              Markets
            </Link>{" "}
            to add them here.
          </p>
        </div>
      ) : (
        <div className="hd-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="hd-table">
              <thead>
                <tr>
                  <th className="pl-4">Token</th>
                  <th>Symbol</th>
                  <th>Status</th>
                  <th className="text-right">Price (ETH)</th>
                  <th className="text-right">24h Change</th>
                  <th>Address</th>
                  <th className="pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.watchlistId}>
                    <td className="pl-4">
                      <Link
                        href={`/trade/${entry.tokenAddress}`}
                        className="font-medium hover:text-hood-green transition-colors"
                      >
                        {entry.token?.name ?? "-"}
                      </Link>
                    </td>
                    <td className="font-mono text-hood-muted">{entry.token?.symbol ?? "-"}</td>
                    <td>
                      {entry.token ? (
                        <span className={entry.token.dexLive ? "hd-badge-green" : "hd-badge-yellow"}>
                          {entry.token.dexLive ? "DEX" : "Curve"}
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="font-mono text-right">
                      {formatEthPrice(entry.token?.priceEth)}
                    </td>
                    <td
                      className={`text-right font-mono tabular-nums ${
                        entry.token?.change24hPct === null ||
                        entry.token?.change24hPct === undefined
                          ? "text-hood-muted"
                          : entry.token.change24hPct >= 0
                            ? "text-hood-green"
                            : "text-hood-red"
                      }`}
                      title={
                        entry.token?.change24hPct === null ||
                        entry.token?.change24hPct === undefined
                          ? "No reliable onchain price was available at the 24-hour boundary."
                          : "Change from the onchain price at the 24-hour boundary."
                      }
                    >
                      {formatChange(entry.token?.change24hPct)}
                    </td>
                    <td className="font-mono text-hood-muted">
                      <a
                        href={`https://robinhoodchain.blockscout.com/address/${entry.tokenAddress}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hover:text-hood-green transition-colors"
                      >
                        {entry.tokenAddress.slice(0, 6)}...{entry.tokenAddress.slice(-4)}
                      </a>
                    </td>
                    <td className="pr-4">
                      <div className="flex gap-2 justify-end">
                        <Link
                          href={`/trade/${entry.tokenAddress}`}
                          className="hd-btn-primary px-3 py-1 text-xs"
                        >
                          Trade
                        </Link>
                        <button
                          onClick={() => remove(entry.tokenAddress)}
                          className="hd-btn-ghost px-3 py-1 text-xs hover:text-hood-red hover:border-hood-red"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
