import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTokenInfo } from "@/src/lib/dex";
import { blockscoutGet } from "@/src/lib/blockscout/client";
import { prisma } from "@/src/lib/db";
import { type Address } from "viem";
import { checkRateLimit, RATE_LIMITS } from "@/src/lib/security/rate-limit";
import { getLivePriceEth } from "@/src/lib/market-price";

const querySchema = z.object({
  address: z.string().optional(),
  search: z.string().optional(),
  addresses: z.string().optional(),
});

type MarketToken = Awaited<ReturnType<typeof prisma.tokenMetadata.findFirst>>;

async function addLivePrices<T extends NonNullable<MarketToken>>(tokens: T[]): Promise<Array<T & { priceEth: string | null }>> {
  const results: Array<T & { priceEth: string | null }> = [];
  const concurrency = 8;
  let cursor = 0;

  async function worker() {
    while (cursor < tokens.length) {
      const index = cursor++;
      const token = tokens[index];
      const priceEth = await getLivePriceEth(
        token.address as Address,
        token.dexLive,
        token.pairAddress
      );
      results[index] = { ...token, priceEth };
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tokens.length) }, worker));
  return results;
}

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, { ...RATE_LIMITS.standard, bucket: "tokens" });
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query" }, { status: 400 });
  }

  const { address, search, addresses } = parsed.data;
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);

  try {
    if (address) {
      // Check DB cache first
      const cached = await prisma.tokenMetadata.findUnique({
        where: { address: address.toLowerCase() },
      });
      if (cached) {
        return NextResponse.json({
          token: {
            ...cached,
            priceEth: await getLivePriceEth(cached.address as Address, cached.dexLive, cached.pairAddress),
          },
        });
      }

      const token = await getTokenInfo(address as Address);

      // Cache in DB
      await prisma.tokenMetadata.upsert({
        where: { address: token.address.toLowerCase() },
        update: {
          name: token.name,
          symbol: token.symbol,
          decimals: token.decimals,
          creator: token.creator,
          isRobinFun: token.isRobinFun,
          dexLive: token.dexLive,
          pairAddress: token.pairAddress,
        },
        create: {
          address: token.address.toLowerCase(),
          chainId,
          name: token.name,
          symbol: token.symbol,
          decimals: token.decimals,
          creator: token.creator,
          isRobinFun: token.isRobinFun,
          dexLive: token.dexLive,
          pairAddress: token.pairAddress,
        },
      });

      return NextResponse.json({
        token: {
          ...token,
          priceEth: await getLivePriceEth(token.address as Address, token.dexLive, token.pairAddress),
        },
      });
    }

    if (search) {
      // Search via Blockscout PRO
      const result = await blockscoutGet<{
        items: Array<{
          address_hash: string;
          name: string;
          symbol: string;
          decimals: string;
          holders_count: string;
          exchange_rate: string | null;
        }>;
      }>("/tokens", { q: search, type: "ERC-20" });

      return NextResponse.json({ tokens: result.items });
    }

    if (addresses) {
      const requested = [...new Set(addresses.split(",").map((value) => value.trim().toLowerCase()))];
      if (
        requested.length === 0 ||
        requested.length > 50 ||
        requested.some((value) => !/^0x[a-f0-9]{40}$/.test(value))
      ) {
        return NextResponse.json({ error: "Invalid token addresses" }, { status: 400 });
      }
      const tokens = await prisma.tokenMetadata.findMany({
        where: { chainId, address: { in: requested } },
      });
      return NextResponse.json({ tokens: await addLivePrices(tokens) });
    }

    // List all RobinFun tokens from DB
    const tokens = await prisma.tokenMetadata.findMany({
      where: { chainId, isRobinFun: true },
      orderBy: { lastUpdated: "desc" },
      take: 100,
    });

    return NextResponse.json({ tokens: await addLivePrices(tokens) });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
