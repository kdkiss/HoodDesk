import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { type Address, formatEther, formatUnits } from "viem";
import { getPublicClient } from "@/src/lib/chain/client";
import { checkRateLimit, RATE_LIMITS } from "@/src/lib/security/rate-limit";
import { ROBINFUN_FACTORY_ABI } from "@/src/lib/dex/abi/robinfun-factory";
import { ROBINFUN_FACTORIES, WETH } from "@/src/config/contracts";
import { curveAdapter, v2Adapter } from "@/src/lib/dex";
import { prisma } from "@/src/lib/db";
import {
  getBlockscoutEthUsd,
  getBlockscoutTokenMarketData,
  getBlockscoutV2SwapHistory,
} from "@/src/lib/blockscout/market-data";
import { retryRpcRead } from "@/src/lib/chain/retry";
import { mapWithConcurrency } from "@/src/lib/async/map-with-concurrency";
import {
  bucketIntoCandles,
  scaleCandles,
  type PricePoint,
} from "@/src/lib/chart/candles";
import {
  CHART_RESOLUTION_IDS,
  CHART_TIMEFRAME_IDS,
  DEFAULT_CHART_RESOLUTION,
  DEFAULT_CHART_TIMEFRAME,
  chartResolutionConfig,
  chartTimeframeConfig,
} from "@/src/lib/chart/timeframes";

const querySchema = z.object({
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  timeframe: z.enum(CHART_TIMEFRAME_IDS).default(DEFAULT_CHART_TIMEFRAME),
  resolution: z.enum(CHART_RESOLUTION_IDS).default(DEFAULT_CHART_RESOLUTION),
});

// Measured directly against Robinhood Chain mainnet (50,000-block sample,
// eth_getBlock timestamp delta): ~0.1s/block. Used only to bound the
// fromBlock lookback window for RPC performance — never to fabricate price
// data, only real decoded swap events are used to build candles. Rounded
// down slightly (0.12s) so the window is a bit wider than a pure average,
// covering minor block-time variance without under-fetching.
const ESTIMATED_BLOCK_TIME_SECONDS = 0.1;

