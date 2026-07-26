import { describe, expect, it } from "vitest";
import { parseRetryAfter } from "@/src/lib/blockscout/client";

describe("Blockscout client", () => {
  it("parses Retry-After seconds", () => {
    expect(parseRetryAfter("3", 0)).toBe(3_000);
  });

  it("parses Retry-After dates", () => {
    expect(
      parseRetryAfter("Thu, 01 Jan 1970 00:00:05 GMT", 1_000)
    ).toBe(4_000);
  });

  it("ignores invalid Retry-After values", () => {
    expect(parseRetryAfter("later", 0)).toBeNull();
  });
});
