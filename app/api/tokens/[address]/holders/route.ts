import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { formatUnits } from "viem";
import { prisma } from "@/src/lib/db";
import {
  getBlockscoutTokenHolders,
  getBlockscoutTokenMarketData,
} from "@/src/lib/blockscout/market-data";
import { checkRateLimit, RATE_LIMITS } from "@/src/lib/security/rate-limit";

const paramsSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ address: string }> }
) {
  const limited = checkRateLimit(req, {
    ...RATE_LIMITS.onchainRead,
    bucket: "token-holders",
  });
  if (limited) return limited;

  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid token address" }, { status: 400 });
  }

  const address = parsed.data.address.toLowerCase();

  try {
    const metadata = await prisma.tokenMetadata.findUnique({ where: { address } });
    if (!metadata?.isRobinFun) {
      return NextResponse.json({ error: "Token is not a RobinFun token" }, { status: 404 });
    }

    const [market, indexedHolders] = await Promise.all([
      getBlockscoutTokenMarketData(address),
      getBlockscoutTokenHolders(address, 20),
    ]);
    const totalSupplyRaw = market.totalSupplyRaw ?? metadata.totalSupply;
    const decimals = metadata.decimals;

    const holders = indexedHolders.map((holder) => {
      const balance = formatUnits(BigInt(holder.balanceRaw), decimals);
      const sharePct =
        totalSupplyRaw && BigInt(totalSupplyRaw) > 0n
          ? Number((BigInt(holder.balanceRaw) * 1_000_000n) / BigInt(totalSupplyRaw)) /
            10_000
          : null;
      return {
        address: holder.address,
        name: holder.name,
        balance,
        sharePct,
      };
    });

    return NextResponse.json({
      token: address,
      holdersCount: market.holdersCount,
      totalSupplyTokens: totalSupplyRaw
        ? formatUnits(BigInt(totalSupplyRaw), decimals)
        : null,
      holders,
      source: "Blockscout",
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load token holders",
      },
      { status: 502 }
    );
  }
}
