import { describe, it, expect } from "vitest";

function applySlippage(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(10000 - slippageBps)) / 10000n;
}

function calculatePriceImpact(
  amountIn: bigint,
  amountOut: bigint,
  reserveIn: bigint,
  reserveOut: bigint
): number {
  // Constant product formula impact
  const expectedOut = (amountIn * reserveOut) / reserveIn;
  const impact = Number((expectedOut - amountOut) * 10000n / expectedOut);
  return impact;
}

describe("Slippage calculations", () => {
  it("applies 1% slippage correctly", () => {
    const amount = 1000000000000000000n; // 1 ETH
    const result = applySlippage(amount, 100); // 1% = 100 bps
    expect(result).toBe(990000000000000000n);
  });

  it("applies 5% slippage correctly", () => {
    const amount = 1000000000000000000n;
    const result = applySlippage(amount, 500);
    expect(result).toBe(950000000000000000n);
  });

  it("handles 0% slippage", () => {
    const amount = 1000000000000000000n;
    const result = applySlippage(amount, 0);
    expect(result).toBe(amount);
  });

  it("handles max slippage", () => {
    const amount = 1000000000000000000n;
    const result = applySlippage(amount, 10000);
    expect(result).toBe(0n);
  });
});

describe("Price impact", () => {
  it("calculates zero impact for small trade", () => {
    const amountIn = 1000000000000000n; // 0.001 ETH
    const reserveIn = 100000000000000000000n; // 100 ETH
    const reserveOut = 1000000000000000000000n; // 1000 tokens
    const amountOut = (amountIn * reserveOut) / reserveIn;
    const impact = calculatePriceImpact(amountIn, amountOut, reserveIn, reserveOut);
    expect(impact).toBe(0);
  });
});
