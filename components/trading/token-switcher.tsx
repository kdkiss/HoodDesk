"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface TokenRow {
  address: string;
  name: string;
  symbol: string;
  dexLive: boolean;
}

/**
 * Searchable token picker, opened from the terminal header. Lists all
 * discovered RobinFun tokens (DB-backed /api/tokens) filtered client-side.
 */
export function TokenSwitcher({ currentAddress }: { currentAddress?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch("/api/tokens")
      .then((r) => r.json())
      .then((data) => setTokens(data.tokens ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

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

  function select(address: string) {
    setOpen(false);
    setSearch("");
    if (address.toLowerCase() !== currentAddress?.toLowerCase()) {
      router.push(`/trade/${address}`);
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="px-3 py-1.5 rounded border border-hood-border text-sm text-hood-muted hover:text-hood-text hover:border-hood-green transition-colors"
      >
        Switch Token
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center pt-24"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-hood-panel border border-hood-border rounded w-full max-w-lg max-h-[60vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-3 border-b border-hood-border">
              <input
                ref={inputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, symbol, or address..."
                className="w-full bg-hood-bg border border-hood-border rounded px-3 py-2 text-sm focus:outline-none focus:border-hood-green"
              />
            </div>
            <div className="overflow-y-auto flex-1">
              {loading ? (
                <p className="p-4 text-sm text-hood-muted">Loading tokens...</p>
              ) : filtered.length === 0 ? (
                <p className="p-4 text-sm text-hood-muted">No tokens match.</p>
              ) : (
                filtered.map((t) => (
                  <button
                    key={t.address}
                    onClick={() => select(t.address)}
                    className={`w-full text-left px-4 py-2.5 flex items-center justify-between hover:bg-hood-bg transition-colors ${
                      t.address.toLowerCase() === currentAddress?.toLowerCase()
                        ? "bg-hood-bg"
                        : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm truncate">
                        {t.name} <span className="text-hood-muted font-mono">{t.symbol}</span>
                      </div>
                      <div className="text-xs text-hood-muted font-mono">
                        {t.address.slice(0, 10)}…{t.address.slice(-6)}
                      </div>
                    </div>
                    <span
                      className={`ml-2 shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                        t.dexLive
                          ? "bg-hood-green/20 text-hood-green"
                          : "bg-yellow-500/20 text-yellow-500"
                      }`}
                    >
                      {t.dexLive ? "DEX" : "CURVE"}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
