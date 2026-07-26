import { z } from "zod";
import {
  blockscoutGet,
  blockscoutRpcGet,
} from "@/src/lib/blockscout/client";

const SWAP_TOPIC =
  "0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822";
const MARKET_TTL_MS = 60_000;
const ACTIVITY_TTL_MS = 10_000;
const HISTORY_REFRESH_MS = 15_000;
const HISTORY_RETENTION_MS = 6 * 60 * 60_000;
const HISTORY_DEADLINE_MS = 60_000;
const CACHE_SWEEP_INTERVAL_MS = 60_000;
const MAX_SWAP_PAGES = 40;
const BLOCKSCOUT_PAGE_ATTEMPTS = 3;
const BLOCKS_PER_HISTORY_SEGMENT = 100_000;

const tokenMarketSchema = z.object({
  holders_count: z.string().nullable().optional(),
  total_supply: z.string().nullable().optional(),
  exchange_rate: z.string().nullable().optional(),
  circulating_market_cap: z.string().nullable().optional(),
});

const networkStatsSchema = z.object({
  coin_price: z.string().nullable().optional(),
});

const addressSchema = z.object({
  hash: z.string(),
  name: z.string().nullable().optional(),
});

const holderSchema = z.object({
  address: addressSchema,
  value: z.string(),
});

const holdersResponseSchema = z.object({
  items: z.array(holderSchema),
  next_page_params: z.record(z.union([z.string(), z.number()])).nullable().optional(),
});

const decodedParameterSchema = z.object({
  name: z.string(),
  value: z.string(),
});

const logSchema = z.object({
  block_number: z.number(),
  block_timestamp: z.string(),
  transaction_hash: z.string(),
  decoded: z
    .object({
      method_call: z.string(),
      parameters: z.array(decodedParameterSchema),
    })
    .nullable(),
});

const logsResponseSchema = z.object({
  items: z.array(logSchema),
  next_page_params: z.record(z.union([z.string(), z.number()])).nullable().optional(),
});

const blockByTimeResponseSchema = z.object({
  status: z.string().optional(),
  message: z.string().optional(),
  result: z.object({ blockNumber: z.string() }),
});

const rpcLogSchema = z.object({
  blockNumber: z.string(),
  data: z.string(),
  timeStamp: z.string(),
  transactionHash: z.string(),
  topics: z.array(z.string().nullable()),
});

const rpcLogsResponseSchema = z.object({
  status: z.string().optional(),
  message: z.string().optional(),
  result: z.union([z.array(rpcLogSchema), z.string()]),
});

interface CacheEntry<T> {
  expiresAt: number;
  promise: Promise<T>;
}

const cache = new Map<string, CacheEntry<unknown>>();
interface HistoryState extends BlockscoutV2SwapResult {
  toBlock: number;
}
interface HistoryCacheEntry {
  retainUntil: number;
  refreshAfter: number;
  promise: Promise<HistoryState>;
}
const historyCache = new Map<string, HistoryCacheEntry>();
let lastCacheSweep = Date.now();

function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  if (now - lastCacheSweep >= CACHE_SWEEP_INTERVAL_MS) {
    lastCacheSweep = now;
    for (const [cacheKey, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(cacheKey);
    }
    for (const [cacheKey, entry] of historyCache) {
      if (entry.retainUntil <= now) historyCache.delete(cacheKey);
    }
  }
  const existing = cache.get(key) as CacheEntry<T> | undefined;
  if (existing && existing.expiresAt > now) return existing.promise;
  if (existing) cache.delete(key);

  const promise = load().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, { expiresAt: now + ttlMs, promise });
  return promise;
}

function finiteNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function positiveInteger(value: string | null | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export interface BlockscoutTokenMarketData {
  holdersCount: number | null;
  totalSupplyRaw: string | null;
  priceUsd: number | null;
  marketCapUsd: number | null;
}

export function getBlockscoutTokenMarketData(
  tokenAddress: string
): Promise<BlockscoutTokenMarketData> {
  const address = tokenAddress.toLowerCase();
  return cached(`token-market:${address}`, MARKET_TTL_MS, async () => {
    const result = tokenMarketSchema.parse(
      await blockscoutGet<unknown>(`/tokens/${address}`)
    );
    return {
      holdersCount: positiveInteger(result.holders_count),
      totalSupplyRaw: result.total_supply ?? null,
      priceUsd: finiteNumber(result.exchange_rate),
      marketCapUsd: finiteNumber(result.circulating_market_cap),
    };
  });
}

export function getBlockscoutEthUsd(): Promise<number | null> {
  return cached("network-eth-usd", MARKET_TTL_MS, async () => {
    const result = networkStatsSchema.parse(await blockscoutGet<unknown>("/stats"));
    return finiteNumber(result.coin_price);
  });
}

export function getBlockscoutBlockNumberAtTimestamp(
  timestamp: number
): Promise<number> {
  const safeTimestamp = Math.max(0, Math.floor(timestamp));
  const minuteBucket = Math.floor(safeTimestamp / 60);
  return cached(`block-at-time:${minuteBucket}`, MARKET_TTL_MS, async () => {
    const response = blockByTimeResponseSchema.parse(
      await retryBlockscoutPage(() =>
        blockscoutRpcGet<unknown>({
          module: "block",
          action: "getblocknobytime",
          timestamp: String(safeTimestamp),
          closest: "after",
        })
      )
    );
    return parseBlockNumber(response.result.blockNumber);
  });
}

export interface BlockscoutHolder {
  address: string;
  name: string | null;
  balanceRaw: string;
}

export async function getBlockscoutTokenHolders(
  tokenAddress: string,
  limit = 20
): Promise<BlockscoutHolder[]> {
  const address = tokenAddress.toLowerCase();
  const safeLimit = Math.max(1, Math.min(limit, 50));
  return cached(`token-holders:${address}:${safeLimit}`, MARKET_TTL_MS, async () => {
    const result = holdersResponseSchema.parse(
      await blockscoutGet<unknown>(`/tokens/${address}/holders`)
    );
    return result.items.slice(0, safeLimit).map((item) => ({
      address: item.address.hash,
      name: item.address.name ?? null,
      balanceRaw: item.value,
    }));
  });
}

export interface BlockscoutV2Swap {
  transactionHash: string;
  blockNumber: number;
  timestamp: number;
  amount0In: bigint;
  amount1In: bigint;
  amount0Out: bigint;
  amount1Out: bigint;
  sender: string;
  to: string;
}

export interface BlockscoutV2SwapResult {
  swaps: BlockscoutV2Swap[];
  truncated: boolean;
}

const HISTORY_SEGMENTS = 12;
const HISTORY_CONCURRENCY = process.env.BLOCKSCOUT_API_KEY ? 3 : 1;
const MAX_HISTORY_SWAPS = 12_000;

/**
 * Loads historical pair swaps in bounded block ranges through Blockscout's
 * logs RPC API. The endpoint returns up to 1,000 logs per range, so saturated
 * ranges are reported as truncated rather than treated as complete history.
 */
export function getBlockscoutV2SwapHistory(
  pairAddress: string,
  options: { sinceTimestamp: number; limit?: number }
): Promise<BlockscoutV2SwapResult> {
  const pair = pairAddress.toLowerCase();
  const sinceTimestamp = Math.max(0, Math.floor(options.sinceTimestamp));
  const limit = Math.max(
    1,
    Math.min(options.limit ?? MAX_HISTORY_SWAPS, MAX_HISTORY_SWAPS)
  );
  const windowMinutes = Math.max(
    1,
    Math.round((Math.floor(Date.now() / 1000) - sinceTimestamp) / 60)
  );
  const key = `v2-swap-history:${pair}:${windowMinutes}:${limit}`;
  const nowMs = Date.now();
  const existing = historyCache.get(key);
  if (existing && existing.retainUntil > nowMs && existing.refreshAfter > nowMs) {
    return existing.promise.then((state) =>
      publicHistoryResult(state, sinceTimestamp, limit)
    );
  }

  const deadlineAt = nowMs + HISTORY_DEADLINE_MS;
  const promise = existing && existing.retainUntil > nowMs
    ? existing.promise.then(async (state) => {
        try {
          return await refreshHistoryState(pair, state, limit, deadlineAt);
        } catch {
          return { ...state, truncated: true };
        }
      })
    : loadInitialHistoryState(pair, sinceTimestamp, limit, deadlineAt);

  historyCache.set(key, {
    promise,
    refreshAfter: nowMs + HISTORY_REFRESH_MS,
    retainUntil: nowMs + HISTORY_RETENTION_MS,
  });
  promise.catch(() => {
    if (historyCache.get(key)?.promise === promise) historyCache.delete(key);
  });

  return promise.then((state) =>
    publicHistoryResult(state, sinceTimestamp, limit)
  );
}

async function loadInitialHistoryState(
  pair: string,
  sinceTimestamp: number,
  limit: number,
  deadlineAt: number
): Promise<HistoryState> {
  const now = Math.floor(Date.now() / 1000);
  const [startResponse, endResponse] = await Promise.all([
    retryBlockscoutPage(
      () =>
        blockscoutRpcGet<unknown>(
          {
            module: "block",
            action: "getblocknobytime",
            timestamp: String(sinceTimestamp),
            closest: "after",
          },
          { timeoutMs: remainingTimeoutMs(deadlineAt, 20_000) }
        ),
      deadlineAt
    ),
    retryBlockscoutPage(
      () =>
        blockscoutRpcGet<unknown>(
          {
            module: "block",
            action: "getblocknobytime",
            timestamp: String(now),
            closest: "before",
          },
          { timeoutMs: remainingTimeoutMs(deadlineAt, 20_000) }
        ),
      deadlineAt
    ),
  ]);
  const fromBlock = parseBlockNumber(
    blockByTimeResponseSchema.parse(startResponse).result.blockNumber
  );
  const toBlock = parseBlockNumber(
    blockByTimeResponseSchema.parse(endResponse).result.blockNumber
  );
  if (toBlock < fromBlock) return { swaps: [], truncated: false, toBlock };

  const loaded = await loadRpcSwapSegments(
    pair,
    fromBlock,
    toBlock,
    deadlineAt
  );
  return normalizedHistoryState(loaded.swaps, loaded.truncated, toBlock, limit);
}

async function refreshHistoryState(
  pair: string,
  state: HistoryState,
  limit: number,
  deadlineAt: number
): Promise<HistoryState> {
  const endResponse = await retryBlockscoutPage(
    () =>
      blockscoutRpcGet<unknown>(
        {
          module: "block",
          action: "getblocknobytime",
          timestamp: String(Math.floor(Date.now() / 1000)),
          closest: "before",
        },
        { timeoutMs: remainingTimeoutMs(deadlineAt, 20_000) }
      ),
    deadlineAt
  );
  const toBlock = parseBlockNumber(
    blockByTimeResponseSchema.parse(endResponse).result.blockNumber
  );
  if (toBlock <= state.toBlock) return state;

  const added = await loadRpcSwapSegments(
    pair,
    state.toBlock + 1,
    toBlock,
    deadlineAt
  );
  return normalizedHistoryState(
    [...added.swaps, ...state.swaps],
    state.truncated || added.truncated,
    toBlock,
    limit
  );
}

async function loadRpcSwapSegments(
  pair: string,
  fromBlock: number,
  toBlock: number,
  deadlineAt: number
): Promise<BlockscoutV2SwapResult> {
  const span = toBlock - fromBlock + 1;
  const segmentCount = Math.max(
    1,
    Math.min(HISTORY_SEGMENTS, Math.ceil(span / BLOCKS_PER_HISTORY_SEGMENT))
  );
  const segmentSize = Math.ceil(span / segmentCount);
  const segments = Array.from({ length: segmentCount }, (_, index) => ({
    fromBlock: fromBlock + index * segmentSize,
    toBlock: Math.min(toBlock, fromBlock + (index + 1) * segmentSize - 1),
  })).filter((segment) => segment.fromBlock <= segment.toBlock);

  const swaps: BlockscoutV2Swap[] = [];
  let truncated = false;
  let successfulSegments = 0;
  let firstSegmentError: unknown;
  for (let offset = 0; offset < segments.length; offset += HISTORY_CONCURRENCY) {
    assertBeforeDeadline(deadlineAt);
    const batch = segments.slice(offset, offset + HISTORY_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map((segment) =>
        loadRpcSwapRange(pair, segment.fromBlock, segment.toBlock, deadlineAt)
      )
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        successfulSegments += 1;
        swaps.push(...result.value.swaps);
        truncated ||= result.value.truncated;
      } else {
        truncated = true;
        firstSegmentError ??= result.reason;
      }
    }
  }
  if (successfulSegments === 0 && firstSegmentError) throw firstSegmentError;
  return { swaps, truncated };
}

