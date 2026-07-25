import { describe, expect, it } from "vitest";
import { parseEther } from "viem";
import { priceEthPerTokenFromReserves } from "@/src/lib/price-units";

describe("priceEthPerTokenFromReserves", () => {
  it("returns ETH per whole token, not tokens per ETH", () => {
    const wethReserve = parseEther("12");
    const tokenReserve = parseEther("100000");

    expect(priceEthPerTokenFromReserves(wethReserve, tokenReserve)).toBe(parseEther("0.00012"));
  });

  it("returns null when token liquidity is empty", () => {
    expect(priceEthPerTokenFromReserves(parseEther("1"), 0n)).toBeNull();
  });
});
