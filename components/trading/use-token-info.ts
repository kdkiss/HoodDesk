"use client";

import { useQuery } from "@tanstack/react-query";
import { isAddress, type Address } from "viem";

export interface TokenInfoResponse {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  isRobinFun: boolean;
  dexLive: boolean;
  pairAddress?: string | null;
}

async function fetchTokenInfo(address: Address): Promise<TokenInfoResponse> {
  const res = await fetch(`/api/tokens?address=${address}`, { cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Failed to load token (${res.status})`);
  return data.token as TokenInfoResponse;
}

/** Fetches and validates token metadata through the existing /api/tokens route
 *  (which enforces the RobinFun allowlist via getTokenInfo). Never call the
 *  raw ERC20 contract directly for trading eligibility — this route is the
 *  single source of truth. */
export function useTokenInfo(address: string) {
  const valid = isAddress(address);
  return useQuery({
    queryKey: ["token-info", address.toLowerCase()],
    queryFn: () => fetchTokenInfo(address as Address),
    enabled: valid,
    retry: 2,
    staleTime: 30_000,
  });
}
