import { describe, expect, it } from "vitest";
import { deriveStateChangeSwapAmounts } from "@/src/lib/portfolio/state-change-swap";

const WALLET = "0x01d6f8364216adeaaaa6056d6fde6727f672203f";
const TOKEN = "0x56a98db16cf501b686c14ba00a5dec02e87083fa";

describe("deriveStateChangeSwapAmounts", () => {
  it("separates gas from the native amount spent on an external buy", () => {
    const result = deriveStateChangeSwapAmounts({
      walletAddress: WALLET,
      tokenAddress: TOKEN,
      gasFeeWei: 7_484_305_804_000n,
      stateChanges: [
        {
          type: "coin",
          address: { hash: WALLET },
          token: null,
          change: "-2007484305804000",
        },
        {
          type: "token",
          address: { hash: WALLET },
          token: { address_hash: TOKEN },
          change: "14189263849214042582794",
        },
      ],
    });

    expect(result).toEqual({
      side: "buy",
      tokenAmount: 14_189_263_849_214_042_582_794n,
      ethAmount: 2_000_000_000_000_000n,
    });
  });

  it("adds gas back to isolate external sell proceeds", () => {
    const result = deriveStateChangeSwapAmounts({
      walletAddress: WALLET,
      tokenAddress: TOKEN,
      gasFeeWei: 19_610_755_750_000n,
      stateChanges: [
        {
          type: "coin",
          address: { hash: WALLET },
          token: null,
          change: "889021712703717",
        },
        {
          type: "token",
          address: { hash: WALLET },
          token: { address_hash: TOKEN },
          change: "-9491349683651560749360",
        },
      ],
    });

    expect(result).toEqual({
      side: "sell",
      tokenAmount: 9_491_349_683_651_560_749_360n,
      ethAmount: 908_632_468_453_717n,
    });
  });

  it("rejects a token transfer with no native trade leg", () => {
    expect(() =>
      deriveStateChangeSwapAmounts({
        walletAddress: WALLET,
        tokenAddress: TOKEN,
        gasFeeWei: 10n,
        stateChanges: [
          {
            type: "coin",
            address: { hash: WALLET },
            token: null,
            change: "-10",
          },
          {
            type: "token",
            address: { hash: WALLET },
            token: { address_hash: TOKEN },
            change: "-1000",
          },
        ],
      })
    ).toThrow("opposite native and token legs");
  });
});
