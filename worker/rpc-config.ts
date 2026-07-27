export const RPC_READ_TRANSPORT_OPTIONS = {
  retryCount: 3,
  retryDelay: 1000,
} as const;

// Transaction submission is not safe to retry without explicit idempotency
// reconciliation. A lost response may still mean the node accepted the tx.
export const RPC_WRITE_TRANSPORT_OPTIONS = {
  retryCount: 0,
} as const;

export function resolveWorkerRpcUrl(
  chainRpcUrl: string,
  configuredRpcUrl = process.env.ROBINHOOD_CHAIN_RPC_URL
): string {
  const rpcUrl = configuredRpcUrl?.trim() || chainRpcUrl;
  let parsed: URL;

  try {
    parsed = new URL(rpcUrl);
  } catch {
    throw new Error("Worker RPC URL is invalid");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("RPC URL must use HTTP or HTTPS");
  }

  return rpcUrl;
}
