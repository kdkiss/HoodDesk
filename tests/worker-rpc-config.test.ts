import { describe, expect, it } from "vitest";
import {
  resolveWorkerRpcUrl,
  RPC_READ_TRANSPORT_OPTIONS,
  RPC_WRITE_TRANSPORT_OPTIONS,
} from "../worker/rpc-config";

describe("resolveWorkerRpcUrl", () => {
  it("uses the configured server-side RPC URL", () => {
    expect(
      resolveWorkerRpcUrl(
        "https://public-rpc.example",
        " https://dedicated-rpc.example/v2/key "
      )
    ).toBe("https://dedicated-rpc.example/v2/key");
  });

  it("falls back to the chain RPC when no override is configured", () => {
    expect(resolveWorkerRpcUrl("https://public-rpc.example", "")).toBe(
      "https://public-rpc.example"
    );
  });

  it("rejects unsupported RPC protocols", () => {
    expect(() =>
      resolveWorkerRpcUrl("https://public-rpc.example", "file:///tmp/rpc")
    ).toThrow("RPC URL must use HTTP or HTTPS");
  });

  it("retries reads but never retries transaction submission", () => {
    expect(RPC_READ_TRANSPORT_OPTIONS.retryCount).toBeGreaterThan(0);
    expect(RPC_WRITE_TRANSPORT_OPTIONS.retryCount).toBe(0);
  });
});
