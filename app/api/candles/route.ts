import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { type Address, formatEther } from "viem";
import { getPublicClient } from "@/src/lib/chain/client";
import { checkRateLimit, RATE_LIMITS } from "@/src/lib/security/rate-limit";
import { ROBINFUN_FACTORY_ABI } from "@/src/lib/dex/abi/robinfun-factory";
import { ROBINFUN_FACTORIES, WETH } from "@/src/config/contracts";
import { curveAdapter, v2Adapter } from "@/src/lib/dex";
import { prisma } from "@/src/lib/db";

// Uniswap V2 pair Swap event — minimal ABI slice needed for log decoding.
const V2_PAIR_ABI = [
  {
    type: "event",
    name: "Swap",
    inputs: [
      { name: "sender", type: "address", indexed: true },
      { name: "amount0In", type: "uint256", indexed: false },
      { name: "amount1In", type: "uint256", indexed: false },
      { name: "amount0Out", type: "uint256", indexed: false },
      { name: "amount1Out", type: "uint256", indexed: false },
      { name: "to", type: "address", indexed: true },
    ],
  },
] as const;

const querySchema = z.object({
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  range: z.enum(["5M", "15M", "1H", "1D", "1W", "1M", "3M", "1Y"]).default("1D"),
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

const RANGE_CONFIG: Record<
  string,
  { lookbackSeconds: number; bucketSeconds: number }
> = {
  "5M": { lookbackSeconds: 5 * 60, bucketSeconds: 5 }, // 5s candles over 5m window
  "15M": { lookbackSeconds: 15 * 60, bucketSeconds: 15 }, // 15s candles over 15m window
  "1H": { lookbackSeconds: 60 * 60, bucketSeconds: 60 }, // 1m candles
  "1D": { lookbackSeconds: 24 * 60 * 60, bucketSeconds: 5 * 60 }, // 5m candles
  "1W": { lookbackSeconds: 7 * 24 * 60 * 60, bucketSeconds: 60 * 60 }, // 1h candles
  "1M": { lookbackSeconds: 30 * 24 * 60 * 60, bucketSeconds: 4 * 60 * 60 }, // 4h candles
  "3M": { lookbackSeconds: 90 * 24 * 60 * 60, bucketSeconds: 24 * 60 * 60 }, // 1d candles
  "1Y": { lookbackSeconds: 365 * 24 * 60 * 60, bucketSeconds: 24 * 60 * 60 }, // 1d candles
};

interface PricePoint {
  timestamp: number; // seconds
  price: number; // ETH per token (display units)
  volumeEth: number;
}

interface Candle {
  time: number; // seconds, bucket start
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, { ...RATE_LIMITS.onchainRead, bucket: "candles" });
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
  }

  const token = parsed.data.token as Address;
  const range = parsed.data.range;
  const config = RANGE_CONFIG[range];

  try {
    const client = getPublicClient();

    const isRobinFun = await curveAdapter.isRobinFunToken(token);
    if (!isRobinFun) {
      return NextResponse.json({ error: "Token is not a RobinFun token" }, { status: 404 });
    }

    const graduated = await curveAdapter.isGraduated(token);

    const latestBlock = await client.getBlockNumber();
    const lookbackBlocks = BigInt(
      Math.ceil(config.lookbackSeconds / ESTIMATED_BLOCK_TIME_SECONDS)
    );
    const cappedLookback = lookbackBlocks > MAX_LOOKBACK_BLOCKS ? MAX_LOOKBACK_BLOCKS : lookbackBlocks;
    const fromBlock = latestBlock > cappedLookback ? latestBlock - cappedLookback : 0n;

    let pricePoints: PricePoint[] = [];

    if (graduated) {
      pricePoints = await fetchGraduatedPricePoints(client, token, fromBlock, latestBlock);
    } else {
      pricePoints = await fetchCurvePricePoints(client, token, fromBlock, latestBlock);
    }

    if (pricePoints.length === 0) {
      return NextResponse.json({
        token,
        range,
        graduated,
        candles: [],
        insufficientData: true,
        message: "Historical chart data is not yet available for this market.",
      });
    }

    const candles = bucketIntoCandles(pricePoints, config.bucketSeconds);

    // Only "no real trades at all in the window" counts as unavailable. A
    // market with a single trade still has a real onchain price point — show
    // it as a single candle rather than fabricating an empty state.
    if (candles.length === 0) {
      return NextResponse.json({
        token,
        range,
        graduated,
        candles: [],
        insufficientData: true,
        message: "Historical chart data is not yet available for this market.",
      });
    }

    return NextResponse.json({
      token,
      range,
      graduated,
      candles,
      insufficientData: false,
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
  const block = await client.getBlock({ blockNumber });
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

  const [buyLogs, sellLogs] = await Promise.all([
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
  ]);

  const allLogs = [...buyLogs, ...sellLogs].sort((a, b) => {
    if (a.blockNumber === b.blockNumber) {
      return Number(a.logIndex ?? 0) - Number(b.logIndex ?? 0);
    }
    return a.blockNumber! < b.blockNumber! ? -1 : 1;
  });

  const tsCache = new Map<bigint, number>();

  // Pre-fetch all unique block timestamps in parallel
  const uniqueBlocks = [...new Set(allLogs.map((l) => l.blockNumber!))];
  await Promise.all(uniqueBlocks.map((bn) => blockTimestamp(client, bn, tsCache)));

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
  client: ReturnType<typeof getPublicClient>,
  token: Address,
  fromBlock: bigint,
  toBlock: bigint
): Promise<PricePoint[]> {
  const tokenInfo = await v2Adapter.getTokenInfo(token);
  const pair = tokenInfo.pairAddress;
  if (!pair) return [];

  const reservesInfo = await v2Adapter.getPairReserves(pair);
  const tokenIsToken0 = reservesInfo.token0.toLowerCase() === token.toLowerCase();
  const wethIsToken0 = reservesInfo.token0.toLowerCase() === WETH.toLowerCase();

  if (!tokenIsToken0 && reservesInfo.token1.toLowerCase() !== token.toLowerCase()) {
    return [];
  }

  const logs = await client.getLogs({
    address: pair,
    event: V2_PAIR_ABI[0],
    fromBlock,
    toBlock,
  });

  const tsCache = new Map<bigint, number>();

  // Pre-fetch all unique block timestamps in parallel
  const uniqueBlocks = [...new Set(logs.map((l) => l.blockNumber!))];
  await Promise.all(uniqueBlocks.map((bn) => blockTimestamp(client, bn, tsCache)));

  const points: PricePoint[] = [];

  for (const log of logs) {
    const args = (log as unknown as { args: Record<string, unknown> }).args;
    const blockNumber = log.blockNumber!;
    const timestamp = tsCache.get(blockNumber)!;

    const amount0In = args.amount0In as bigint;
    const amount1In = args.amount1In as bigint;
    const amount0Out = args.amount0Out as bigint;
    const amount1Out = args.amount1Out as bigint;

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
      timestamp,
      price,
      volumeEth: Number(formatEther(ethAmount)),
    });
  }

  return points.sort((a, b) => a.timestamp - b.timestamp);
}

function bucketIntoCandles(points: PricePoint[], bucketSeconds: number): Candle[] {
  if (points.length === 0) return [];

  const buckets = new Map<number, Candle>();

  for (const point of points) {
    const bucketStart = Math.floor(point.timestamp / bucketSeconds) * bucketSeconds;
    const existing = buckets.get(bucketStart);
    if (!existing) {
      buckets.set(bucketStart, {
        time: bucketStart,
        open: point.price,
        high: point.price,
        low: point.price,
        close: point.price,
        volume: point.volumeEth,
      });
    } else {
      existing.high = Math.max(existing.high, point.price);
      existing.low = Math.min(existing.low, point.price);
      existing.close = point.price;
      existing.volume += point.volumeEth;
    }
  }

  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}
