"use client";

import { useQuery } from "@tanstack/react-query";
import { getChain } from "@/src/config/chains";

interface Holder {
  address: string;
  name: string | null;
  balance: string;
  sharePct: number | null;
}

interface HoldersResponse {
  holdersCount: number | null;
  holders: Holder[];
  source: string;
}

function abbreviateAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTokenAmount(value: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) return value;
  return new Intl.NumberFormat(undefined, {
    notation: number >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: 2,
  }).format(number);
}

async function fetchHolders(tokenAddress: string): Promise<HoldersResponse> {
  const response = await fetch(`/api/tokens/${tokenAddress}/holders`, {
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "Unable to load token holders");
  }
  return data as HoldersResponse;
}

export function TokenHolders({ tokenAddress }: { tokenAddress: string }) {
  const query = useQuery({
    queryKey: ["token-holders", tokenAddress.toLowerCase()],
    queryFn: () => fetchHolders(tokenAddress),
    staleTime: 60_000,
    retry: 2,
  });
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
  let explorerUrl = "";
  try {
    explorerUrl = getChain(chainId).explorerUrl;
  } catch {
    explorerUrl = "";
  }

  if (query.isLoading) {
    return <div className="p-6 text-center text-sm text-hood-muted">Loading holders...</div>;
  }

  if (query.isError) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm font-medium text-hood-text">Holder data is temporarily unavailable.</p>
        <button
          type="button"
          onClick={() => query.refetch()}
          className="hd-btn-ghost mt-3 px-3 py-1.5 text-xs"
        >
          Try again
        </button>
      </div>
    );
  }

  const data = query.data;
  if (!data || data.holders.length === 0) {
    return <div className="p-6 text-center text-sm text-hood-muted">No holder data is indexed yet.</div>;
  }

  return (
    <div className="p-3 md:p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-hood-text">Top holders</h2>
          <p className="mt-0.5 text-xs text-hood-muted">
            {data.holdersCount?.toLocaleString() ?? "—"} indexed holders
          </p>
        </div>
        <span className="text-[11px] text-hood-muted">Source: {data.source}</span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-hood-border">
        <table className="w-full min-w-[620px] text-xs">
          <thead>
            <tr className="border-b border-hood-border bg-hood-well/40 text-[11px] uppercase tracking-wide text-hood-muted">
              <th className="px-3 py-2.5 text-left font-medium">#</th>
              <th className="px-3 py-2.5 text-left font-medium">Holder</th>
              <th className="px-3 py-2.5 text-right font-medium">Tokens</th>
              <th className="px-3 py-2.5 text-right font-medium">Share</th>
            </tr>
          </thead>
          <tbody>
            {data.holders.map((holder, index) => (
              <tr
                key={holder.address}
                className="border-b border-hood-border/40 last:border-0 hover:bg-hood-well/30"
              >
                <td className="px-3 py-2.5 text-hood-muted">{index + 1}</td>
                <td className="px-3 py-2.5 font-mono">
                  <a
                    href={explorerUrl ? `${explorerUrl}/address/${holder.address}` : undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-hood-text hover:text-hood-green"
                  >
                    {holder.name || abbreviateAddress(holder.address)}
                  </a>
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-hood-muted">
                  {formatTokenAmount(holder.balance)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-hood-green">
                  {holder.sharePct === null ? "—" : `${holder.sharePct.toFixed(2)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
