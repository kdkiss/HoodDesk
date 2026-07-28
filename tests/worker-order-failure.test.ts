import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  automatedOrder: {
    update: vi.fn(),
  },
  orderEvent: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("@/src/lib/db", () => ({ prisma: prismaMock }));

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.orderEvent.findFirst.mockResolvedValue(null);
});
describe("handleOrderProcessingError", () => {
  it("preserves order state after the transient RPC failure from the incident", async () => {
    const { handleOrderProcessingError } = await import("../worker/order-failure");
    const error = new Error("HTTP request failed.", {
      cause: new TypeError("fetch failed"),
    });

    await expect(
      handleOrderProcessingError("order-1", error, new Date("2026-07-27T12:00:00Z"))
    ).resolves.toBe("deferred");

    expect(prismaMock.automatedOrder.update).not.toHaveBeenCalled();
    expect(prismaMock.orderEvent.create).toHaveBeenCalledWith({
      data: {
        orderId: "order-1",
        eventType: "RPC_DEFERRED",
        message: "Order processing deferred after a temporary RPC failure; existing state preserved",
      },
    });
  });

  it("preserves order state when the RPC head state is temporarily unavailable", async () => {
    const { handleOrderProcessingError } = await import("../worker/order-failure");
    const providerError = Object.assign(
      new Error("missing trie node; state is not available"),
      { code: -32000 }
    );
    const error = new Error("Missing or invalid parameters.", {
      cause: providerError,
    });

    await expect(
      handleOrderProcessingError("order-head-state", error)
    ).resolves.toBe("deferred");

    expect(prismaMock.automatedOrder.update).not.toHaveBeenCalled();
    expect(prismaMock.orderEvent.create).toHaveBeenCalledWith({
      data: {
        orderId: "order-head-state",
        eventType: "RPC_DEFERRED",
        message: "Order processing deferred after a temporary RPC failure; existing state preserved",
      },
    });
  });

  it("throttles repeated RPC deferral events while preserving state", async () => {
    const { handleOrderProcessingError } = await import("../worker/order-failure");
    prismaMock.orderEvent.findFirst.mockResolvedValue({
      eventType: "RPC_DEFERRED",
      createdAt: new Date("2026-07-27T11:58:00Z"),
    });

    await expect(
      handleOrderProcessingError(
        "order-1",
        new Error("network timeout"),
        new Date("2026-07-27T12:00:00Z")
      )
    ).resolves.toBe("deferred");

    expect(prismaMock.automatedOrder.update).not.toHaveBeenCalled();
    expect(prismaMock.orderEvent.create).not.toHaveBeenCalled();
  });

  it("keeps deterministic safety failures terminal and records a sanitized reason", async () => {
    const { handleOrderProcessingError } = await import("../worker/order-failure");

    await expect(
      handleOrderProcessingError(
        "order-2",
        new Error("Order exceeds maximum slippage at https://provider.example/v2/secret-key")
      )
    ).resolves.toBe("failed");

    const sanitizedReason =
      "Order exceeds maximum slippage at [redacted URL]";
    expect(prismaMock.automatedOrder.update).toHaveBeenCalledWith({
      where: { id: "order-2" },
      data: {
        status: "FAILED",
        failureReason: sanitizedReason,
      },
    });
    expect(prismaMock.orderEvent.create).toHaveBeenCalledWith({
      data: {
        orderId: "order-2",
        eventType: "FAILED",
        message: `Order failed: ${sanitizedReason}`,
      },
    });
  });
});