// Hard cap on how many blocks we'll scan. Keeps RPC queries fast even for
// long time ranges. 200K blocks ≈ ~5.5 hours at 0.1s/block.
const MAX_LOOKBACK_BLOCKS = 200_000n;

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, { ...RATE_LIMITS.onchainRead, bucket: "candles" });
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
  }

  const token = parsed.data.token as Address;
  const timeframe = parsed.data.timeframe;
  const resolution = parsed.data.resolution;
  const lookbackSeconds = chartTimeframeConfig(timeframe).lookbackSeconds;
  const bucketSeconds = chartResolutionConfig(resolution).bucketSeconds;

  try {
    const client = getPublicClient();
    const metadata = await prisma.tokenMetadata.findUnique({
      where: { address: token.toLowerCase() },
    });
    const isRobinFun = metadata?.isRobinFun ?? (await curveAdapter.isRobinFunToken(token));
    if (!isRobinFun) {
      return NextResponse.json({ error: "Token is not a RobinFun token" }, { status: 404 });
    }

    const graduated = metadata?.dexLive ?? (await curveAdapter.isGraduated(token));

    let pricePoints: PricePoint[] = [];
    let truncated = false;
    let source: "blockscout" | "rpc";

    if (graduated) {
      source = "blockscout";
      const pair =
        metadata?.pairAddress ??
        (await retryRpcRead(() => v2Adapter.getTokenInfo(token))).pairAddress;
      if (pair) {
        const result = await fetchGraduatedPricePoints(
          token,
          pair as Address,
          Math.floor(Date.now() / 1000) - lookbackSeconds
        );
        pricePoints = result.points;
        truncated = result.truncated;
      }
    } else {
      source = "rpc";
      const latestBlock = await retryRpcRead(() => client.getBlockNumber());
      const lookbackBlocks = BigInt(
        Math.ceil(lookbackSeconds / ESTIMATED_BLOCK_TIME_SECONDS)
      );
      const cappedLookback =
        lookbackBlocks > MAX_LOOKBACK_BLOCKS ? MAX_LOOKBACK_BLOCKS : lookbackBlocks;
      const fromBlock = latestBlock > cappedLookback ? latestBlock - cappedLookback : 0n;
      pricePoints = await fetchCurvePricePoints(client, token, fromBlock, latestBlock);
      truncated = lookbackBlocks > MAX_LOOKBACK_BLOCKS;
    }

    if (pricePoints.length === 0) {
      return NextResponse.json({
        token,
        timeframe,
        resolution,
        graduated,
        candles: [],
        insufficientData: true,
        bucketSeconds,
        observedCandles: 0,
        source,
        truncated,
        message: "Historical chart data is not yet available for this market.",
      });
    }

    const [indexedMarket, ethUsd] = await Promise.all([
      getBlockscoutTokenMarketData(token).catch(() => null),
      getBlockscoutEthUsd().catch(() => null),
    ]);
    const supplyRaw = metadata?.totalSupply ?? indexedMarket?.totalSupplyRaw ?? null;
    const decimals = metadata?.decimals ?? 18;
    const totalSupplyTokens =
      supplyRaw === null ? null : Number(formatUnits(BigInt(supplyRaw), decimals));
    const canShowMarketCap =
      totalSupplyTokens !== null &&
      Number.isFinite(totalSupplyTokens) &&
      totalSupplyTokens > 0;
    const canShowUsdMarketCap =
      canShowMarketCap &&
      ethUsd !== null &&
      Number.isFinite(ethUsd) &&
      ethUsd > 0;
    const multiplier = canShowUsdMarketCap
      ? totalSupplyTokens * ethUsd
      : canShowMarketCap
        ? totalSupplyTokens
        : 1;
    const observedCandles = bucketIntoCandles(pricePoints, bucketSeconds);
    const scaledCandles = scaleCandles(observedCandles, multiplier);
    const candles = scaledCandles;
    const metric = canShowUsdMarketCap
      ? "marketCapUsd"
      : canShowMarketCap
        ? "marketCapEth"
        : "priceEth";

    // Only "no real trades at all in the window" counts as unavailable. A
    // market with a single trade still has a real onchain price point — show
    // it as a single candle rather than fabricating an empty state.
    if (candles.length === 0) {
      return NextResponse.json({
        token,
        timeframe,
        resolution,
        graduated,
        candles: [],
        insufficientData: true,
        message: "Historical chart data is not yet available for this market.",
        bucketSeconds,
        observedCandles: 0,
        source,
        truncated,
      });
    }

    return NextResponse.json({
      token,
      timeframe,
      resolution,
      graduated,
      candles,
      insufficientData: false,
      metric,
      unit: canShowUsdMarketCap ? "USD" : "ETH",
      totalSupplyTokens: canShowMarketCap ? totalSupplyTokens : null,
      ethUsd: canShowUsdMarketCap ? ethUsd : null,
      bucketSeconds,
      observedCandles: observedCandles.length,
      source,
      truncated,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

async function blockTimestamp(
  client: ReturnType<typeof getPublicClient>,
  blockNumber: bigint,
  cache: Map<bigint, number>
): Promise<number> {
  const cached = cache.get(blockNumber);
  if (cached !== undefined) return cached;
  const block = await retryRpcRead(() => client.getBlock({ blockNumber }));
  const ts = Number(block.timestamp);
  cache.set(blockNumber, ts);
  return ts;
}

/**
 * Resolve the factory contract that actually manages this token's curve.
 * TokenDiscovery stores the creating factory per token; trades/price events
 * are emitted by THAT contract, not necessarily the newest (V5) factory.
 * Falls back to V5 for tokens not yet in the DB.
 */
async function resolveCurveFactory(token: Address): Promise<Address> {
  const meta = await prisma.tokenMetadata.findUnique({
    where: { address: token.toLowerCase() },
  });
  if (meta?.factoryAddress) {
    const known = ROBINFUN_FACTORIES.find(
      (f) => f.toLowerCase() === meta.factoryAddress!.toLowerCase()
    );
    if (known) return known;
  }
  return ROBINFUN_FACTORIES[0];
}

async function fetchCurvePricePoints(
  client: ReturnType<typeof getPublicClient>,
  token: Address,
  fromBlock: bigint,
  toBlock: bigint
): Promise<PricePoint[]> {
  const factory = await resolveCurveFactory(token);

  const [buyLogs, sellLogs] = await retryRpcRead(() =>
    Promise.all([
      client.getLogs({
        address: factory,
        event: ROBINFUN_FACTORY_ABI.find((e) => e.type === "event" && e.name === "Buy")!,
        args: { token },
        fromBlock,
        toBlock,
      }),
      client.getLogs({
        address: factory,
        event: ROBINFUN_FACTORY_ABI.find((e) => e.type === "event" && e.name === "Sell")!,
        args: { token },
        fromBlock,
        toBlock,
      }),
    ])
  );

  const allLogs = [...buyLogs, ...sellLogs].sort((a, b) => {
    if (a.blockNumber === b.blockNumber) {
      return Number(a.logIndex ?? 0) - Number(b.logIndex ?? 0);
    }
    return a.blockNumber! < b.blockNumber! ? -1 : 1;
  });

  const tsCache = new Map<bigint, number>();

  // Pre-fetch all unique block timestamps in parallel
  const uniqueBlocks = [...new Set(allLogs.map((l) => l.blockNumber!))];
  await mapWithConcurrency(uniqueBlocks, 8, (blockNumber) =>
    blockTimestamp(client, blockNumber, tsCache)
  );

  const points: PricePoint[] = [];

  for (const log of allLogs) {
    const args = (log as unknown as { args: Record<string, unknown> }).args;
    const blockNumber = log.blockNumber!;
    const timestamp = tsCache.get(blockNumber)!;

    const isBuy = "buyer" in args;
    const ethAmount = (isBuy ? args.ethIn : args.ethOut) as bigint;
    const tokenAmount = (isBuy ? args.tokensOut : args.tokensIn) as bigint;
    const priceWeiPerToken = args.newPriceWeiPerToken as bigint | undefined;

    if (tokenAmount === 0n) continue;

    const price = priceWeiPerToken
      ? Number(formatEther(priceWeiPerToken))
      : Number(formatEther(ethAmount)) / Number(formatEther(tokenAmount));

    points.push({
      timestamp,
      price,
      volumeEth: Number(formatEther(ethAmount)),
    });
  }

  return points.sort((a, b) => a.timestamp - b.timestamp);
}

async function fetchGraduatedPricePoints(
  token: Address,
  pair: Address,
  sinceTimestamp: number
): Promise<{ points: PricePoint[]; truncated: boolean }> {
  const pairTokens = await v2Adapter.getPairTokens(pair);
  const tokenIsToken0 = pairTokens.token0.toLowerCase() === token.toLowerCase();
  const wethIsToken0 = pairTokens.token0.toLowerCase() === WETH.toLowerCase();

  if (!tokenIsToken0 && pairTokens.token1.toLowerCase() !== token.toLowerCase()) {
    return { points: [], truncated: false };
  }

  const result = await getBlockscoutV2SwapHistory(pair, {
    sinceTimestamp,
    limit: 10_000,
  });

  const points: PricePoint[] = [];

  for (const swap of result.swaps) {
    const {
      amount0In,
      amount1In,
      amount0Out,
      amount1Out,
    } = swap;

    let ethAmount: bigint;
    let tokenAmount: bigint;

    if (wethIsToken0) {
      ethAmount = amount0In > 0n ? amount0In : amount0Out;
      tokenAmount = amount1In > 0n ? amount1In : amount1Out;
    } else {
      ethAmount = amount1In > 0n ? amount1In : amount1Out;
      tokenAmount = amount0In > 0n ? amount0In : amount0Out;
    }

    if (tokenAmount === 0n || ethAmount === 0n) continue;

    const price = Number(formatEther(ethAmount)) / Number(formatEther(tokenAmount));

    points.push({
      timestamp: swap.timestamp,
      price,
      volumeEth: Number(formatEther(ethAmount)),
    });
  }

  return {
    points: points.sort((a, b) => a.timestamp - b.timestamp),
    truncated: result.truncated,
  };
}
