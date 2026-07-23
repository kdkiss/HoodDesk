import { NextRequest, NextResponse } from "next/server";

/**
 * Simple in-memory sliding-window rate limiter keyed by client IP.
 *
 * This is intentionally minimal: HoodDesk is self-hosted as a single Node
 * process (no horizontal scaling, no external cache), so a Map-based
 * per-process limiter is sufficient as a safety guard. It is NOT suitable
 * for multi-instance deployments — if HoodDesk is ever scaled horizontally,
 * replace this with a shared store (e.g. Redis).
 */

interface RateLimitOptions {
  /** Max requests allowed within the window. */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
  /** Optional identifier prefix so different routes don't share buckets. */
  bucket?: string;
}

interface WindowState {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, WindowState>();

// Periodically sweep stale entries so the Map doesn't grow unbounded.
const SWEEP_INTERVAL_MS = 5 * 60_000;
let lastSweep = Date.now();

function sweepIfNeeded(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, state] of buckets) {
    // A window is stale if it's more than 10 windows old-ish; use a generous
    // fixed cutoff since we don't track windowMs per key here.
    if (now - state.windowStart > SWEEP_INTERVAL_MS) {
      buckets.delete(key);
    }
  }
}

/**
 * Extracts a best-effort client identifier from the request. Falls back to
 * a shared generic key if no IP-revealing headers are present (e.g. running
 * with no reverse proxy in front) so the limiter never throws.
 */
function getClientKey(req: NextRequest): string {
  try {
    const forwardedFor = req.headers.get("x-forwarded-for");
    if (forwardedFor) {
      const first = forwardedFor.split(",")[0]?.trim();
      if (first) return first;
    }
    const realIp = req.headers.get("x-real-ip");
    if (realIp) return realIp.trim();
  } catch {
    // headers unavailable for some reason — fall through to generic key
  }
  return "unknown";
}

/**
 * Checks and records a request against the rate limit for the caller's IP.
 * Returns a NextResponse (429) if the limit has been exceeded, or `null`
 * if the request is allowed and should proceed.
 *
 * Usage:
 *   const limited = checkRateLimit(req, { limit: 60, windowMs: 60_000 });
 *   if (limited) return limited;
 */
export function checkRateLimit(
  req: NextRequest,
  options: RateLimitOptions
): NextResponse | null {
  const { limit, windowMs, bucket = "default" } = options;
  const now = Date.now();
  sweepIfNeeded(now);

  const clientKey = getClientKey(req);
  const key = `${bucket}:${clientKey}`;

  const state = buckets.get(key);

  if (!state || now - state.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return null;
  }

  if (state.count < limit) {
    state.count += 1;
    return null;
  }

  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((state.windowStart + windowMs - now) / 1000)
  );

  return NextResponse.json(
    {
      error: "Too many requests",
      message: `Rate limit exceeded. Try again in ${retryAfterSeconds}s.`,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
      },
    }
  );
}

/** Common presets so callers stay consistent. */
export const RATE_LIMITS = {
  /** Default for general read-only endpoints. */
  standard: { limit: 60, windowMs: 60_000 },
  /** Onchain-read-heavy endpoints (quote, curve, portfolio, activity). */
  onchainRead: { limit: 30, windowMs: 60_000 },
  /** Endpoints that create/mutate automated orders. */
  mutation: { limit: 15, windowMs: 60_000 },
  /** Emergency pause toggle — very tight. */
  emergency: { limit: 5, windowMs: 60_000 },
} as const satisfies Record<string, Omit<RateLimitOptions, "bucket">>;
