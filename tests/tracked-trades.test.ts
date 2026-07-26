import { beforeEach, describe, expect, it, vi } from "vitest";

const { findOrders, findTrackedTransactions } = vi.hoisted(() => ({
  findOrders: vi.fn(),
  findTrackedTransactions: vi.fn(),
}));

vi.mock("@/src/lib/db", () => ({
  prisma: {
    automatedOrder: { findMany: findOrders },
    trackedTransaction: { findMany: findTrackedTransactions },
  },
}));

import { getWalletTrackedTrades } from "@/src/lib/portfolio/tracked-trades";
import { WETH } from "@/src/config/contracts";

const WALLET = "0x3000000000000000000000000000000000000003";
const TOKEN = "0x1000000000000000000000000000000000000001";

describe("getWalletTrackedTrades", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findTrackedTransactions.mockResolvedValue([]);
  });

  it("loads every confirmed execution from completed DCA orders using actual amounts", async () => {
    findOrders.mockResolvedValue([
      {
        ownerAddress: WALLET,
        executionWallet: WALLET,
        tokenIn: WETH,
        tokenOut: TOKEN,
        amountIn: "999999",
        status: "COMPLETED",
        executions: [
          {
            status: "CONFIRMED",
            expectedOutput: "777777",
            actualTokenAmount: "100",
            actualEthAmount: "10",
            createdAt: new Date(1),
          },
          {
            status: "CONFIRMED",
            expectedOutput: "888888",
            actualTokenAmount: "200",
            actualEthAmount: "20",
            createdAt: new Date(2),
          },
        ],
      },
    ]);

    const trades = await getWalletTrackedTrades(WALLET, 4663);

    expect(trades).toEqual([
      {
        tokenAddress: TOKEN,
        side: "buy",
        tokenAmount: 100n,
        ethAmount: 10n,
        timestamp: 1,
      },
      {
        tokenAddress: TOKEN,
        side: "buy",
        tokenAmount: 200n,
        ethAmount: 20n,
        timestamp: 2,
      },
    ]);
    expect(findOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          chainId: 4663,
          executionWallet: WALLET.toLowerCase(),
        }),
        include: {
          executions: expect.objectContaining({
            where: { status: "CONFIRMED" },
          }),
        },
      })
    );
  });

  it("skips confirmed executions whose actual receipt amounts are unavailable", async () => {
    findOrders.mockResolvedValue([
      {
        ownerAddress: WALLET,
        executionWallet: WALLET,
        tokenIn: WETH,
        tokenOut: TOKEN,
        amountIn: "10",
        executions: [
          {
            expectedOutput: "500",
            actualTokenAmount: null,
            actualEthAmount: null,
            createdAt: new Date(1),
          },
        ],
      },
    ]);

    await expect(getWalletTrackedTrades(WALLET, 4663)).resolves.toEqual([]);
  });
});
