import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTokenInfo } from "@/src/lib/dex";
import { blockscoutGet } from "@/src/lib/blockscout/client";
import { prisma } from "@/src/lib/db";
import { type Address } from "viem";
import { checkRateLimit, RATE_LIMITS } from "@/src/lib/security/rate-limit";
import {
  getLivePriceEth,
  getPriceChanges24h,
} from "@/src/lib/market-price";
import { getBlockscoutTokenMarketData } from "@/src/lib/blockscout/market-data";

const querySchema = z.object({
  address: z.string().optional(),
  search: z.string().optional(),
  addresses: z.string().optional(),
});

type MarketToken = Awaited<ReturnType<typeof prisma.tokenMetadata.findFirst>>;

async function addLivePrices<T extends NonNullable<MarketToken>>(
  tokens: T[]
): Promise<
  Array<
    T & {
      priceEth: string | null;
      change24hPct: number | null;
      volume24hUsd: number | null;
    }
  >
> {
  const results: Array<
    T & { priceEth: string | null; volume24hUsd: number | null }
  > = [];
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
      const parsedVolume = Number(token.volume24hUsd);
      results[index] = {
        ...token,
        priceEth,
        volume24hUsd:
          token.volume24hUsd !== null &&
          token.volume24hUsd !== undefined &&
          Number.isFinite(parsedVolume) &&
          parsedVolume >= 0
            ? parsedVolume
            : null,
      };
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tokens.length) }, worker));
  const changes = await getPriceChanges24h(
    tokens,
    results.map((token) => token.priceEth)
  );
  return results.map((token, index) => ({
    ...token,
    change24hPct: changes[index] ?? null,
  }));
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
        const [enriched] = await addLivePrices([cached]);
        return NextResponse.json({
          token: enriched,
        });
      }

      const [token, indexedMarket] = await Promise.all([
        getTokenInfo(address as Address),
        getBlockscoutTokenMarketData(address).catch(() => null),
      ]);
      const volume24hUsd =
        indexedMarket?.volume24hUsd === null ||
        indexedMarket?.volume24hUsd === undefined
          ? undefined
          : String(indexedMarket.volume24hUsd);

      // Cache in DB
      const stored = await prisma.tokenMetadata.upsert({
        where: { address: token.address.toLowerCase() },
        update: {
          name: token.name,
          symbol: token.symbol,
          decimals: token.decimals,
          creator: token.creator,
          isRobinFun: token.isRobinFun,
          dexLive: token.dexLive,
          pairAddress: token.pairAddress,
          volume24hUsd,
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
          volume24hUsd,
        },
      });

      const [enriched] = await addLivePrices([stored]);
      return NextResponse.json({
        token: enriched,
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
      // Discovery refreshes many records at nearly the same time, so
      // lastUpdated alone makes the first page unstable. Keep graduated
      // tokens visible, then use a deterministic address tie-breaker.
      orderBy: [
        { dexLive: "desc" },
        { lastUpdated: "desc" },
        { address: "asc" },
      ],
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
