"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { Inbox, SearchX } from "lucide-react";

interface Tx {
  hash: string;
  blockNumber: number;
  timestamp: string;
  from: string;
  to: string | null;
  value: string;
  status: string;
  method: string | null;
  explorerUrl: string;
}

const STORAGE_KEY = "hooddesk-wallet-address";

export default function ActivityPage() {
  const { address: connectedAddress } = useAccount();
  const [address, setAddress] = useState("");
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (connectedAddress) {
      setAddress(connectedAddress);
    } else {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setAddress(saved);
    }
  }, [connectedAddress]);

  const load = useCallback(async (targetAddress: string) => {
    if (!/^0x[a-fA-F0-9]{40}$/.test(targetAddress)) {
      setError("Enter a valid 0x address");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/activity?address=${targetAddress}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setTxs(data.transactions ?? []);
      window.localStorage.setItem(STORAGE_KEY, targetAddress);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (/^0x[a-fA-F0-9]{40}$/.test(address)) {
      load(address);
    }
  }, [address, load]);

  return (
    <div className="hd-page">
      <h1 className="hd-h1 mb-6">Activity</h1>

      <div className="flex gap-2 mb-6 max-w-xl">
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="0x wallet address"
          className="hd-input flex-1 font-mono"
        />
        <button onClick={() => load(address)} disabled={loading} className="hd-btn-primary">
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

      {loading && txs.length === 0 && (
        <div className="hd-card p-4 space-y-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-10 bg-hood-well/50 rounded-lg animate-pulse-soft" />
          ))}
        </div>
      )}

      {!address ? (
        <div className="hd-card p-12 text-center">
          <Inbox className="w-8 h-8 text-hood-muted mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-sm text-hood-muted">
            Enter a wallet address to view its transaction activity.
          </p>
        </div>
      ) : txs.length === 0 && !loading && !error ? (
        <div className="hd-card p-12 text-center">
          <SearchX className="w-8 h-8 text-hood-muted mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-sm text-hood-muted">No transactions found for this address.</p>
          <p className="text-xs text-hood-muted/60 mt-2">Transactions appear here as they confirm onchain.</p>
        </div>
      ) : txs.length > 0 && (
        <div className="hd-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="hd-table">
              <thead>
                <tr>
                  <th className="pl-4">Time</th>
                  <th>Method</th>
                  <th className="text-right">Value (wei)</th>
                  <th>Status</th>
                  <th className="pr-4">Hash</th>
                </tr>
              </thead>
              <tbody>
                {txs.map((tx) => (
                  <tr key={tx.hash}>
                    <td className="pl-4 text-hood-muted">
                      {new Date(tx.timestamp).toLocaleString()}
                    </td>
                    <td className="font-mono">{tx.method ?? "transfer"}</td>
                    <td className="font-mono text-right">{tx.value}</td>
                    <td>
                      <span
                        className={
                          tx.status === "confirmed"
                            ? "hd-badge-green"
                            : tx.status === "reverted"
                              ? "hd-badge-red"
                              : "hd-badge-muted"
                        }
                      >
                        {tx.status}
                      </span>
                    </td>
                    <td className="pr-4 font-mono">
                      <a
                        href={tx.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-hood-muted hover:text-hood-green transition-colors"
                      >
                        {tx.hash.slice(0, 10)}...
                      </a>
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
