export interface TrackedTrade {
  tokenAddress: string;
  side: "buy" | "sell";
  tokenAmount: bigint;
  ethAmount: bigint;
  timestamp: number;
}

/**
 * Computes the weighted-average cost basis and realized P&L from transaction history.
 *
 * - Only BUY transactions contribute to cost basis.
 * - SELL transactions reduce the tracked quantity and realize P&L.
 * - Cost basis is weighted by the number of tokens acquired in each BUY.
 */
export function computeCostBasis(trades: TrackedTrade[]) {
  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  let trackedTokenQty = 0n;
  let costBasisWei = 0n;
  let realizedPnlWei = 0n;
  let hasAnyBuyHistory = false;

  for (const trade of sorted) {
    if (trade.side === "buy") {
      hasAnyBuyHistory = true;
      trackedTokenQty += trade.tokenAmount;
      costBasisWei += trade.ethAmount;
    } else if (trade.side === "sell") {
      if (!hasAnyBuyHistory) {
        continue;
      }
      if (trackedTokenQty === 0n) {
        continue;
      }

      const soldAmount = trade.tokenAmount > trackedTokenQty ? trackedTokenQty : trade.tokenAmount;
      const proceedsWei = (trade.ethAmount * soldAmount) / trade.tokenAmount;
      const costWei = (costBasisWei * soldAmount) / trackedTokenQty;

      realizedPnlWei += (proceedsWei - costWei);
      trackedTokenQty -= soldAmount;
      costBasisWei -= costWei;
    }
  }

  return { trackedTokenQty, costBasisWei, realizedPnlWei, hasAnyBuyHistory };
}

/**
 * Returns the prorated cost basis for a specific held balance, given the
 * accumulation metrics from tracked trades.
 */
export function costBasisForHolding(
  accumulation: { trackedTokenQty: bigint; costBasisWei: bigint },
  actualBalance: bigint
) {
  if (accumulation.trackedTokenQty === 0n) return null;
  if (actualBalance > accumulation.trackedTokenQty) return null;

  if (actualBalance === accumulation.trackedTokenQty) {
    return { costBasisWei: accumulation.costBasisWei };
  }

  const costBasisWei = (accumulation.costBasisWei * actualBalance) / accumulation.trackedTokenQty;
  return { costBasisWei };
}

/**
 * Computes unrealized profit/loss.
 */
export function computeUnrealizedPnl({
  currentValueWei,
  costBasisWei,
}: {
  currentValueWei: bigint | null;
  costBasisWei: bigint | null;
}) {
  if (currentValueWei === null || costBasisWei === null) return null;
  return currentValueWei - costBasisWei;
}
