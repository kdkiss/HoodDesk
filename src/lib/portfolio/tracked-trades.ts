import { prisma } from "@/src/lib/db";
import { WETH } from "@/src/config/contracts";
import type { TrackedTrade } from "./cost-basis";

/**
 * Loads HoodDesk's own recorded trade history for a wallet from:
 *  - AutomatedOrder + OrderExecution rows for orders this app executed.
 *    Parent order status is intentionally irrelevant: DCA parents normally
 *    finish as COMPLETED or CANCELLED while their fills remain CONFIRMED.
 *  - TrackedTransaction rows with a recognized transactionType ("BUY"/"SELL")
 *    and a metadata payload describing the token/amounts (for trades tracked
 *    outside the order flow, e.g. manual swaps recorded by the frontend).
 *
 * This never reads current wallet balances — only HoodDesk's own transaction
 * records — so cost basis derived from this data can never be fabricated
 * from a live balance.
 */
export async function getWalletTrackedTrades(
  walletAddress: string,
  chainId: number
): Promise<TrackedTrade[]> {
  const address = walletAddress.toLowerCase();
  const weth = WETH.toLowerCase();

  const [orders, trackedTxs] = await Promise.all([
    prisma.automatedOrder.findMany({
      where: {
        chainId,
        executionWallet: address,
      },
      include: {
        executions: {
          where: { status: "CONFIRMED" },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
    prisma.trackedTransaction.findMany({
      where: {
        walletAddress: address,
        chainId,
        status: "confirmed",
        transactionType: { in: ["BUY", "SELL"] },
      },
    }),
  ]);

  const trades: TrackedTrade[] = [];
  const seenTransactionHashes = new Set<string>();

  for (const order of orders) {
    const isBuy = order.tokenIn.toLowerCase() === weth;
    const tokenAddress = (isBuy ? order.tokenOut : order.tokenIn).toLowerCase();

    for (const execution of order.executions) {
      if (
        execution.actualTokenAmount === null ||
        execution.actualEthAmount === null
      ) {
        continue;
      }

      let tokenAmount: bigint;
      let ethAmount: bigint;
      try {
        tokenAmount = BigInt(execution.actualTokenAmount);
        ethAmount = BigInt(execution.actualEthAmount);
      } catch {
        continue; // malformed numeric fields — skip rather than guess
      }

      if (tokenAmount <= 0n || ethAmount <= 0n) continue;
      if (execution.transactionHash) {
        seenTransactionHashes.add(execution.transactionHash.toLowerCase());
      }

      trades.push({
        tokenAddress,
        side: isBuy ? "buy" : "sell",
        tokenAmount,
        ethAmount,
        timestamp: execution.createdAt.getTime(),
      });
    }
  }

  for (const tx of trackedTxs) {
    if (seenTransactionHashes.has(tx.transactionHash.toLowerCase())) continue;
    const meta = tx.metadata as Record<string, unknown> | null;
    if (!meta) continue;

    const tokenAddress = typeof meta.tokenAddress === "string" ? meta.tokenAddress.toLowerCase() : null;
    const side = tx.transactionType === "BUY" ? "buy" : tx.transactionType === "SELL" ? "sell" : null;
    const tokenAmountRaw = meta.tokenAmount;
    const ethAmountRaw = meta.ethAmount;

    if (!tokenAddress || !side) continue;
    if (typeof tokenAmountRaw !== "string" || typeof ethAmountRaw !== "string") continue;

    let tokenAmount: bigint;
    let ethAmount: bigint;
    try {
      tokenAmount = BigInt(tokenAmountRaw);
      ethAmount = BigInt(ethAmountRaw);
    } catch {
      continue;
    }
    if (tokenAmount <= 0n || ethAmount <= 0n) continue;

    trades.push({
      tokenAddress,
      side,
      tokenAmount,
      ethAmount,
      timestamp:
        typeof meta.timestampMs === "string" &&
        /^\d+$/.test(meta.timestampMs)
          ? Number(meta.timestampMs)
          : tx.createdAt.getTime(),
    });
  }

  return trades;
}
