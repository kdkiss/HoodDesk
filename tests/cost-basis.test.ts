import { describe, it, expect } from "vitest";
import {
  computeCostBasis,
  costBasisForHolding,
  computeUnrealizedPnl,
  type TrackedTrade,
} from "../src/lib/portfolio/cost-basis";

const TOKEN = "0xtoken";

describe("computeCostBasis", () => {
  it("returns zero/unavailable state with no trades", () => {
    const result = computeCostBasis([]);
    expect(result.trackedTokenQty).toBe(0n);
    expect(result.costBasisWei).toBe(0n);
    expect(result.realizedPnlWei).toBe(0n);
    expect(result.hasAnyBuyHistory).toBe(false);
  });

  it("ignores runtime trade sides outside buy and sell", () => {
    const trades = [
      {
        tokenAddress: TOKEN,
        side: "transfer",
        tokenAmount: 100n,
        ethAmount: 100n,
        timestamp: 1,
      },
    ] as unknown as TrackedTrade[];

    const result = computeCostBasis(trades);
    expect(result.trackedTokenQty).toBe(0n);
    expect(result.costBasisWei).toBe(0n);
    expect(result.realizedPnlWei).toBe(0n);
    expect(result.hasAnyBuyHistory).toBe(false);
  });

  it("computes weighted-average cost basis across two buys at different prices", () => {
    const trades: TrackedTrade[] = [
      {
        tokenAddress: TOKEN,
        side: "buy",
        tokenAmount: 1000n, // 1000 tokens for 1 ETH -> 0.001 ETH/token
        ethAmount: 1_000_000_000_000_000_000n,
        timestamp: 1,
      },
      {
        tokenAddress: TOKEN,
        side: "buy",
        tokenAmount: 1000n, // 1000 tokens for 3 ETH -> 0.003 ETH/token
        ethAmount: 3_000_000_000_000_000_000n,
        timestamp: 2,
      },
    ];

    const result = computeCostBasis(trades);
    // Total: 2000 tokens for 4 ETH -> weighted avg 0.002 ETH/token
    expect(result.trackedTokenQty).toBe(2000n);
    expect(result.costBasisWei).toBe(4_000_000_000_000_000_000n);
    expect(result.hasAnyBuyHistory).toBe(true);
    expect(result.realizedPnlWei).toBe(0n);
  });

  it("matches sells against weighted-average cost basis and realizes P&L", () => {
    const trades: TrackedTrade[] = [
      {
        tokenAddress: TOKEN,
        side: "buy",
        tokenAmount: 1000n,
        ethAmount: 1_000_000_000_000_000_000n, // 1 ETH for 1000 tokens
        timestamp: 1,
      },
      {
        tokenAddress: TOKEN,
        side: "sell",
        tokenAmount: 500n, // sell half at a profit: receive 1 ETH for 500 tokens
        ethAmount: 1_000_000_000_000_000_000n,
        timestamp: 2,
      },
    ];

    const result = computeCostBasis(trades);
    // Cost of 500 sold = 0.5 ETH (half of 1 ETH cost). Proceeds = 1 ETH.
    // Realized P&L = 1 - 0.5 = 0.5 ETH.
    expect(result.realizedPnlWei).toBe(500_000_000_000_000_000n);
    expect(result.trackedTokenQty).toBe(500n);
    expect(result.costBasisWei).toBe(500_000_000_000_000_000n);
  });

  it("skips a sell with no prior tracked buy history rather than inventing cost basis", () => {
    const trades: TrackedTrade[] = [
      {
        tokenAddress: TOKEN,
        side: "sell",
        tokenAmount: 500n,
        ethAmount: 1_000_000_000_000_000_000n,
        timestamp: 1,
      },
    ];

    const result = computeCostBasis(trades);
    expect(result.hasAnyBuyHistory).toBe(false);
    expect(result.realizedPnlWei).toBe(0n);
    expect(result.trackedTokenQty).toBe(0n);
  });

  it("skips a sell after all tracked quantity has already been sold", () => {
    const trades: TrackedTrade[] = [
      {
        tokenAddress: TOKEN,
        side: "buy",
        tokenAmount: 100n,
        ethAmount: 100n,
        timestamp: 1,
      },
      {
        tokenAddress: TOKEN,
        side: "sell",
        tokenAmount: 100n,
        ethAmount: 100n,
        timestamp: 2,
      },
      {
        tokenAddress: TOKEN,
        side: "sell",
        tokenAmount: 100n,
        ethAmount: 100n,
        timestamp: 3,
      },
    ];

    const result = computeCostBasis(trades);
    expect(result.hasAnyBuyHistory).toBe(true);
    expect(result.trackedTokenQty).toBe(0n);
    expect(result.costBasisWei).toBe(0n);
    expect(result.realizedPnlWei).toBe(0n);
  });

  it("clamps a sell larger than tracked quantity instead of guessing at the remainder", () => {
    const trades: TrackedTrade[] = [
      {
        tokenAddress: TOKEN,
        side: "buy",
        tokenAmount: 1000n,
        ethAmount: 1_000_000_000_000_000_000n,
        timestamp: 1,
      },
      {
        tokenAddress: TOKEN,
        side: "sell",
        tokenAmount: 5000n, // far more than the 1000 tracked
        ethAmount: 5_000_000_000_000_000_000n,
        timestamp: 2,
      },
    ];

    const result = computeCostBasis(trades);
    // Only 1000 tokens (all tracked) get matched; proceeds prorated to 1000/5000 = 1 ETH.
    expect(result.trackedTokenQty).toBe(0n);
    expect(result.costBasisWei).toBe(0n);
    expect(result.realizedPnlWei).toBe(1_000_000_000_000_000_000n - 1_000_000_000_000_000_000n);
  });
});

