import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAddress, type Address } from "viem";
import { type Watchlist } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { getTokenInfo } from "@/src/lib/dex";
import { verifyAndConsumeAuthSignature } from "@/src/lib/security/authorization";
import { checkRateLimit, RATE_LIMITS } from "@/src/lib/security/rate-limit";

const addressSchema = z.string().refine((val) => isAddress(val), {
  message: "Invalid address",
});

const querySchema = z.object({
  owner: addressSchema,
});

const createWatchlistSchema = z.object({
  ownerAddress: addressSchema,
  tokenAddress: addressSchema,
  signature: z.string(),
  timestamp: z.number(),
});

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, { ...RATE_LIMITS.standard, bucket: "watchlist-get" });
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse({ owner: searchParams.get("owner") });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "owner query param must be a valid address" },
      { status: 400 }
    );
  }

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);

  try {
    const entries = await prisma.watchlist.findMany({
      where: { ownerAddress: parsed.data.owner.toLowerCase(), chainId },
      orderBy: { createdAt: "desc" },
    });

    const tokens = await Promise.all(
      entries.map(async (entry: Watchlist) => {
        const cached = await prisma.tokenMetadata.findUnique({
          where: { address: entry.tokenAddress },
        });
        return {
          watchlistId: entry.id,
          tokenAddress: entry.tokenAddress,
          chainId: entry.chainId,
          addedAt: entry.createdAt,
          token: cached,
        };
      })
    );

    return NextResponse.json({ watchlist: tokens });
  } catch (err) {
    console.error("Failed to load watchlist", err);
    return NextResponse.json(
      { error: "Unable to load watchlist" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, { ...RATE_LIMITS.mutation, bucket: "watchlist-post" });
  if (limited) return limited;

  try {
    const body = await req.json();
    const parsed = createWatchlistSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { ownerAddress, tokenAddress, signature, timestamp } = parsed.data;

    const auth = await verifyAndConsumeAuthSignature(
      "Add to Watchlist",
      ownerAddress,
      timestamp,
      { tokenAddress: tokenAddress.toLowerCase() },
      signature as `0x${string}`
    );
    if (!auth.valid) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);

    // Only RobinFun tokens may be watchlisted — reuses the same check enforced
    // for tokens surfaced in Markets/Trade.
    try {
      await getTokenInfo(tokenAddress as Address);
    } catch {
      return NextResponse.json(
        { error: "Token is not a RobinFun token" },
        { status: 400 }
      );
    }

    const entry = await prisma.watchlist.upsert({
      where: {
        ownerAddress_tokenAddress_chainId: {
          ownerAddress: ownerAddress.toLowerCase(),
          tokenAddress: tokenAddress.toLowerCase(),
          chainId,
        },
      },
      update: {},
      create: {
        ownerAddress: ownerAddress.toLowerCase(),
        tokenAddress: tokenAddress.toLowerCase(),
        chainId,
      },
    });

    return NextResponse.json({ entry });
  } catch (err) {
    console.error("Failed to update watchlist", err);
    return NextResponse.json(
      { error: "Unable to update watchlist" },
      { status: 500 }
    );
  }
}
