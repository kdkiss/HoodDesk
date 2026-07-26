import type { Address, Hex } from "viem";

export async function trackConfirmedSwap(
  transactionHash: Hex,
  tokenAddress: Address
): Promise<void> {
  const response = await fetch("/api/transactions/track", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ transactionHash, tokenAddress }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? "Trade history could not be recorded");
  }
}
