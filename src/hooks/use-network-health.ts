"use client";

import { useQuery } from "@tanstack/react-query";

export interface HealthResponse {
  status: "ok" | "error";
  chainId: number;
  chainName: string;
  blockNumber: string;
  gasPriceWei: string;
  gasPriceGwei: string;
  executionEnabled: boolean;
  emergencyPause: boolean;
  timestamp: string;
  error?: string;
}

async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch("/api/health", { cache: "no-store" });
  const data = (await res.json()) as HealthResponse;
  if (!res.ok || data.status === "error") {
    throw new Error(data.error ?? `Health check failed (${res.status})`);
  }
  return data;
}

export function useNetworkHealth() {
  return useQuery({
    queryKey: ["network-health"],
    queryFn: fetchHealth,
    refetchInterval: 15_000,
    refetchIntervalInBackground: true,
    retry: 1,
    staleTime: 5_000,
  });
}
