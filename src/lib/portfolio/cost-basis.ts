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
  let netTokenQty = 0n;
  let costBasisWei = 0n;
  let realizedPnlWei = 0n;
  let hasAnyBuyHistory = false;
  let hasIncompleteHistory = false;

  for (const trade of sorted) {
    if (trade.side === "buy") {
      netTokenQty += trade.tokenAmount;
      hasAnyBuyHistory = true;
      trackedTokenQty += trade.tokenAmount;
      costBasisWei += trade.ethAmount;
    } else if (trade.side === "sell") {
      netTokenQty -= trade.tokenAmount;
      if (!hasAnyBuyHistory) {
        hasIncompleteHistory = true;
        continue;
      }
      if (trackedTokenQty === 0n) {
        hasIncompleteHistory = true;
        continue;
      }

      if (trade.tokenAmount > trackedTokenQty) {
        hasIncompleteHistory = true;
      }
      const soldAmount = trade.tokenAmount > trackedTokenQty ? trackedTokenQty : trade.tokenAmount;
      const proceedsWei = (trade.ethAmount * soldAmount) / trade.tokenAmount;
      const costWei = (costBasisWei * soldAmount) / trackedTokenQty;

      realizedPnlWei += (proceedsWei - costWei);
      trackedTokenQty -= soldAmount;
      costBasisWei -= costWei;
    }
  }

  return {
    trackedTokenQty,
    netTokenQty,
    costBasisWei,
    realizedPnlWei,
    hasAnyBuyHistory,
    hasIncompleteHistory,
  };
}

/**
 * Returns cost basis only when the tracked quantity exactly matches the
 * onchain balance. A mismatch means an acquisition, disposal, or transfer is
 * missing from history, so prorating would invent an accounting assumption.
 */
export function costBasisForHolding(
  accumulation: { trackedTokenQty: bigint; costBasisWei: bigint },
  actualBalance: bigint
) {
  if (accumulation.trackedTokenQty === 0n) return null;
  if (actualBalance !== accumulation.trackedTokenQty) return null;
  return { costBasisWei: accumulation.costBasisWei };
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
