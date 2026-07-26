import { describe, expect, it } from "vitest";
import {
  encodeAbiParameters,
  encodeEventTopics,
  type Address,
  type Hex,
} from "viem";
import { ERC20_ABI } from "@/src/lib/dex/abi/erc20";
import { UNISWAP_V2_PAIR_ABI } from "@/src/lib/dex/abi/uniswap-v2-pair";
import { deriveSwapAmounts } from "@/src/lib/portfolio/swap-receipt";
import type { SwapReceiptLog } from "@/src/lib/portfolio/swap-receipt";

const TOKEN = "0x1000000000000000000000000000000000000001" as Address;
const WALLET = "0x3000000000000000000000000000000000000003" as Address;
const PAIR = "0x4000000000000000000000000000000000000004" as Address;
const FEE = "0x5000000000000000000000000000000000000005" as Address;

function transferLog(from: Address, to: Address, value: bigint): SwapReceiptLog {
  return {
    address: TOKEN,
    topics: encodeEventTopics({
      abi: ERC20_ABI,
      eventName: "Transfer",
      args: { from, to },
    }) as Hex[],
    data: encodeAbiParameters([{ type: "uint256" }], [value]),
  };
}

function swapLog(args: {
  amount0In: bigint;
  amount1In: bigint;
  amount0Out: bigint;
  amount1Out: bigint;
}): SwapReceiptLog {
  return {
    address: PAIR,
    topics: encodeEventTopics({
      abi: UNISWAP_V2_PAIR_ABI,
      eventName: "Swap",
      args: { sender: WALLET, to: WALLET },
    }) as Hex[],
    data: encodeAbiParameters(
      [
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
        { type: "uint256" },
      ],
      [args.amount0In, args.amount1In, args.amount0Out, args.amount1Out]
    ),
  };
}

describe("deriveSwapAmounts", () => {
  it("uses the net token transfer received by a V2 buyer", () => {
    const result = deriveSwapAmounts({
      logs: [
        transferLog(PAIR, FEE, 10n),
        transferLog(PAIR, WALLET, 990n),
      ],
      walletAddress: WALLET,
      tokenAddress: TOKEN,
      side: "buy",
      route: { kind: "v2", pairAddress: PAIR, wethTokenIndex: 0 },
      transactionValue: 100n,
    });

    expect(result).toEqual({ tokenAmount: 990n, ethAmount: 100n });
  });

  it("matches the user sell swap and ignores an internal fee-token swap", () => {
    const result = deriveSwapAmounts({
      logs: [
        transferLog(WALLET, FEE, 14n),
        transferLog(WALLET, PAIR, 1_386n),
        swapLog({
          amount0In: 0n,
          amount1In: 100n,
          amount0Out: 7n,
          amount1Out: 0n,
        }),
        swapLog({
          amount0In: 0n,
          amount1In: 1_386n,
          amount0Out: 93n,
          amount1Out: 0n,
        }),
      ],
      walletAddress: WALLET,
      tokenAddress: TOKEN,
      side: "sell",
      route: { kind: "v2", pairAddress: PAIR, wethTokenIndex: 0 },
      transactionValue: 0n,
    });

    expect(result).toEqual({ tokenAmount: 1_400n, ethAmount: 93n });
  });

  it("fails closed when a V2 sell cannot be tied to one pair swap", () => {
    expect(() =>
      deriveSwapAmounts({
        logs: [transferLog(WALLET, FEE, 14n)],
        walletAddress: WALLET,
        tokenAddress: TOKEN,
        side: "sell",
        route: { kind: "v2", pairAddress: PAIR, wethTokenIndex: 0 },
        transactionValue: 0n,
      })
    ).toThrow("Unable to match");
  });
});
