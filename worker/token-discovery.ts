import { type Address, type PublicClient } from "viem";
import { prisma } from "../src/lib/db";
import { ROBINFUN_FACTORY_ABI } from "../src/lib/dex/abi/robinfun-factory";
import { ROBINFUN_TOKEN_ABI } from "../src/lib/dex/abi/robinfun-token";
import { ROBINFUN_FACTORIES } from "../src/config/contracts";
import { getBlockscoutTokenMarketData } from "../src/lib/blockscout/market-data";
import { safeErrorMessage } from "./error-message";

// Concurrency cap for onchain reads during enumeration/metadata fetch.
// Robinhood Chain RPC has not been load-tested for burst eth_call volume,
// so we chunk reads instead of firing all of them at once.
const READ_CONCURRENCY = Number(process.env.TOKEN_DISCOVERY_CONCURRENCY ?? 5);

interface CurveTuple {
  virtualEth: bigint;
  realEth: bigint;
  tokenReserve: bigint;
  raiseTarget: bigint;
  lpEth: bigint;
  treasuryEth: bigint;
  k: bigint;
  readyToGraduate: boolean;
  graduated: boolean;
  creator: Address;
  feeRecipient: Address;
}

/**
 * Run fn over items with a bounded number of concurrent in-flight calls,
 * tolerating individual failures (returns undefined for failed items).
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<Array<R | undefined>> {
  const results: Array<R | undefined> = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = await fn(items[index], index);
      } catch (err) {
        console.error(`[token-discovery] item ${index} failed: ${safeErrorMessage(err)}`);
        results[index] = undefined;
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function enumerateFactoryTokens(client: PublicClient, factory: Address): Promise<Address[]> {
  const length = (await client.readContract({
    address: factory,
    abi: ROBINFUN_FACTORY_ABI,
    functionName: "allTokensLength",
  })) as bigint;

  const count = Number(length);
  if (count <= 0) return [];

  const indexes = Array.from({ length: count }, (_, i) => i);
  const tokens = await mapWithConcurrency(indexes, READ_CONCURRENCY, async (i) => {
    const token = (await client.readContract({
      address: factory,
      abi: ROBINFUN_FACTORY_ABI,
      functionName: "allTokens",
      args: [BigInt(i)],
    })) as Address;
    return token;
  });

  return tokens.filter((t): t is Address => typeof t === "string");
}

async function readCurveState(client: PublicClient, factory: Address, token: Address): Promise<CurveTuple> {
  const result = (await client.readContract({
    address: factory,
    abi: ROBINFUN_FACTORY_ABI,
    functionName: "curves",
    args: [token],
  })) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean, boolean, Address, Address];

  const [
    virtualEth,
    realEth,
    tokenReserve,
    raiseTarget,
    lpEth,
    treasuryEth,
    k,
    readyToGraduate,
    graduated,
    creator,
    feeRecipient,
  ] = result;

  return {
    virtualEth,
    realEth,
    tokenReserve,
    raiseTarget,
    lpEth,
    treasuryEth,
    k,
    readyToGraduate,
    graduated,
    creator,
    feeRecipient,
  };
}

async function upsertTokenMetadata(
  client: PublicClient,
  factory: Address,
  token: Address,
  chainId: number
) {
  const address = token.toLowerCase();
  const [existing, curveState, indexedMarket] = await Promise.all([
    prisma.tokenMetadata.findUnique({ where: { address } }),
    readCurveState(client, factory, token),
    getBlockscoutTokenMarketData(address, { timeoutMs: 5_000 }).catch(
      () => null
    ),
  ]);

  // name/symbol/decimals are immutable for an ERC-20; only fetch once.
  let name = existing?.name;
  let symbol = existing?.symbol;
  let decimals = existing?.decimals;
  let totalSupply = existing?.totalSupply ?? undefined;

  if (!existing) {
    const [fetchedName, fetchedSymbol, fetchedDecimals, fetchedTotalSupply] = await Promise.all([
      client.readContract({ address: token, abi: ROBINFUN_TOKEN_ABI, functionName: "name" }),
      client.readContract({ address: token, abi: ROBINFUN_TOKEN_ABI, functionName: "symbol" }),
      client.readContract({ address: token, abi: ROBINFUN_TOKEN_ABI, functionName: "decimals" }),
      client.readContract({ address: token, abi: ROBINFUN_TOKEN_ABI, functionName: "totalSupply" }),
    ]);
    name = fetchedName as string;
    symbol = fetchedSymbol as string;
    decimals = Number(fetchedDecimals);
    totalSupply = (fetchedTotalSupply as bigint).toString();
  }

  if (name === undefined || symbol === undefined || decimals === undefined) {
    throw new Error(`Incomplete ERC-20 metadata for token ${token}`);
  }
  const volume24hUsd =
    indexedMarket?.volume24hUsd === null ||
    indexedMarket?.volume24hUsd === undefined
      ? existing?.volume24hUsd ?? undefined
      : String(indexedMarket.volume24hUsd);

  let pairAddress: string | undefined = existing?.pairAddress ?? undefined;
  if (curveState.graduated && !pairAddress) {
    try {
      const pair = (await client.readContract({
        address: token,
        abi: ROBINFUN_TOKEN_ABI,
        functionName: "pair",
      })) as Address;
      pairAddress = pair;
    } catch (err) {
      console.error(
        `[token-discovery] failed to read pair() for ${token}: ${safeErrorMessage(err)}`
      );
    }
  }

  await prisma.tokenMetadata.upsert({
    where: { address },
    update: {
      name,
      symbol,
      decimals,
      creator: curveState.creator,
      isRobinFun: true,
      dexLive: curveState.graduated,
      pairAddress,
      totalSupply,
      volume24hUsd,
      factoryAddress: factory.toLowerCase(),
      chainId,
    },
    create: {
      address,
      chainId,
      name,
      symbol,
      decimals,
      creator: curveState.creator,
      isRobinFun: true,
      dexLive: curveState.graduated,
      pairAddress,
      totalSupply,
      volume24hUsd,
      factoryAddress: factory.toLowerCase(),
    },
  });
}

/**
 * Enumerate every RobinFun token created across all configured factories
 * (V1-V5) and upsert its metadata into the TokenMetadata table.
 *
 * Resilient by design: a failure fetching one token's metadata is logged
 * and skipped, it never aborts the whole run.
 */
export async function runTokenDiscovery(client: PublicClient, chainId: number): Promise<void> {
  console.log(`[token-discovery] starting discovery across ${ROBINFUN_FACTORIES.length} factories`);
  let discovered = 0;
  let upserted = 0;
  let failed = 0;

  for (const factory of ROBINFUN_FACTORIES) {
    let tokens: Address[];
    try {
      tokens = await enumerateFactoryTokens(client, factory);
    } catch (err) {
      console.error(
        `[token-discovery] failed to enumerate factory ${factory}: ${safeErrorMessage(err)}`
      );
      continue;
    }

    discovered += tokens.length;
    console.log(`[token-discovery] factory ${factory}: ${tokens.length} token(s)`);

    await mapWithConcurrency(tokens, READ_CONCURRENCY, async (token) => {
      try {
        await upsertTokenMetadata(client, factory, token, chainId);
        upserted++;
      } catch (err) {
        failed++;
        console.error(
          `[token-discovery] skipping token ${token} (factory ${factory}): ${safeErrorMessage(err)}`
        );
      }
    });
  }

  console.log(`[token-discovery] done. discovered=${discovered} upserted=${upserted} failed=${failed}`);
}
