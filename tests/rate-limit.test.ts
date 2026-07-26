import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { checkRateLimit } from "@/src/lib/security/rate-limit";

function request(forwardedFor: string) {
  return new NextRequest("http://test/api/example", {
    headers: { "x-forwarded-for": forwardedFor },
  });
}

afterEach(() => {
  delete process.env.TRUST_PROXY_HEADERS;
});

describe("rate-limit client identity", () => {
  it("ignores caller-supplied proxy headers by default", () => {
    process.env.TRUST_PROXY_HEADERS = "false";
    const bucket = `direct-${Date.now()}-${Math.random()}`;

    expect(
      checkRateLimit(request("198.51.100.1"), {
        bucket,
        limit: 1,
        windowMs: 60_000,
      })
    ).toBeNull();
    expect(
      checkRateLimit(request("198.51.100.2"), {
        bucket,
        limit: 1,
        windowMs: 60_000,
      })?.status
    ).toBe(429);
  });

  it("uses proxy headers only after explicit opt-in", () => {
    process.env.TRUST_PROXY_HEADERS = "true";
    const bucket = `proxy-${Date.now()}-${Math.random()}`;

    expect(
      checkRateLimit(request("198.51.100.1"), {
        bucket,
        limit: 1,
        windowMs: 60_000,
      })
    ).toBeNull();
    expect(
      checkRateLimit(request("198.51.100.2"), {
        bucket,
        limit: 1,
        windowMs: 60_000,
      })
    ).toBeNull();
  });
});
