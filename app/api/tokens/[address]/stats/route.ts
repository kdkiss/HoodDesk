import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { type Address, formatEther, formatUnits } from "viem";
import { checkRateLimit, RATE_LIMITS } from "@/src/lib/security/rate-limit";
import { ROBINFUN_FACTORIES, WETH } from "@/src/config/contracts";
import { curveAdapter, v2Adapter } from "@/src/lib/dex";
import { prisma } from "@/src/lib/db";
import {
  getBlockscoutEthUsd,
  getBlockscoutTokenMarketData,
} from "@/src/lib/blockscout/market-data";
import { retryRpcRead } from "@/src/lib/chain/retry";
import { getPriceChanges24h } from "@/src/lib/market-price";

const paramsSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ address: string }> }
) {
  const limited = checkRateLimit(req, { ...RATE_LIMITS.onchainRead, bucket: "token-stats" });
  if (limited) return limited;

  const params = paramsSchema.safeParse(await context.params);
  if (!params.success) {
    return NextResponse.json({ error: "Invalid token address" }, { status: 400 });
  }
  const token = params.data.address as Address;

  try {
    const meta = await prisma.tokenMetadata.findUnique({
      where: { address: token.toLowerCase() },
    });

    const [isRobinFun, curve, indexedMarket, ethUsd] = await Promise.all([
      meta?.isRobinFun ?? curveAdapter.isRobinFunToken(token),
      retryRpcRead(() => curveAdapter.getCurveState(token)),
      getBlockscoutTokenMarketData(token).catch(() => null),
      getBlockscoutEthUsd().catch(() => null),
    ]);
    if (!isRobinFun) {
      return NextResponse.json({ error: "Token is not a RobinFun token" }, { status: 404 });
    }

    const graduated = curve.graduated;

    // --- Current price ---
    let priceEth: bigint;
    let liquidityEth: bigint; // curve realEth, or pair WETH reserve
    let pairAddress: Address | null = null;
    if (graduated) {
      pairAddress =
        (meta?.pairAddress as Address | null) ??
        (await retryRpcRead(() => v2Adapter.getTokenInfo(token))).pairAddress!;
      const reserves = await v2Adapter.getPairReserves(pairAddress);
      const wethIsToken0 = reserves.token0.toLowerCase() === WETH.toLowerCase();
      const wethReserve = wethIsToken0 ? reserves.reserve0 : reserves.reserve1;
      const tokenReserve = wethIsToken0 ? reserves.reserve1 : reserves.reserve0;
      liquidityEth = wethReserve;
      priceEth = tokenReserve > 0n ? (wethReserve * 10n ** 18n) / tokenReserve : 0n;
    } else {
      priceEth = await curveAdapter.getCurrentPrice(token).catch(() => 0n);
      liquidityEth = curve.realEth;
    }

    // --- Market cap / holders ---
    const totalSupplyRaw = meta?.totalSupply ?? indexedMarket?.totalSupplyRaw ?? null;
    const totalSupply = totalSupplyRaw ? BigInt(totalSupplyRaw) : null;
    const decimals = meta?.decimals ?? 18;
    const [change24hPct] = await getPriceChanges24h(
      [{
        address: token,
        decimals,
        dexLive: graduated,
        pairAddress,
        factoryAddress: meta?.factoryAddress ?? ROBINFUN_FACTORIES[0],
      }],
      [formatEther(priceEth)]
    );
    const totalSupplyTokens =
      totalSupply !== null ? formatUnits(totalSupply, decimals) : null;
    const marketCapEth =
      totalSupply !== null
        ? Number(formatEther(priceEth)) * Number(totalSupplyTokens)
        : null;
    const priceEthNumber = Number(formatEther(priceEth));
    const liquidityEthNumber = Number(formatEther(liquidityEth));
    const priceUsd = ethUsd === null ? indexedMarket?.priceUsd ?? null : priceEthNumber * ethUsd;
    const marketCapUsd =
      marketCapEth === null
        ? indexedMarket?.marketCapUsd ?? null
        : ethUsd === null
          ? indexedMarket?.marketCapUsd ?? null
          : marketCapEth * ethUsd;

    return NextResponse.json({
      token,
      graduated,
      priceEth: formatEther(priceEth),
      priceUsd,
      ethUsd,
      change24hPct,
      liquidityEth: formatEther(liquidityEth),
      liquidityUsd: ethUsd === null ? null : liquidityEthNumber * ethUsd,
      marketCapEth,
      marketCapUsd,
      holdersCount: indexedMarket?.holdersCount ?? meta?.holdersCount ?? null,
      totalSupply: totalSupply?.toString() ?? null,
      totalSupplyTokens,
      decimals,
      marketDataSource: indexedMarket || ethUsd !== null ? "Blockscout" : null,
      curve: graduated
        ? null
        : {
            realEth: formatEther(curve.realEth),
            raiseTarget: formatEther(curve.raiseTarget),
            progressPct:
              curve.raiseTarget > 0n
                ? Number((curve.realEth * 10000n) / curve.raiseTarget) / 100
                : 0,
          },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
