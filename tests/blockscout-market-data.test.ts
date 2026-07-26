import { beforeEach, describe, expect, it, vi } from "vitest";

const blockscoutMock = vi.hoisted(() => ({
  blockscoutGet: vi.fn(),
  blockscoutRpcGet: vi.fn(),
}));

vi.mock("@/src/lib/blockscout/client", () => blockscoutMock);

import {
  getBlockscoutTokenMarketData,
  getBlockscoutV2SwapHistory,
  getBlockscoutV2Swaps,
} from "@/src/lib/blockscout/market-data";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Blockscout market data", () => {
  it("normalizes indexed token market fields", async () => {
    blockscoutMock.blockscoutGet.mockResolvedValue({
      holders_count: "1646",
      total_supply: "1000000000000000000000000000",
      exchange_rate: "0.00013224",
      circulating_market_cap: "132238.81",
      volume_24h: "3667.255432409726",
    });

    const result = await getBlockscoutTokenMarketData(
      "0x1111111111111111111111111111111111111111"
    );

    expect(result).toEqual({
      holdersCount: 1646,
      totalSupplyRaw: "1000000000000000000000000000",
      priceUsd: 0.00013224,
      marketCapUsd: 132238.81,
      volume24hUsd: 3667.255432409726,
    });
  });

  it("rejects invalid indexed volume without discarding other fields", async () => {
    blockscoutMock.blockscoutGet.mockResolvedValue({
      holders_count: "10",
      total_supply: "1000",
      exchange_rate: "0.5",
      circulating_market_cap: "500",
      volume_24h: "-1",
    });

    const result = await getBlockscoutTokenMarketData(
      "0x5555555555555555555555555555555555555555"
    );

    expect(result.volume24hUsd).toBeNull();
    expect(result.holdersCount).toBe(10);
  });

  it("parses decoded V2 Swap logs without RPC block lookups", async () => {
    blockscoutMock.blockscoutGet.mockResolvedValue({
      items: [{
        block_number: 123,
        block_timestamp: "2026-07-26T04:57:31Z",
        transaction_hash: "0xabc",
        decoded: {
          method_call:
            "Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
          parameters: [
            { name: "sender", value: "0xsender" },
            { name: "amount0In", value: "0" },
            { name: "amount1In", value: "1000" },
            { name: "amount0Out", value: "25" },
            { name: "amount1Out", value: "0" },
            { name: "to", value: "0xrecipient" },
          ],
        },
      }],
      next_page_params: null,
    });

    const result = await getBlockscoutV2Swaps(
      "0x2222222222222222222222222222222222222222",
      { sinceTimestamp: 1_700_000_000 }
    );

    expect(result.truncated).toBe(false);
    expect(result.swaps[0]).toMatchObject({
      transactionHash: "0xabc",
      blockNumber: 123,
      amount0Out: 25n,
      amount1In: 1000n,
      to: "0xrecipient",
    });
  });

  it("keeps verified swap pages when a later Blockscout page stays unavailable", async () => {
    blockscoutMock.blockscoutGet
      .mockResolvedValueOnce({
        items: [{
          block_number: 123,
          block_timestamp: "2026-07-26T04:57:31Z",
          transaction_hash: "0xpartial",
          decoded: {
            method_call: "Swap(address,uint256,uint256,uint256,uint256,address)",
            parameters: [
              { name: "sender", value: "0xsender" },
              { name: "amount0In", value: "0" },
              { name: "amount1In", value: "1000" },
              { name: "amount0Out", value: "25" },
              { name: "amount1Out", value: "0" },
              { name: "to", value: "0xrecipient" },
            ],
          },
        }],
        next_page_params: {
          block_number: 122,
          index: 1,
          items_count: 50,
        },
      })
      .mockRejectedValue(new Error("Blockscout 500"));

    const result = await getBlockscoutV2Swaps(
      "0x3333333333333333333333333333333333333333",
      { limit: 100 }
    );

    expect(result.swaps).toHaveLength(1);
    expect(result.swaps[0].transactionHash).toBe("0xpartial");
    expect(result.truncated).toBe(true);
    expect(blockscoutMock.blockscoutGet).toHaveBeenCalledTimes(4);
  });

  it("loads historical swaps from bounded Blockscout block ranges", async () => {
    const uint256 = (value: bigint) => value.toString(16).padStart(64, "0");
    blockscoutMock.blockscoutRpcGet.mockImplementation(
      (params: Record<string, string>) => {
        if (params.action === "getblocknobytime") {
          return Promise.resolve({
            status: "1",
            message: "OK",
            result: {
              blockNumber: params.closest === "after" ? "100" : "101",
            },
          });
        }

        return Promise.resolve({
          status: "1",
          message: "OK",
          result:
            params.fromBlock === "100"
              ? [{
                  blockNumber: "0x64",
                  data: `0x${uint256(0n)}${uint256(1_000n)}${uint256(25n)}${uint256(0n)}`,
                  timeStamp: "0x65",
                  transactionHash: "0xhistory",
                  topics: [
                    "0xtopic",
                    `0x${"0".repeat(24)}${"1".repeat(40)}`,
                    `0x${"0".repeat(24)}${"2".repeat(40)}`,
                  ],
                }]
              : [],
        });
      }
    );

    const result = await getBlockscoutV2SwapHistory(
      "0x4444444444444444444444444444444444444444",
      { sinceTimestamp: 1, limit: 100 }
    );

    expect(result).toMatchObject({
      truncated: false,
      swaps: [{
        transactionHash: "0xhistory",
        blockNumber: 100,
        timestamp: 101,
        amount0Out: 25n,
        amount1In: 1_000n,
      }],
    });
    expect(blockscoutMock.blockscoutRpcGet).toHaveBeenCalledTimes(3);
  });
});