function normalizedHistoryState(
  swaps: BlockscoutV2Swap[],
  initialTruncated: boolean,
  toBlock: number,
  limit: number
): HistoryState {
  swaps.sort((a, b) =>
    a.blockNumber !== b.blockNumber
      ? b.blockNumber - a.blockNumber
      : b.timestamp - a.timestamp
  );
  return {
    swaps: swaps.slice(0, limit),
    truncated: initialTruncated || swaps.length > limit,
    toBlock,
  };
}

function publicHistoryResult(
  state: HistoryState,
  sinceTimestamp: number,
  limit: number
): BlockscoutV2SwapResult {
  const swaps = state.swaps
    .filter((swap) => swap.timestamp >= sinceTimestamp)
    .slice(0, limit);
  return {
    swaps,
    truncated: state.truncated || swaps.length < state.swaps.length,
  };
}

export function getBlockscoutV2Swaps(
  pairAddress: string,
  options: { sinceTimestamp?: number; limit?: number } = {}
): Promise<BlockscoutV2SwapResult> {
  const pair = pairAddress.toLowerCase();
  const sinceTimestamp = options.sinceTimestamp;
  const limit = Math.max(1, Math.min(options.limit ?? 2_000, 2_000));
  // Cache by requested window length rather than the moving absolute
  // timestamp. Otherwise each polling tick creates a permanent new Map key.
  const windowMinutes =
    sinceTimestamp === undefined
      ? "latest"
      : String(
          Math.max(
            1,
            Math.round((Math.floor(Date.now() / 1000) - sinceTimestamp) / 60)
          )
        );
  const cacheKey = `v2-swaps:${pair}:${windowMinutes}:${limit}`;

  return cached(cacheKey, ACTIVITY_TTL_MS, async () => {
    const deadlineAt = Date.now() + HISTORY_DEADLINE_MS;
    const swaps: BlockscoutV2Swap[] = [];
    let pageParams: Record<string, string> = { topic: SWAP_TOPIC };
    let page = 0;
    let reachedBoundary = false;
    let hasNextPage = false;
    let paginationFailed = false;
    let successfulPages = 0;

    while (page < MAX_SWAP_PAGES && swaps.length < limit) {
      let response: z.infer<typeof logsResponseSchema>;
      try {
        response = logsResponseSchema.parse(
          await retryBlockscoutPage(
            () =>
              blockscoutGet<unknown>(
                `/addresses/${pair}/logs`,
                pageParams,
                { timeoutMs: remainingTimeoutMs(deadlineAt, 20_000) }
              ),
            deadlineAt
          )
        );
      } catch (error) {
        if (successfulPages === 0) throw error;
        paginationFailed = true;
        break;
      }
      page += 1;
      successfulPages += 1;

      for (const item of response.items) {
        const timestamp = Math.floor(Date.parse(item.block_timestamp) / 1000);
        if (!Number.isFinite(timestamp)) continue;
        if (sinceTimestamp !== undefined && timestamp < sinceTimestamp) {
          reachedBoundary = true;
          continue;
        }
        const swap = parseV2Swap(item, timestamp);
        if (swap) swaps.push(swap);
        if (swaps.length >= limit) break;
      }

      const next = response.next_page_params;
      hasNextPage = Boolean(next);
      if (!next || reachedBoundary || swaps.length >= limit) break;
      pageParams = {
        topic: SWAP_TOPIC,
        ...Object.fromEntries(
          Object.entries(next).map(([key, value]) => [key, String(value)])
        ),
      };
    }

    swaps.sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) return b.blockNumber - a.blockNumber;
      return b.timestamp - a.timestamp;
    });

    return {
      swaps,
      truncated:
        paginationFailed ||
        (hasNextPage &&
          !reachedBoundary &&
          (page >= MAX_SWAP_PAGES || swaps.length >= limit)),
    };
  });
}