describe("costBasisForHolding", () => {
  it("returns null when there is no tracked buy history", () => {
    const result = costBasisForHolding(
      { trackedTokenQty: 0n, costBasisWei: 0n },
      1000n
    );
    expect(result).toBeNull();
  });

  it("returns null when the wallet holds more than HoodDesk ever tracked buying (untracked acquisition)", () => {
    const result = costBasisForHolding(
      { trackedTokenQty: 500n, costBasisWei: 500_000_000_000_000_000n },
      1000n // actual balance exceeds tracked quantity
    );
    expect(result).toBeNull();
  });

  it("returns full cost basis when tracked quantity matches actual balance exactly", () => {
    const result = costBasisForHolding(
      { trackedTokenQty: 1000n, costBasisWei: 2_000_000_000_000_000_000n },
      1000n
    );
    expect(result).not.toBeNull();
    expect(result!.costBasisWei).toBe(2_000_000_000_000_000_000n);
  });

  it("prorates cost basis down when tracked quantity exceeds actual balance", () => {
    const result = costBasisForHolding(
      { trackedTokenQty: 1000n, costBasisWei: 2_000_000_000_000_000_000n },
      500n // wallet only holds half of what HoodDesk tracked (e.g. moved out)
    );
    expect(result).not.toBeNull();
    expect(result!.costBasisWei).toBe(1_000_000_000_000_000_000n);
  });
});

describe("computeUnrealizedPnl", () => {
  it("returns null when current value is unavailable", () => {
    expect(
      computeUnrealizedPnl({ currentValueWei: null, costBasisWei: 100n })
    ).toBeNull();
  });

  it("returns null when cost basis is unavailable", () => {
    expect(
      computeUnrealizedPnl({ currentValueWei: 100n, costBasisWei: null })
    ).toBeNull();
  });

  it("computes profit when current value exceeds cost basis", () => {
    expect(
      computeUnrealizedPnl({ currentValueWei: 300n, costBasisWei: 100n })
    ).toBe(200n);
  });

  it("computes loss when current value is below cost basis", () => {
    expect(
      computeUnrealizedPnl({ currentValueWei: 50n, costBasisWei: 100n })
    ).toBe(-50n);
  });
});
