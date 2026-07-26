import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseEther } from "viem";

const clientMock = vi.hoisted(() => ({
  readContract: vi.fn(),
}));

const blockscoutMock = vi.hoisted(() => ({
  getBlockscoutBlockNumberAtTimestamp: vi.fn(),
}));

vi.mock("@/src/lib/chain/client", () => ({
  getPublicClient: () => clientMock,
}));

vi.mock("@/src/lib/blockscout/market-data", () => blockscoutMock);

vi.mock("@/src/lib/dex", () => ({
  curveAdapter: { getCurrentPrice: vi.fn() },
  v2Adapter: {
    getTokenInfo: vi.fn(),
    getPairReserves: vi.fn(),
  },
}));

import { getPriceChanges24h } from "@/src/lib/market-price";

beforeEach(() => {
  vi.clearAllMocks();
  blockscoutMock.getBlockscoutBlockNumberAtTimestamp.mockResolvedValue(123);
});

describe("24-hour market price changes", () => {
  it("compares a curve token with its historical factory price", async () => {
    clientMock.readContract.mockResolvedValue(parseEther("1"));

    const result = await getPriceChanges24h(
      [{
        address: "0x2222222222222222222222222222222222222222",
        decimals: 18,
        dexLive: false,
        pairAddress: null,
        factoryAddress: "0x3333333333333333333333333333333333333333",
      }],
      ["2"]
    );

    expect(result).toEqual([100]);
    expect(clientMock.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "currentPrice",
        blockNumber: 123n,
      })
    );
  });

  it("compares a graduated token with historical pair reserves", async () => {
    clientMock.readContract.mockResolvedValue([
      parseEther("10"),
      parseEther("100"),
      0,
    ]);

    const result = await getPriceChanges24h(
      [{
        address: "0x56a98db16cf501b686c14ba00a5dec02e87083fa",
        decimals: 18,
        dexLive: true,
        pairAddress: "0xe53377eb912d08e1b0160e5ea0c626cf162870ff",
        factoryAddress: "0xd952a74c85a2221a7dab185c62cfd7eba8c94afc",
      }],
      ["0.2"]
    );

    expect(result[0]).toBeCloseTo(100);
    expect(clientMock.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "getReserves",
        blockNumber: 123n,
      })
    );
  });
});