async function retryBlockscoutPage<T>(
  load: () => Promise<T>,
  deadlineAt?: number
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= BLOCKSCOUT_PAGE_ATTEMPTS; attempt += 1) {
    if (deadlineAt !== undefined) assertBeforeDeadline(deadlineAt);
    try {
      return await load();
    } catch (error) {
      lastError = error;
      if (
        attempt >= BLOCKSCOUT_PAGE_ATTEMPTS ||
        !isTransientBlockscoutError(error)
      ) {
        break;
      }
      const jitterMs = Math.floor(Math.random() * 150);
      const retryAfterMs = getRetryAfterMs(error);
      const delayMs = Math.max(500 * attempt + jitterMs, retryAfterMs);
      if (deadlineAt !== undefined && Date.now() + delayMs >= deadlineAt) break;
      await new Promise((resolve) =>
        setTimeout(resolve, delayMs)
      );
    }
  }

  throw lastError;
}

function getRetryAfterMs(error: unknown): number {
  if (
    typeof error === "object" &&
    error !== null &&
    "retryAfterMs" in error &&
    typeof error.retryAfterMs === "number" &&
    Number.isFinite(error.retryAfterMs)
  ) {
    return Math.max(0, error.retryAfterMs);
  }
  return 0;
}

function assertBeforeDeadline(deadlineAt: number): void {
  if (Date.now() >= deadlineAt) {
    throw new Error("Blockscout history request exceeded its deadline");
  }
}

