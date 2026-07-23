"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, isAddress } from "viem";
import { X, Search } from "lucide-react";

export interface SelectableToken {
  address: string; // "ETH" sentinel for native
  name: string;
  symbol: string;
  decimals: number;
  dexLive?: boolean;
  isNative?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (token: SelectableToken) => void;
  excludeAddress?: string;
  walletAddress?: string;
  prioritizeBalances?: boolean;
}

export const NATIVE_ETH: SelectableToken = {
  address: "ETH",
  name: "Ether",
  symbol: "ETH",
  decimals: 18,
  isNative: true,
};

function balanceFor(token: SelectableToken, balances: Record<string, bigint>): bigint {
  return balances[token.isNative ? "eth" : token.address.toLowerCase()] ?? 0n;
}

/** Token picker with client-side search and optional wallet-balance ordering. */
export function TokenSelectModal({
  open,
  onClose,
  onSelect,
  excludeAddress,
  walletAddress,
  prioritizeBalances = false,
}: Props) {
  const [search, setSearch] = useState("");
  const [tokens, setTokens] = useState<SelectableToken[]>([]);
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setLoading(true);
    const tokenRequest = fetch("/api/tokens")
      .then((r) => r.json())
      .then((data) => {
        const rows = (data.tokens ?? []) as Array<{
          address: string;
          name: string;
          symbol: string;
          decimals: number;
          dexLive: boolean;
        }>;
        setTokens(
          rows.map((t) => ({
            address: t.address,
            name: t.name,
            symbol: t.symbol,
            decimals: t.decimals,
            dexLive: t.dexLive,
          }))
        );
      })
      .catch(console.error)
      .finally(() => setLoading(false));

    if (!walletAddress || !isAddress(walletAddress)) {
      setBalances({});
    } else {
      fetch(`/api/portfolio/balances?address=${walletAddress}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (!data) return;
          const nextBalances: Record<string, bigint> = { eth: BigInt(data.ethBalance ?? "0") };
          for (const holding of data.holdings ?? []) {
            try {
              nextBalances[holding.token.address.toLowerCase()] = BigInt(holding.walletBalance);
            } catch {
              // Ignore an invalid explorer balance rather than hiding the token list.
            }
          }
          setBalances(nextBalances);
        })
        .catch(() => setBalances({}));
    }

    void tokenRequest;
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open, walletAddress]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (open) window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const list: SelectableToken[] = [NATIVE_ETH, ...tokens].filter(
      (t) => t.address.toLowerCase() !== excludeAddress?.toLowerCase()
    );
    const matchingTokens = q
      ? list.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.symbol.toLowerCase().includes(q) ||
            t.address.toLowerCase().includes(q)
        )
      : list;

    return [...matchingTokens].sort((a, b) => {
      if (!prioritizeBalances) return 0;
      const aBalance = balanceFor(a, balances);
      const bBalance = balanceFor(b, balances);
      const aHasBalance = aBalance > 0n;
      const bHasBalance = bBalance > 0n;
      if (aHasBalance !== bHasBalance) return aHasBalance ? -1 : 1;
      return a.symbol.localeCompare(b.symbol);
    });
  }, [tokens, search, excludeAddress, prioritizeBalances, balances]);

  if (!open) return null;

  const pastedIsAddress = isAddress(search.trim());

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-start justify-center pt-24 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-hood-panel border border-hood-border rounded-2xl w-full max-w-md max-h-[65vh] flex flex-col shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <span className="font-semibold text-[15px]">Select a token</span>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-hood-muted hover:text-hood-text hover:bg-hood-well transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>
        <div className="px-4 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-hood-muted" strokeWidth={1.5} />
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or paste address"
              className="w-full bg-hood-well border border-transparent rounded-xl pl-9 pr-3 py-2.5 text-sm text-hood-text placeholder:text-hood-muted/60 focus:outline-none focus:border-hood-green/40 focus:ring-2 focus:ring-hood-green/20 transition-all"
            />
          </div>
        </div>
        <div className="overflow-y-auto flex-1 border-t border-hood-border/60">
          {loading ? (
            <div className="p-3 space-y-1.5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-14 bg-hood-well/50 rounded-xl animate-pulse-soft" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-sm text-hood-muted">
                {pastedIsAddress
                  ? "Address not found among discovered RobinFun tokens."
                  : "No tokens match."}
              </p>
            </div>
          ) : (
            <div className="py-1">
              {filtered.map((t) => (
                <button
                  key={t.address}
                  onClick={() => {
                    onSelect(t);
                    onClose();
                  }}
                  className="w-full text-left px-4 py-2.5 flex items-center justify-between hover:bg-hood-well/60 transition-colors active:bg-hood-well"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-hood-well border border-hood-border/60 flex items-center justify-center text-[11px] font-bold shrink-0 text-hood-text">
                      {t.symbol.slice(0, 3)}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold truncate text-hood-text">{t.symbol}</div>
                      <div className="text-xs text-hood-muted truncate">{t.name}</div>
                    </div>
                  </div>
                  <div className="ml-2 flex items-center gap-1.5 shrink-0">
                    {prioritizeBalances && balanceFor(t, balances) > 0n && (
                      <span className="text-[10px] font-mono text-hood-muted">
                        {Number(formatUnits(balanceFor(t, balances), t.decimals)).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                      </span>
                    )}
                    {t.dexLive !== undefined && (
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                          t.dexLive
                            ? "bg-hood-greenDim text-hood-green"
                            : "bg-hood-amberDim text-hood-amber"
                        }`}
                      >
                        {t.dexLive ? "DEX" : "CURVE"}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
