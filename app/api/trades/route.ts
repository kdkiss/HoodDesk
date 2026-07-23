import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { type Address, formatEther } from "viem";
import { getPublicClient } from "@/src/lib/chain/client";
import { checkRateLimit, RATE_LIMITS } from "@/src/lib/security/rate-limit";
import { ROBINFUN_FACTORY_ABI } from "@/src/lib/dex/abi/robinfun-factory";
import { ROBINFUN_FACTORIES, WETH } from "@/src/config/contracts";
import { curveAdapter, v2Adapter } from "@/src/lib/dex";
import { prisma } from "@/src/lib/db";

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
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

// How far back (in blocks) to search for recent trades. This is a practical
// bound for RPC performance, not a data-fabrication shortcut — only real
// decoded swap events within this window are returned.
const RECENT_TRADES_LOOKBACK_BLOCKS = 50_000n;

export interface RecentTrade {
  txHash: string;
  blockNumber: string;
  timestamp: number;
  direction: "Buy" | "Sell" | "Swap";
  price: string;
  amountToken: string;
  amountEth: string;
  wallet: string;
}

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, { ...RATE_LIMITS.onchainRead, bucket: "trades" });
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters" }, { status: 400 });
  }

  const token = parsed.data.token as Address;
  const limit = parsed.data.limit;

  try {
    const client = getPublicClient();
    const isRobinFun = await curveAdapter.isRobinFunToken(token);
    if (!isRobinFun) {
      return NextResponse.json({ error: "Token is not a RobinFun token" }, { status: 404 });
    }

    const graduated = await curveAdapter.isGraduated(token);
    const latestBlock = await client.getBlockNumber();
    const fromBlock =
      latestBlock > RECENT_TRADES_LOOKBACK_BLOCKS
        ? latestBlock - RECENT_TRADES_LOOKBACK_BLOCKS
        : 0n;

    let trades: RecentTrade[] = [];

    if (graduated) {
      trades = await fetchGraduatedTrades(client, token, fromBlock, latestBlock);
    } else {
      trades = await fetchCurveTrades(client, token, fromBlock, latestBlock);
    }

    trades.sort((a, b) => b.timestamp - a.timestamp);
    trades = trades.slice(0, limit);

    return NextResponse.json({ token, graduated, trades });
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
 * The token's Buy/Sell events are emitted by the factory that created it,
 * which is not necessarily the newest (V5) factory. Resolve from discovery
 * metadata first; fall back to V5 for tokens not yet indexed.
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

async function fetchCurveTrades(
  client: ReturnType<typeof getPublicClient>,
  token: Address,
  fromBlock: bigint,
  toBlock: bigint
): Promise<RecentTrade[]> {
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

  const allLogs = [...buyLogs, ...sellLogs];
  const tsCache = new Map<bigint, number>();
  
  // Pre-fetch all unique block timestamps in parallel to prevent duplicate RPC calls
  const uniqueBlocks = [...new Set(allLogs.map((l) => l.blockNumber!))];
  await Promise.all(uniqueBlocks.map((bn) => blockTimestamp(client, bn, tsCache)));

  const trades: RecentTrade[] = [];

  const buyTrades = buyLogs.map((log) => {
    const args = (log as unknown as { args: Record<string, unknown> }).args;
    const blockNumber = log.blockNumber!;
    const timestamp = tsCache.get(blockNumber)!;
    const ethIn = args.ethIn as bigint;
    const tokensOut = args.tokensOut as bigint;
    if (tokensOut === 0n) return null;
    return {
      txHash: log.transactionHash! as string,
      blockNumber: blockNumber.toString(),
      timestamp,
      direction: "Buy" as RecentTrade["direction"],
      price: (Number(formatEther(ethIn)) / Number(formatEther(tokensOut))).toString(),
      amountToken: formatEther(tokensOut),
      amountEth: formatEther(ethIn),
      wallet: (args.buyer as string) ?? "",
    } satisfies RecentTrade;
  });
  trades.push(...buyTrades.filter((t): t is RecentTrade => t !== null));

  const sellTrades = sellLogs.map((log) => {
    const args = (log as unknown as { args: Record<string, unknown> }).args;
    const blockNumber = log.blockNumber!;
    const timestamp = tsCache.get(blockNumber)!;
    const ethOut = args.ethOut as bigint;
    const tokensIn = args.tokensIn as bigint;
    if (tokensIn === 0n) return null;
    return {
      txHash: log.transactionHash! as string,
      blockNumber: blockNumber.toString(),
      timestamp,
      direction: "Sell" as RecentTrade["direction"],
      price: (Number(formatEther(ethOut)) / Number(formatEther(tokensIn))).toString(),
      amountToken: formatEther(tokensIn),
      amountEth: formatEther(ethOut),
      wallet: (args.seller as string) ?? "",
    } satisfies RecentTrade;
  });
  trades.push(...sellTrades.filter((t): t is RecentTrade => t !== null));

  return trades;
}

async function fetchGraduatedTrades(
  client: ReturnType<typeof getPublicClient>,
  token: Address,
  fromBlock: bigint,
  toBlock: bigint
): Promise<RecentTrade[]> {
  const tokenInfo = await v2Adapter.getTokenInfo(token);
  const pair = tokenInfo.pairAddress;
  if (!pair) return [];

  const reservesInfo = await v2Adapter.getPairReserves(pair);
  const wethIsToken0 = reservesInfo.token0.toLowerCase() === WETH.toLowerCase();
  const tokenIsToken0 = reservesInfo.token0.toLowerCase() === token.toLowerCase();
  const tokenIsToken1 = reservesInfo.token1.toLowerCase() === token.toLowerCase();
  if (!tokenIsToken0 && !tokenIsToken1) return [];

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

  const trades: RecentTrade[] = [];

  const graduatedTrades = logs.map((log) => {
    const args = (log as unknown as { args: Record<string, unknown> }).args;
    const blockNumber = log.blockNumber!;
    const timestamp = tsCache.get(blockNumber)!;

    const amount0In = args.amount0In as bigint;
    const amount1In = args.amount1In as bigint;
    const amount0Out = args.amount0Out as bigint;
    const amount1Out = args.amount1Out as bigint;

    let ethAmount: bigint;
    let tokenAmount: bigint;
    let ethIn: boolean;

    if (wethIsToken0) {
      ethAmount = amount0In > 0n ? amount0In : amount0Out;
      tokenAmount = amount1In > 0n ? amount1In : amount1Out;
      ethIn = amount0In > 0n;
    } else {
      ethAmount = amount1In > 0n ? amount1In : amount1Out;
      tokenAmount = amount0In > 0n ? amount0In : amount0Out;
      ethIn = amount1In > 0n;
    }

    if (tokenAmount === 0n || ethAmount === 0n) return null;

    const isTokenWethPair =
      (tokenIsToken0 && reservesInfo.token1.toLowerCase() === WETH.toLowerCase()) ||
      (tokenIsToken1 && reservesInfo.token0.toLowerCase() === WETH.toLowerCase());

    const direction: RecentTrade["direction"] = isTokenWethPair
      ? ethIn
        ? "Buy"
        : "Sell"
      : "Swap";

    const price = Number(formatEther(ethAmount)) / Number(formatEther(tokenAmount));

    return {
      txHash: log.transactionHash! as string,
      blockNumber: blockNumber.toString(),
      timestamp,
      direction,
      price: price.toString(),
      amountToken: formatEther(tokenAmount),
      amountEth: formatEther(ethAmount),
      wallet: (args.to as string) ?? (args.sender as string) ?? "",
    } satisfies RecentTrade;
  });
  trades.push(...graduatedTrades.filter((t): t is RecentTrade => t !== null));

  return trades;
}