function remainingTimeoutMs(deadlineAt: number, maximumMs: number): number {
  assertBeforeDeadline(deadlineAt);
  return Math.max(1, Math.min(maximumMs, deadlineAt - Date.now()));
}

function isTransientBlockscoutError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (!(error instanceof Error)) return false;
  return (
    /\b(?:429|5\d\d)\b/.test(error.message) ||
    /fetch failed|network|socket|econnreset|etimedout/i.test(error.message)
  );
}

function parseBlockNumber(value: string): number {
  const blockNumber = value.startsWith("0x")
    ? Number.parseInt(value.slice(2), 16)
    : Number.parseInt(value, 10);
  if (!Number.isSafeInteger(blockNumber) || blockNumber < 0) {
    throw new Error("Blockscout returned an invalid block number");
  }
  return blockNumber;
}

async function loadRpcSwapRange(
  pair: string,
  fromBlock: number,
  toBlock: number,
  deadlineAt?: number
): Promise<BlockscoutV2SwapResult> {
  const raw = await retryBlockscoutPage(
    () =>
      blockscoutRpcGet<unknown>(
        {
          module: "logs",
          action: "getLogs",
          fromBlock: String(fromBlock),
          toBlock: String(toBlock),
          address: pair,
          topic0: SWAP_TOPIC,
        },
        {
          timeoutMs:
            deadlineAt === undefined
              ? 20_000
              : remainingTimeoutMs(deadlineAt, 20_000),
        }
      ),
    deadlineAt
  );
  const response = rpcLogsResponseSchema.parse(raw);
  if (typeof response.result === "string") {
    if (response.status === "0" && /no (records|logs)/i.test(response.result)) {
      return { swaps: [], truncated: false };
    }
    throw new Error(
      `Blockscout logs error: ${response.message ?? response.result}`
    );
  }

  const swaps = response.result
    .map(parseRpcV2Swap)
    .filter((swap): swap is BlockscoutV2Swap => swap !== null);

  return {
    swaps,
    truncated: response.result.length >= 1_000,
  };
}

function parseRpcV2Swap(
  item: z.infer<typeof rpcLogSchema>
): BlockscoutV2Swap | null {
  const data = item.data.startsWith("0x") ? item.data.slice(2) : item.data;
  if (data.length < 64 * 4 || item.topics.length < 3) return null;

  try {
    const word = (index: number) =>
      BigInt(`0x${data.slice(index * 64, (index + 1) * 64)}`);
    const topicAddress = (topic: string | null | undefined) =>
      topic ? `0x${topic.slice(-40)}` : "";

    return {
      transactionHash: item.transactionHash,
      blockNumber: parseBlockNumber(item.blockNumber),
      timestamp: parseBlockNumber(item.timeStamp),
      amount0In: word(0),
      amount1In: word(1),
      amount0Out: word(2),
      amount1Out: word(3),
      sender: topicAddress(item.topics[1]),
      to: topicAddress(item.topics[2]),
    };
  } catch {
    return null;
  }
}

function parseV2Swap(
  item: z.infer<typeof logSchema>,
  timestamp: number
): BlockscoutV2Swap | null {
  if (!item.decoded?.method_call.startsWith("Swap(")) return null;
  const params = new Map(item.decoded.parameters.map((parameter) => [parameter.name, parameter.value]));

  try {
    return {
      transactionHash: item.transaction_hash,
      blockNumber: item.block_number,
      timestamp,
      amount0In: BigInt(params.get("amount0In") ?? ""),
      amount1In: BigInt(params.get("amount1In") ?? ""),
      amount0Out: BigInt(params.get("amount0Out") ?? ""),
      amount1Out: BigInt(params.get("amount1Out") ?? ""),
      sender: params.get("sender") ?? "",
      to: params.get("to") ?? "",
    };
  } catch {
    return null;
  }
}
