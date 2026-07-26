import { beforeEach, describe, expect, it, vi } from "vitest";

const clientMock = vi.hoisted(() => ({
  getBlockNumber: vi.fn(),
  readContract: vi.fn(),
}));

vi.mock("@/src/lib/chain/client", () => ({
  getPublicClient: () => clientMock,
}));
vi.mock("@/src/lib/chain/retry", () => ({
  retryRpcRead: (read: () => Promise<unknown>) => read(),
}));

import { WETH } from "@/src/config/contracts";
import { RobinFunV2Adapter } from "@/src/lib/dex/adapters/robinfun-v2";

const token = "0x2222222222222222222222222222222222222222" as const;
const pair = "0x3333333333333333333333333333333333333333" as const;

beforeEach(() => {
  vi.clearAllMocks();
  clientMock.getBlockNumber.mockResolvedValue(123n);
  clientMock.readContract.mockImplementation(
    ({ functionName }: { functionName: string }) => {
      if (functionName === "pair") return Promise.resolve(pair);
      if (functionName === "getAmountsOut") {
        return Promise.resolve([100n, 90n]);
      }
      if (functionName === "token0") return Promise.resolve(WETH);
      if (functionName === "token1") return Promise.resolve(token);
      if (functionName === "getReserves") {
        return Promise.resolve([1_000n, 1_000n, 0]);
      }
      throw new Error(`Unexpected contract read: ${functionName}`);
    }
  );
});

describe("RobinFun V2 quote price impact", () => {
  it("uses a same-block router quote and reserve snapshot", async () => {
    const adapter = new RobinFunV2Adapter();

    const quote = await adapter.buildSwapQuote(WETH, token, 100n, 100);

    expect(quote.estimatedPriceImpactBps).toBe(1_000);
    expect(quote.blockNumber).toBe(123n);
    expect(quote.route.poolAddress).toBe(pair);
    expect(clientMock.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "getAmountsOut",
        blockNumber: 123n,
      })
    );
    expect(clientMock.readContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "getReserves",
        blockNumber: 123n,
      })
    );
  });
});
