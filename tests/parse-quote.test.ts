import { describe, expect, it } from "vitest";
import { parseQuote, type QuoteApiResponse } from "../components/trading/types";

const sample: QuoteApiResponse = {
  tokenIn: "0x1111111111111111111111111111111111111111" as `0x${string}`,
  tokenOut: "0x2222222222222222222222222222222222222222" as `0x${string}`,
  amountIn: "1000000000000000000",
  expectedAmountOut: "2000000000000000000",
  minimumAmountOut: "1950000000000000000",
  displayPrice: "2.0",
  inversePrice: "0.5",
  estimatedPriceImpactBps: 50,
  route: {
    kind: "v2",
    path: [
      "0x1111111111111111111111111111111111111111" as `0x${string}`,
      "0x2222222222222222222222222222222222222222" as `0x${string}`,
    ],
    factoryAddress: "0x3333333333333333333333333333333333333333" as `0x${string}`,
    routerAddress: "0x4444444444444444444444444444444444444444" as `0x${string}`,
  },
  approvalTarget: "0x4444444444444444444444444444444444444444" as `0x${string}`,
  expiresAt: 9999999999,
};

describe("parseQuote", () => {
  it("converts all serialized bigint fields to BigInt", () => {
    const parsed = parseQuote(sample);
    expect(parsed.amountIn).toBe(1000000000000000000n);
    expect(parsed.expectedAmountOut).toBe(2000000000000000000n);
    expect(parsed.minimumAmountOut).toBe(1950000000000000000n);
  });

  it("preserves non-bigint fields unchanged", () => {
    const parsed = parseQuote(sample);
    expect(parsed.displayPrice).toBe("2.0");
    expect(parsed.inversePrice).toBe("0.5");
    expect(parsed.estimatedPriceImpactBps).toBe(50);
    expect(parsed.route.kind).toBe("v2");
    expect(parsed.expiresAt).toBe(9999999999);
  });

  it("handles curve route kind", () => {
    const curve: QuoteApiResponse = {
      ...sample,
      route: { kind: "curve", path: [sample.tokenIn, sample.tokenOut], factoryAddress: sample.route.factoryAddress },
    };
    const parsed = parseQuote(curve);
    expect(parsed.route.kind).toBe("curve");
    expect(parsed.route.routerAddress).toBeUndefined();
  });

  it("handles zero values", () => {
    const zero: QuoteApiResponse = {
      ...sample,
      amountIn: "0",
      expectedAmountOut: "0",
      minimumAmountOut: "0",
    };
    const parsed = parseQuote(zero);
    expect(parsed.amountIn).toBe(0n);
    expect(parsed.expectedAmountOut).toBe(0n);
    expect(parsed.minimumAmountOut).toBe(0n);
  });
});
