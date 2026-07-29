import { describe, expect, it, vi } from "vitest";
import { isTransientRpcError, retryRpcRead } from "@/src/lib/chain/retry";

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

describe("isTransientRpcError", () => {
  it("detects a transport failure wrapped by Viem", () => {
    const socketError = Object.assign(new Error("other side closed"), {
      code: "UND_ERR_SOCKET",
    });
    const fetchError = new TypeError("fetch failed", { cause: socketError });
    const viemError = new Error("HTTP request failed.", { cause: fetchError });

    expect(isTransientRpcError(viemError)).toBe(true);
  });

  it("detects unavailable block state hidden under a generic RPC message", () => {
    const providerError = Object.assign(
      new Error("metadata is not found, 21017729"),
      { code: -32000 }
    );
    const rpcError = new Error("RPC Request failed.", { cause: providerError });
    const viemError = new Error("Missing or invalid parameters.", {
      cause: rpcError,
    });

    expect(isTransientRpcError(viemError)).toBe(true);
  });

  it("keeps genuinely invalid parameters deterministic", () => {
    expect(isTransientRpcError(new Error("Missing or invalid parameters."))).toBe(false);
  });

  it("detects a Viem TimeoutError by its message text", () => {
    const timeoutError = new Error("The request took too long to respond.");

    expect(isTransientRpcError(timeoutError)).toBe(true);
  });
});
