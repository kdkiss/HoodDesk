import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { type Address, formatEther } from "viem";
import { getPublicClient } from "@/src/lib/chain/client";
import { checkRateLimit, RATE_LIMITS } from "@/src/lib/security/rate-limit";
import { ROBINFUN_FACTORY_ABI } from "@/src/lib/dex/abi/robinfun-factory";
import { ROBINFUN_FACTORIES, WETH } from "@/src/config/contracts";
import { curveAdapter, v2Adapter } from "@/src/lib/dex";
import { prisma } from "@/src/lib/db";

const paramsSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

// Measured onchain: Robinhood Chain mainnet averages ~0.1s per block
// (50,000-block timestamp-delta sample). Used only to translate a time
// window into a block range for eth_getLogs — never to fabricate data.
const BLOCK_TIME_SECONDS = 0.1;
const DAY_SECONDS = 24 * 60 * 60;

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
    const client = getPublicClient();

    // Parallelize all initial RPC reads
    const [isRobinFun, curve, latestBlock] = await Promise.all([
      curveAdapter.isRobinFunToken(token),
      curveAdapter.getCurveState(token),
      client.getBlockNumber(),
    ]);
    if (!isRobinFun) {
      return NextResponse.json({ error: "Token is not a RobinFun token" }, { status: 404 });
    }

    const graduated = curve.graduated;

    // USD fields: there is no trustworthy ETH/USD reference available to us.
    // The factory's ethUsdPrice() getter returns a value whose scaling
    // (verified live: ~1.156e10 raw) matches no standard fixed-point
    // convention, and no canonical USDC address can be safely identified on
    // this chain without guessing between multiple same-symbol contracts.
    // Rather than invent an exchange rate, USD fields are reported as null
    // (unavailable). ETH-denominated fields remain fully populated.
    const ethUsd: number | null = null;

    // --- Current price ---
    let priceEth: bigint;
    let liquidityEth: bigint; // curve realEth, or pair WETH reserve
    if (graduated) {
      const pairAddress = (await v2Adapter.getTokenInfo(token)).pairAddress!;
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

    // --- 24h price change from the closest trade at/after the 24h boundary ---
    const lookbackBlocks = BigInt(Math.ceil(DAY_SECONDS / BLOCK_TIME_SECONDS));
    // Cap at 200K blocks to keep RPC fast
    const cappedLookback = lookbackBlocks > 200_000n ? 200_000n : lookbackBlocks;
    const fromBlock = latestBlock > cappedLookback ? latestBlock - cappedLookback : 0n;

    let change24hPct: number | null = null;
    try {
      const priceAtBoundary = await priceAtBlock(client, token, graduated, fromBlock);
      const now = Number(formatEther(priceEth));
      if (priceAtBoundary !== null && priceAtBoundary > 0 && now > 0) {
        change24hPct = ((now - priceAtBoundary) / priceAtBoundary) * 100;
      }
    } catch {
      change24hPct = null; // no trade in window — leave unavailable, never fabricate
    }

    // --- Market cap / holders ---
    const meta = await prisma.tokenMetadata.findUnique({
      where: { address: token.toLowerCase() },
    });
    const totalSupply = meta?.totalSupply ? BigInt(meta.totalSupply) : null;
    const marketCapEth =
      totalSupply !== null
        ? Number(formatEther(priceEth)) * Number(formatEther(totalSupply))
        : null;

    return NextResponse.json({
      token,
      graduated,
      priceEth: formatEther(priceEth),
      priceUsd: null,
      ethUsd,
      change24hPct,
      liquidityEth: formatEther(liquidityEth),
      liquidityUsd: null,
      marketCapEth,
      marketCapUsd: null,
      holdersCount: meta?.holdersCount ?? null,
      totalSupply: totalSupply?.toString() ?? null,
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

/**
 * Returns the price (ETH per token, display units) implied by the earliest
 * trade at/after fromBlock, or null if no trade exists in the window.
 */
/** Trade events live on the factory that created the token (V1–V5), not
 *  always the newest. Resolve from discovery metadata; fall back to V5. */
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

async function priceAtBlock(
  client: ReturnType<typeof getPublicClient>,
  token: Address,
  graduated: boolean,
  fromBlock: bigint
): Promise<number | null> {
  const factory = await resolveCurveFactory(token);

  if (!graduated) {
    const [buyLogs, sellLogs] = await Promise.all([
      client.getLogs({
        address: factory,
        event: ROBINFUN_FACTORY_ABI.find((e) => e.type === "event" && e.name === "Buy")!,
        args: { token },
        fromBlock,
        toBlock: "latest",
      }),
      client.getLogs({
        address: factory,
        event: ROBINFUN_FACTORY_ABI.find((e) => e.type === "event" && e.name === "Sell")!,
        args: { token },
        fromBlock,
        toBlock: "latest",
      }),
    ]);
    const first = [...buyLogs, ...sellLogs].sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? Number(a.logIndex ?? 0) - Number(b.logIndex ?? 0)
        : a.blockNumber! < b.blockNumber!
          ? -1
          : 1
    )[0];
    if (!first) return null;
    const args = (first as unknown as { args: Record<string, unknown> }).args;
    const newPrice = args.newPriceWeiPerToken as bigint | undefined;
    if (newPrice && newPrice > 0n) return Number(formatEther(newPrice));
    const isBuy = "buyer" in args;
    const eth = (isBuy ? args.ethIn : args.ethOut) as bigint;
    const tokens = (isBuy ? args.tokensOut : args.tokensIn) as bigint;
    if (tokens === 0n) return null;
    return Number(formatEther(eth)) / Number(formatEther(tokens));
  }

  const tokenInfo = await v2Adapter.getTokenInfo(token);
  if (!tokenInfo.pairAddress) return null;
  const reserves = await v2Adapter.getPairReserves(tokenInfo.pairAddress);
  const wethIsToken0 = reserves.token0.toLowerCase() === WETH.toLowerCase();

  const logs = await client.getLogs({
    address: tokenInfo.pairAddress,
    event: {
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
    } as const,
    fromBlock,
    toBlock: "latest",
  });
  const first = logs[0];
  if (!first) return null;
  const args = (first as unknown as { args: Record<string, unknown> }).args;
  const amount0In = args.amount0In as bigint;
  const amount1In = args.amount1In as bigint;
  const amount0Out = args.amount0Out as bigint;
  const amount1Out = args.amount1Out as bigint;

  const ethAmount = wethIsToken0
    ? amount0In > 0n ? amount0In : amount0Out
    : amount1In > 0n ? amount1In : amount1Out;
  const tokenAmount = wethIsToken0
    ? amount1In > 0n ? amount1In : amount1Out
    : amount0In > 0n ? amount0In : amount0Out;
  if (tokenAmount === 0n || ethAmount === 0n) return null;
  return Number(formatEther(ethAmount)) / Number(formatEther(tokenAmount));
}
