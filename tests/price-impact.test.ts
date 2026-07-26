import { describe, expect, it } from "vitest";
import {
  assertPriceImpactWithinLimit,
  calculateConstantProductPriceImpactBps,
} from "@/src/lib/dex/price-impact";

describe("constant-product price impact", () => {
  it("compares the quoted execution rate with the pre-trade spot rate", () => {
    expect(
      calculateConstantProductPriceImpactBps({
        amountIn: 100n,
        expectedAmountOut: 90n,
        reserveIn: 1_000n,
        reserveOut: 1_000n,
      })
    ).toBe(1_000);
  });

  it("uses reserve orientation supplied by the caller", () => {
    expect(
      calculateConstantProductPriceImpactBps({
        amountIn: 50n,
        expectedAmountOut: 180n,
        reserveIn: 500n,
        reserveOut: 2_000n,
      })
    ).toBe(1_000);
  });

  it("treats a zero-output quote as total price impact", () => {
    expect(
      calculateConstantProductPriceImpactBps({
        amountIn: 1n,
        expectedAmountOut: 0n,
        reserveIn: 1_000n,
        reserveOut: 1_000n,
      })
    ).toBe(10_000);
  });

  it("rejects unusable reserve snapshots", () => {
    expect(() =>
      calculateConstantProductPriceImpactBps({
        amountIn: 1n,
        expectedAmountOut: 1n,
        reserveIn: 0n,
        reserveOut: 1_000n,
      })
    ).toThrow("V2 pool has no usable liquidity");
  });

  it("rejects quotes above an order's configured limit", () => {
    expect(() => assertPriceImpactWithinLimit(801, 800)).toThrow(
      "Price impact too high (8.01% exceeds 8.00%)"
    );
    expect(() => assertPriceImpactWithinLimit(800, 800)).not.toThrow();
  });
});
