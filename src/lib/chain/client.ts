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
    transport: http(chain.rpcUrl, { batch: true }),
  });
  return client;
}
