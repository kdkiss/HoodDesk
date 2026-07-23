import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const validOwner = "0x1111111111111111111111111111111111111111";
const validTokenIn = "0x2222222222222222222222222222222222222222";
const validTokenOut = "0x3333333333333333333333333333333333333333";

const prismaMock = vi.hoisted(() => ({
  automatedOrder: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  orderEvent: {
    create: vi.fn(),
  },
  watchlist: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  tokenMetadata: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
  },
  trackedTransaction: {
    findMany: vi.fn(),
  },
}));

const securityMock = vi.hoisted(() => ({
  checkRateLimit: vi.fn(() => null),
  RATE_LIMITS: {
    standard: { limit: 60, windowMs: 60_000 },
    onchainRead: { limit: 30, windowMs: 60_000 },
    mutation: { limit: 15, windowMs: 60_000 },
    emergency: { limit: 5, windowMs: 60_000 },
  },
  verifyAndConsumeAuthSignature: vi.fn(),
}));

const dexMock = vi.hoisted(() => ({
  getSwapQuote: vi.fn(),
  getTokenInfo: vi.fn(),
  curveAdapter: {
    getCurveState: vi.fn(),
    getCurrentPrice: vi.fn(),
  },
}));

const chainMock = vi.hoisted(() => ({
  getPublicClient: vi.fn(),
}));

const blockscoutMock = vi.hoisted(() => ({
  blockscoutGet: vi.fn(),
}));

vi.mock("@/src/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/src/lib/security/rate-limit", () => ({
  checkRateLimit: securityMock.checkRateLimit,
  RATE_LIMITS: securityMock.RATE_LIMITS,
}));
vi.mock("@/src/lib/security/authorization", () => ({
  verifyAndConsumeAuthSignature: securityMock.verifyAndConsumeAuthSignature,
}));
vi.mock("@/src/lib/dex", () => dexMock);
vi.mock("@/src/lib/chain/client", () => chainMock);
vi.mock("@/src/lib/blockscout/client", () => blockscoutMock);
vi.mock("viem/accounts", () => ({
  privateKeyToAccount: vi.fn(() => ({ address: validOwner })),
}));

function req(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: body === undefined ? undefined : { "content-type": "application/json" },
  });
}

async function json(res: Response) {
  return res.json() as Promise<Record<string, unknown>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  securityMock.checkRateLimit.mockReturnValue(null);
  securityMock.verifyAndConsumeAuthSignature.mockResolvedValue({ valid: true });
  process.env.NEXT_PUBLIC_CHAIN_ID = "4663";
  process.env.AUTOMATED_ORDERS_ENABLED = "true";
  process.env.EXECUTION_WALLET_ADDRESS = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
});

describe("quote API", () => {
  it("rejects invalid quote requests", async () => {
    const { POST } = await import("../app/api/quote/route");
    const res = await POST(req("http://test/api/quote", { tokenIn: "bad" }));
    expect(res.status).toBe(400);
    expect((await json(res)).error).toBe("Invalid request");
  });

  it("serializes a successful swap quote", async () => {
    dexMock.getSwapQuote.mockResolvedValue({
      tokenIn: validTokenIn,
      tokenOut: validTokenOut,
      amountIn: 100n,
      expectedAmountOut: 200n,
      minimumAmountOut: 190n,
      displayPrice: "2",
      inversePrice: "0.5",
      estimatedPriceImpactBps: 10,
      route: { kind: "v2", path: [validTokenIn, validTokenOut], factoryAddress: validOwner, routerAddress: validOwner },
      approvalTarget: validOwner,
      expiresAt: 123,
    });
    const { POST } = await import("../app/api/quote/route");
    const res = await POST(req("http://test/api/quote", {
      tokenIn: validTokenIn,
      tokenOut: validTokenOut,
      amountIn: "100",
      slippageBps: 50,
    }));
    expect(res.status).toBe(200);
    expect((await json(res)).quote).toMatchObject({ amountIn: "100", expectedAmountOut: "200" });
  });
});

