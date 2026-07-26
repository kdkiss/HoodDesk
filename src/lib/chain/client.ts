import { createPublicClient, http, type PublicClient } from "viem";
import { getChain } from "@/src/config/chains";

let client: PublicClient | null = null;

export function getPublicClient(chainId?: number): PublicClient {
  const id = chainId ?? Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
  if (client) return client;
  const chain = getChain(id);
  client = createPublicClient({
    chain: {
      id: chain.id,
      name: chain.name,
      nativeCurrency: chain.nativeCurrency,
      rpcUrls: { default: { http: [chain.rpcUrl] } },
    },
    transport: http(chain.rpcUrl, {
      // Robinhood Chain's public RPC occasionally returns an incomplete
      // JSON-RPC batch while several terminal panels refresh together.
      // Keep batches deliberately small and retry transient transport
      // failures instead of surfacing a random 404/500 to the user.
      batch: { batchSize: 12, wait: 8 },
      // Higher-level read helpers own retry policy. Disabling transport
      // retries prevents nested retry multiplication during provider errors.
      retryCount: 0,
      retryDelay: 250,
      timeout: 20_000,
    }),
  });
  return client;
}
