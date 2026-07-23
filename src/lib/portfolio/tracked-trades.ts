import { prisma } from "@/src/lib/db";
import { WETH } from "@/src/config/contracts";
import type { TrackedTrade } from "./cost-basis";

/**
 * Loads HoodDesk's own recorded trade history for a wallet from:
 *  - AutomatedOrder + OrderExecution rows for orders this app executed
 *    (CONFIRMED orders with a CONFIRMED execution).
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
        ownerAddress: address,
        chainId,
        status: "CONFIRMED",
      },
      include: {
        executions: {
          where: { status: "CONFIRMED" },
          orderBy: { createdAt: "desc" },
          take: 1,
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

  for (const order of orders) {
    const execution = order.executions[0];
    if (!execution) continue;

    const isBuy = order.tokenIn.toLowerCase() === weth;
    const tokenAddress = (isBuy ? order.tokenOut : order.tokenIn).toLowerCase();

    let tokenAmount: bigint;
    let ethAmount: bigint;
    try {
      if (isBuy) {
        tokenAmount = BigInt(execution.expectedOutput);
        ethAmount = BigInt(order.amountIn);
      } else {
        tokenAmount = BigInt(order.amountIn);
        ethAmount = BigInt(execution.expectedOutput);
      }
    } catch {
      continue; // malformed numeric fields — skip rather than guess
    }

    if (tokenAmount <= 0n) continue;

    trades.push({
      tokenAddress,
      side: isBuy ? "buy" : "sell",
      tokenAmount,
      ethAmount,
      timestamp: (order.executedAt ?? execution.createdAt).getTime(),
    });
  }

  for (const tx of trackedTxs) {
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
    if (tokenAmount <= 0n) continue;

    trades.push({
      tokenAddress,
      side,
      tokenAmount,
      ethAmount,
      timestamp: tx.createdAt.getTime(),
    });
  }

  return trades;
}
