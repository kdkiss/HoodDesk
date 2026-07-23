"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, SearchX } from "lucide-react";

interface TokenRow {
  address: string;
  name: string;
  symbol: string;
  dexLive: boolean;
}

export default function TradeLandingPage() {
  const router = useRouter();
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/api/tokens")
      .then((r) => r.json())
      .then((data) => setTokens(data.tokens ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    if (!q) return tokens;
    return tokens.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.symbol.toLowerCase().includes(q) ||
        t.address.toLowerCase().includes(q)
    );
  }, [tokens, search]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold tracking-tight">Terminal</h1>
        <p className="text-sm text-hood-muted mt-1">
          Select a RobinFun token to open its trading terminal.
        </p>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-hood-muted" strokeWidth={1.5} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, symbol, or address..."
          className="hd-input w-full pl-9"
        />
      </div>

      {loading ? (
        <div className="space-y-1.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="hd-card p-4 animate-pulse-soft">
              <div className="h-4 bg-hood-well rounded w-1/3 mb-2" />
              <div className="h-3 bg-hood-well rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="hd-card p-12 text-center">
          <SearchX className="w-8 h-8 text-hood-muted mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-sm text-hood-muted">
            {search ? "No tokens match your search." : "No tokens found. Tokens appear here after discovery from RobinFun."}
          </p>
        </div>
      ) : (
        <div className="hd-card divide-y divide-hood-border/60 overflow-hidden">
          {filtered.map((t) => (
            <button
              key={t.address}
              onClick={() => router.push(`/trade/${t.address}`)}
              className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-hood-well/50 transition-colors active:bg-hood-well"
            >
              <div className="min-w-0">
                <div className="text-sm truncate text-hood-text">
                  {t.name} <span className="text-hood-muted font-mono">{t.symbol}</span>
                </div>
                <div className="text-xs text-hood-muted font-mono truncate">
                  {t.address.slice(0, 10)}...{t.address.slice(-6)}
                </div>
              </div>
              <span
                className={`ml-2 shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                  t.dexLive
                    ? "bg-hood-greenDim text-hood-green"
                    : "bg-hood-amberDim text-hood-amber"
                }`}
              >
                {t.dexLive ? "DEX" : "CURVE"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
