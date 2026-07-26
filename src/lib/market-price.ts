import { formatEther, type Address } from "viem";
import { WETH } from "@/src/config/contracts";
import { curveAdapter, v2Adapter } from "@/src/lib/dex";
import { priceEthPerTokenFromReserves } from "@/src/lib/price-units";
import { getPublicClient } from "@/src/lib/chain/client";
import { ROBINFUN_FACTORY_ABI } from "@/src/lib/dex/abi/robinfun-factory";
import { getBlockscoutBlockNumberAtTimestamp } from "@/src/lib/blockscout/market-data";
import { retryRpcRead } from "@/src/lib/chain/retry";

const DAY_SECONDS = 24 * 60 * 60;
const HISTORICAL_READ_CONCURRENCY = 8;
const LIVE_PRICE_TTL_MS = 15_000;
const HISTORICAL_PRICE_TTL_MS = 10 * 60_000;
const PRICE_BOUNDARY_BUCKET_SECONDS = 5 * 60;

interface PriceCacheEntry<T> {
  expiresAt: number;
  promise: Promise<T>;
}

const priceCache = new Map<string, PriceCacheEntry<unknown>>();

function cachedPrice<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const existing = priceCache.get(key) as PriceCacheEntry<T> | undefined;
  if (existing && existing.expiresAt > now) return existing.promise;
  if (existing) priceCache.delete(key);

  const promise = load().catch((error) => {
    priceCache.delete(key);
    throw error;
  });
  priceCache.set(key, { expiresAt: now + ttlMs, promise });

  if (priceCache.size > 500) {
    for (const [cacheKey, entry] of priceCache) {
      if (entry.expiresAt <= now) priceCache.delete(cacheKey);
    }
  }
  return promise;
}

const PAIR_RESERVES_ABI = [
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
] as const;

export interface MarketChangeToken {
  address: string;
  decimals?: number | null;
  dexLive: boolean;
  pairAddress?: string | null;
  factoryAddress?: string | null;
}

/**
 * Returns the current on-chain price in ETH per whole token.  We deliberately
 * do not label this as USD: the application has no verified ETH/USD oracle.
 */
export async function getLivePriceEth(
  token: Address,
  dexLive: boolean,
  knownPairAddress?: string | null
): Promise<string | null> {
  const cacheKey = `live:${token.toLowerCase()}:${dexLive ? knownPairAddress?.toLowerCase() ?? "pair" : "curve"}`;
  return cachedPrice(cacheKey, LIVE_PRICE_TTL_MS, () =>
    loadLivePriceEth(token, dexLive, knownPairAddress)
  );
}

async function loadLivePriceEth(
  token: Address,
  dexLive: boolean,
  knownPairAddress?: string | null
): Promise<string | null> {
  try {
    if (!dexLive) {
      return formatEther(await curveAdapter.getCurrentPrice(token));
    }

    const pairAddress = knownPairAddress ?? (await v2Adapter.getTokenInfo(token)).pairAddress;
    if (!pairAddress) return null;

    const reserves = await v2Adapter.getPairReserves(pairAddress as Address);
    const wethIsToken0 = reserves.token0.toLowerCase() === WETH.toLowerCase();
    const wethReserve = wethIsToken0 ? reserves.reserve0 : reserves.reserve1;
    const tokenReserve = wethIsToken0 ? reserves.reserve1 : reserves.reserve0;
    const price = priceEthPerTokenFromReserves(wethReserve, tokenReserve);
    if (price === null) return null;

    return formatEther(price);
  } catch {
    // A newly created or illiquid token can have no readable price yet.
    return null;
  }
}

export async function getPriceChanges24h(
  tokens: MarketChangeToken[],
  currentPricesEth: Array<string | null>
): Promise<Array<number | null>> {
  if (tokens.length === 0) return [];

  const rawBoundary = Math.floor(Date.now() / 1000) - DAY_SECONDS;
  const boundaryTimestamp =
    Math.floor(rawBoundary / PRICE_BOUNDARY_BUCKET_SECONDS) *
    PRICE_BOUNDARY_BUCKET_SECONDS;
  let boundaryBlock: bigint;
  try {
    boundaryBlock = BigInt(
      await getBlockscoutBlockNumberAtTimestamp(boundaryTimestamp)
    );
  } catch {
    return tokens.map(() => null);
  }

  const changes: Array<number | null> = Array(tokens.length).fill(null);
  let cursor = 0;

  async function worker() {
    while (cursor < tokens.length) {
      const index = cursor++;
      const currentPrice = Number(currentPricesEth[index]);
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) continue;

      const historicalPrice = await getHistoricalPriceEth(
        tokens[index],
        boundaryBlock
      );
      if (
        historicalPrice === null ||
        !Number.isFinite(historicalPrice) ||
        historicalPrice <= 0
      ) {
        continue;
      }

      changes[index] =
        ((currentPrice - historicalPrice) / historicalPrice) * 100;
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(HISTORICAL_READ_CONCURRENCY, tokens.length) },
      worker
    )
  );
  return changes;
}

async function getHistoricalPriceEth(
  token: MarketChangeToken,
  blockNumber: bigint
): Promise<number | null> {
  const cacheKey = `historical:${token.address.toLowerCase()}:${blockNumber}`;
  return cachedPrice(cacheKey, HISTORICAL_PRICE_TTL_MS, () =>
    loadHistoricalPriceEth(token, blockNumber)
  );
}

async function loadHistoricalPriceEth(
  token: MarketChangeToken,
  blockNumber: bigint
): Promise<number | null> {
  if (token.dexLive && token.pairAddress) {
    const v2Price = await getHistoricalV2PriceEth(token, blockNumber);
    if (v2Price !== null) return v2Price;
  }

  if (!token.factoryAddress) return null;
  try {
    const price = await retryRpcRead(() =>
      getPublicClient().readContract({
        address: token.factoryAddress as Address,
        abi: ROBINFUN_FACTORY_ABI,
        functionName: "currentPrice",
        args: [token.address as Address],
        blockNumber,
      })
    );
    return Number(formatEther(price as bigint));
  } catch {
    return null;
  }
}

async function getHistoricalV2PriceEth(
  token: MarketChangeToken,
  blockNumber: bigint
): Promise<number | null> {
  try {
    const reserves = await retryRpcRead(() =>
      getPublicClient().readContract({
        address: token.pairAddress as Address,
        abi: PAIR_RESERVES_ABI,
        functionName: "getReserves",
        blockNumber,
      })
    );
    const [reserve0, reserve1] = reserves as [bigint, bigint, number];
    const wethIsToken0 =
      BigInt(WETH.toLowerCase()) < BigInt(token.address.toLowerCase());
    const wethReserve = wethIsToken0 ? reserve0 : reserve1;
    const tokenReserve = wethIsToken0 ? reserve1 : reserve0;
    const price = priceEthPerTokenFromReserves(
      wethReserve,
      tokenReserve,
      token.decimals ?? 18
    );
    return price === null ? null : Number(formatEther(price));
  } catch {
    // A token may have graduated during the 24-hour window. In that case the
    // pair did not yet exist at the boundary and the curve fallback is used.
    return null;
  }
}
