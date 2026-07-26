import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  automatedOrder: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  orderEvent: {
    create: vi.fn(),
  },
  tokenMetadata: {
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
}));

const processOrderMock = vi.hoisted(() => vi.fn());
const blockscoutMarketMock = vi.hoisted(() => ({
  getBlockscoutTokenMarketData: vi.fn(),
}));

vi.mock("@/src/lib/db", () => ({ prisma: prismaMock }));
vi.mock("../worker/index", () => ({ processOrder: processOrderMock }));
vi.mock("@/src/lib/blockscout/market-data", () => blockscoutMarketMock);

const address = "0x1111111111111111111111111111111111111111" as const;
const token = "0x2222222222222222222222222222222222222222" as const;

beforeEach(() => {
  vi.clearAllMocks();
  blockscoutMarketMock.getBlockscoutTokenMarketData.mockResolvedValue({
    volume24hUsd: 123.45,
  });
  process.env.NEXT_PUBLIC_CHAIN_ID = "4663";
});

describe("processDcaOrders", () => {
  it("skips orders without metadata and orders not yet due", async () => {
    prismaMock.automatedOrder.findMany.mockResolvedValue([
      { id: "missing-meta", metadata: null },
      {
        id: "future",
        metadata: { totalIterations: 2, currentIteration: 0, startAt: "2999-01-01T00:00:00.000Z" },
        orderSubtype: "DAILY",
      },
    ]);
    const { processDcaOrders } = await import("../worker/dca");

    await processDcaOrders();
    expect(processOrderMock).not.toHaveBeenCalled();
    expect(prismaMock.automatedOrder.update).not.toHaveBeenCalled();
  });

  it("executes due DCA orders and completes the final iteration", async () => {
    processOrderMock.mockResolvedValue({ result: "success", txHash: "0xabc" });
    prismaMock.automatedOrder.findMany.mockResolvedValue([
      {
        id: "dca-1",
        metadata: { totalIterations: 1, currentIteration: 0, startAt: "2000-01-01T00:00:00.000Z" },
        orderSubtype: "WEEKLY",
      },
    ]);
    const { processDcaOrders } = await import("../worker/dca");

    await processDcaOrders();
    expect(processOrderMock).toHaveBeenCalledWith(expect.objectContaining({ triggerPrice: "0", triggerDirection: "gte" }));
    expect(prismaMock.automatedOrder.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "dca-1" },
      data: expect.objectContaining({ status: "COMPLETED" }),
    }));
    expect(prismaMock.orderEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: "ITERATION_COMPLETED" }),
    }));
  });

  it("records failed DCA iterations", async () => {
    processOrderMock.mockRejectedValue(new Error("boom"));
    prismaMock.automatedOrder.findMany.mockResolvedValue([
      {
        id: "dca-fail",
        metadata: { totalIterations: 2, currentIteration: 0, startAt: "2000-01-01T00:00:00.000Z" },
        orderSubtype: "MONTHLY",
      },
    ]);
    const { processDcaOrders } = await import("../worker/dca");

    await processDcaOrders();
    expect(prismaMock.orderEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: "FAILED", message: "DCA iteration failed: boom" }),
    }));
  });
});

describe("runTokenDiscovery", () => {
  it("enumerates factory tokens, fetches metadata, and upserts records", async () => {
    const client = {
      readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
        if (functionName === "allTokensLength") return 1n;
        if (functionName === "allTokens") return token;
        if (functionName === "curves") return [1n, 2n, 3n, 4n, 5n, 6n, 7n, false, false, address, address];
        if (functionName === "name") return "Token";
        if (functionName === "symbol") return "TOK";
        if (functionName === "decimals") return 18;
        if (functionName === "totalSupply") return 1000n;
        throw new Error(functionName);
      }),
    };
    prismaMock.tokenMetadata.findUnique.mockResolvedValue(null);
    const { runTokenDiscovery } = await import("../worker/token-discovery");

    await runTokenDiscovery(client as never, 4663);
    expect(prismaMock.tokenMetadata.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ volume24hUsd: "123.45" }),
      })
    );
  });

  it("continues when factory enumeration fails", async () => {
    const client = { readContract: vi.fn().mockRejectedValue(new Error("rpc down")) };
    const { runTokenDiscovery } = await import("../worker/token-discovery");

    await expect(runTokenDiscovery(client as never, 4663)).resolves.toBeUndefined();
    expect(prismaMock.tokenMetadata.upsert).not.toHaveBeenCalled();
  });
});
