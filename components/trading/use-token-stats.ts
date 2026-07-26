"use client";

import { useQuery } from "@tanstack/react-query";
import { isAddress } from "viem";

export interface TokenStats {
  token: string;
  graduated: boolean;
  priceEth: string;
  priceUsd: number | null;
  ethUsd: number | null;
  change24hPct: number | null;
  liquidityEth: string;
  liquidityUsd: number | null;
  marketCapEth: number | null;
  marketCapUsd: number | null;
  holdersCount: number | null;
  totalSupply: string | null;
  totalSupplyTokens: string | null;
  decimals: number;
  marketDataSource: string | null;
  curve: {
    realEth: string;
    raiseTarget: string;
    progressPct: number;
  } | null;
}

async function fetchStats(address: string): Promise<TokenStats> {
  const res = await fetch(`/api/tokens/${address}/stats`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Failed to load token stats");
  return data as TokenStats;
}

export function useTokenStats(address: string) {
  const valid = isAddress(address);
  return useQuery({
    queryKey: ["token-stats", address.toLowerCase()],
    queryFn: () => fetchStats(address),
    enabled: valid,
    retry: 2,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
}