describe("curve API", () => {
  it("rejects invalid token addresses", async () => {
    const { GET } = await import("../app/api/curve/route");
    const res = await GET(req("http://test/api/curve?token=bad"));
    expect(res.status).toBe(400);
  });

  it("returns curve state and handles price fallback", async () => {
    dexMock.curveAdapter.getCurveState.mockResolvedValue({
      virtualEth: 1n,
      realEth: 50n,
      tokenReserve: 100n,
      raiseTarget: 200n,
      readyToGraduate: false,
      graduated: false,
      creator: validOwner,
    });
    dexMock.curveAdapter.getCurrentPrice.mockRejectedValue(new Error("no price"));
    const { GET } = await import("../app/api/curve/route");
    const res = await GET(req(`http://test/api/curve?token=${validTokenIn}`));
    const data = await json(res);
    expect(res.status).toBe(200);
    expect(data.curve).toMatchObject({ progressPct: 25 });
    expect(data.priceWei).toBe("0");
  });
});

describe("emergency API", () => {
  it("is unavailable because worker environment controls the pause", async () => {
    const { POST } = await import("../app/api/emergency/route");
    const res = await POST();
    expect(res.status).toBe(501);
  });
});

describe("health API", () => {
  it("returns health details without an execution key", async () => {
    delete process.env.EXECUTION_PRIVATE_KEY;
    chainMock.getPublicClient.mockReturnValue({
      getBlockNumber: vi.fn().mockResolvedValue(123n),
      getGasPrice: vi.fn().mockResolvedValue(1_000_000_000n),
    });
    const { GET } = await import("../app/api/health/route");
    const res = await GET(req("http://test/api/health"));
    const data = await json(res);
    expect(res.status).toBe(200);
    expect(data.status).toBe("ok");
    expect(data.executionWalletAddress).toBeNull();
  });
});

describe("orders API", () => {
  it("filters order lists by owner and status", async () => {
    prismaMock.automatedOrder.findMany.mockResolvedValue([{ id: "order-1" }]);
    const { GET } = await import("../app/api/orders/route");
    const res = await GET(req(`http://test/api/orders?owner=${validOwner}&status=ARMED`));
    expect(res.status).toBe(200);
    expect(prismaMock.automatedOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerAddress: validOwner, status: "ARMED" },
    }));
  });

  it("creates a valid limit order and event", async () => {
    prismaMock.automatedOrder.create.mockResolvedValue({ id: "order-1" });
    const { POST } = await import("../app/api/orders/route");
    const res = await POST(req("http://test/api/orders", {
      ownerAddress: validOwner,
      tokenIn: validTokenIn,
      tokenOut: validTokenOut,
      amountIn: "100",
      triggerPrice: "1.25",
      triggerDirection: "gte",
      orderType: "LIMIT_BUY",
      maximumSlippageBps: 100,
      maximumPriceImpactBps: 100,
      deadlineSeconds: 300,
      signature: "0xsig",
      timestamp: 1,
    }));
    expect(res.status).toBe(200);
    expect(prismaMock.orderEvent.create).toHaveBeenCalled();
  });
});

describe("DCA orders API", () => {
  it("accepts the DCA form's configured risk limits", async () => {
    prismaMock.automatedOrder.create.mockResolvedValue({ id: "dca-order-1" });
    const { POST } = await import("../app/api/orders/dca/route");
    const res = await POST(req("http://test/api/orders/dca", {
      ownerAddress: validOwner,
      tokenIn: validTokenIn,
      tokenOut: validTokenOut,
      amountPerInterval: "100000000000000",
      totalAmount: "300000000000000",
      frequency: "MINUTELY",
      durationMonths: 1,
      startAt: "2026-07-23T13:26:00.000Z",
      dexAdapterId: "robinfun-v2",
      maximumSlippageBps: 500,
      maximumPriceImpactBps: 800,
      signature: "0xsig",
      timestamp: 1,
    }));

    expect(res.status).toBe(200);
    expect(prismaMock.automatedOrder.create).toHaveBeenCalled();
  });
});

