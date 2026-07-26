import { describe, expect, it, vi } from "vitest";
import { retryRpcRead } from "@/src/lib/chain/retry";

describe("retryRpcRead", () => {
  it("retries transient read failures and returns the successful value", async () => {
    const operation = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error("HTTP 503 temporary RPC response"))
      .mockResolvedValue(42);

    await expect(
      retryRpcRead(operation, { attempts: 2, delayMs: 0 })
    ).resolves.toBe(42);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("rethrows after the configured attempts", async () => {
    const operation = vi
      .fn<() => Promise<number>>()
      .mockRejectedValue(new Error("network down"));

    await expect(
      retryRpcRead(operation, { attempts: 2, delayMs: 0 })
    ).rejects.toThrow("down");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry deterministic contract failures", async () => {
    const operation = vi
      .fn<() => Promise<number>>()
      .mockRejectedValue(new Error("execution reverted"));

    await expect(
      retryRpcRead(operation, { attempts: 3, delayMs: 0 })
    ).rejects.toThrow("execution reverted");
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