describe("single order API", () => {
  it("returns 404 for a missing order", async () => {
    prismaMock.automatedOrder.findUnique.mockResolvedValue(null);
    const { GET } = await import("../app/api/orders/[id]/route");
    const res = await GET(req("http://test/api/orders/id"), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("pauses an armed order", async () => {
    prismaMock.automatedOrder.findUnique.mockResolvedValue({ id: "order-1", ownerAddress: validOwner, status: "ARMED" });
    prismaMock.automatedOrder.update.mockResolvedValue({ id: "order-1", status: "PAUSED" });
    const { PATCH } = await import("../app/api/orders/[id]/route");
    const res = await PATCH(req("http://test/api/orders/order-1", { action: "pause", signature: "0xsig", timestamp: 1 }) as NextRequest, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(200);
    expect(prismaMock.automatedOrder.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "PAUSED" } }));
  });

  it("rejects invalid status transitions", async () => {
    prismaMock.automatedOrder.findUnique.mockResolvedValue({ id: "order-1", ownerAddress: validOwner, status: "CONFIRMED" });
    const { PATCH } = await import("../app/api/orders/[id]/route");
    const res = await PATCH(req("http://test/api/orders/order-1", { action: "cancel", signature: "0xsig", timestamp: 1 }) as NextRequest, { params: Promise.resolve({ id: "order-1" }) });
    expect(res.status).toBe(400);
  });
});

describe("watchlist APIs", () => {
  it("lists watchlist entries with cached token metadata", async () => {
    prismaMock.watchlist.findMany.mockResolvedValue([{ id: "w1", tokenAddress: validTokenIn, chainId: 4663, createdAt: new Date(0) }]);
    prismaMock.tokenMetadata.findUnique.mockResolvedValue({ address: validTokenIn, symbol: "TOK" });
    const { GET } = await import("../app/api/watchlist/route");
    const res = await GET(req(`http://test/api/watchlist?owner=${validOwner}`));
    expect(res.status).toBe(200);
    expect((await json(res)).watchlist).toHaveLength(1);
  });

  it("rejects non-RobinFun token additions", async () => {
    dexMock.getTokenInfo.mockRejectedValue(new Error("not robinfun"));
    const { POST } = await import("../app/api/watchlist/route");
    const res = await POST(req("http://test/api/watchlist", {
      ownerAddress: validOwner,
      tokenAddress: validTokenIn,
      signature: "0xsig",
      timestamp: 1,
    }));
    expect(res.status).toBe(400);
  });

  it("deletes a watchlist entry", async () => {
    const { DELETE } = await import("../app/api/watchlist/[tokenAddress]/route");
    const res = await DELETE(new NextRequest(`http://test/api/watchlist/${validTokenIn}?owner=${validOwner}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signature: "0xsig", timestamp: 1 }),
    }), { params: Promise.resolve({ tokenAddress: validTokenIn }) });
    expect(res.status).toBe(200);
    expect(prismaMock.watchlist.deleteMany).toHaveBeenCalled();
  });
});

describe("tokens API", () => {
  it("returns a cached token by address", async () => {
    prismaMock.tokenMetadata.findUnique.mockResolvedValue({ address: validTokenIn, symbol: "TOK" });
    const { GET } = await import("../app/api/tokens/route");
    const res = await GET(req(`http://test/api/tokens?address=${validTokenIn}`));
    expect(res.status).toBe(200);
    expect((await json(res)).token).toMatchObject({ symbol: "TOK" });
  });

  it("lists RobinFun tokens from the database", async () => {
    prismaMock.tokenMetadata.findMany.mockResolvedValue([{ address: validTokenIn }]);
    const { GET } = await import("../app/api/tokens/route");
    const res = await GET(req("http://test/api/tokens"));
    expect(res.status).toBe(200);
    expect((await json(res)).tokens).toHaveLength(1);
  });
});

describe("activity API", () => {
  it("combines onchain and tracked activity", async () => {
    blockscoutMock.blockscoutGet.mockResolvedValue({
      items: [{ hash: "0xhash", block: 1, timestamp: "now", from: { hash: validOwner }, to: null, value: "0", status: "ok", gas_used: "1", method: null }],
    });
    prismaMock.trackedTransaction.findMany.mockResolvedValue([{ id: "tracked" }]);
    const { GET } = await import("../app/api/activity/route");
    const res = await GET(req(`http://test/api/activity?address=${validOwner}`));
    const data = await json(res);
    expect(res.status).toBe(200);
    expect(data.transactions).toHaveLength(1);
    expect(data.tracked).toHaveLength(1);
  });
});
