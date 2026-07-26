import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPublicClient } from "@/src/lib/chain/client";
import { blockscoutGet } from "@/src/lib/blockscout/client";
import { formatEther, type Address } from "viem";
import { checkRateLimit, RATE_LIMITS } from "@/src/lib/security/rate-limit";
import { WETH } from "@/src/config/contracts";
import { getSwapQuote } from "@/src/lib/dex";
import { getWalletTrackedTrades } from "@/src/lib/portfolio/tracked-trades";
import {
  computeCostBasis,
  costBasisForHolding,
  computeUnrealizedPnl,
} from "@/src/lib/portfolio/cost-basis";
import { getBlockscoutEthUsd } from "@/src/lib/blockscout/market-data";

const querySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

interface BlockscoutTokenBalance {
  token: {
    address_hash: string;
    name: string;
    symbol: string;
    decimals: string;
    exchange_rate: string | null;
  };
  value: string;
}

/**
 * Estimate the current market value (in wei of ETH) of a token balance by
 * quoting a sell of that exact balance through the configured DEX/curve
 * adapters. Returns null if no live quote is obtainable (e.g. token not
 * live/graduated, zero liquidity, or RPC failure) — unrealized P&L must
 * then be reported as unavailable rather than guessed.
 */
async function estimateCurrentValueWei(
  tokenAddress: Address,
  balance: bigint
): Promise<bigint | null> {
  if (balance <= 0n) return 0n;
  try {
    const quote = await getSwapQuote(tokenAddress, WETH, balance, 100);
    return quote.expectedAmountOut;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, { ...RATE_LIMITS.onchainRead, bucket: "portfolio" });
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const address = parsed.data.address as Address;
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);

  try {
    const client = getPublicClient(chainId);

    const [ethBalance, tokenBalances, trackedTrades, ethUsd] = await Promise.all([
      client.getBalance({ address }),
      blockscoutGet<BlockscoutTokenBalance[]>(
        `/addresses/${address}/token-balances`
      ).catch(() => []),
      getWalletTrackedTrades(address.toLowerCase(), chainId).catch(() => []),
      getBlockscoutEthUsd().catch(() => null),
    ]);

    const tokenBalanceList = Array.isArray(tokenBalances) ? tokenBalances : [];

    // Group HoodDesk's own tracked trade history per token so cost basis is
    // computed ONLY from recorded transactions — never invented from the
    // live wallet balance.
    const tradesByToken = new Map<string, typeof trackedTrades>();
    for (const trade of trackedTrades) {
      const list = tradesByToken.get(trade.tokenAddress) ?? [];
      list.push(trade);
      tradesByToken.set(trade.tokenAddress, list);
    }

    const holdings = await Promise.all(
      tokenBalanceList.map(async (tb) => {
        const decimals = Number(tb.token.decimals);
        const tokenAddress = tb.token.address_hash.toLowerCase();
        const walletBalance = tb.value; // raw smallest-unit string, bigint-safe

        const balanceFormatted = (
          Number(tb.value) / Math.pow(10, decimals)
        ).toString();

        const estimatedMarketValueUsd = tb.token.exchange_rate
          ? (
              (Number(tb.value) / Math.pow(10, decimals)) *
              Number(tb.token.exchange_rate)
            ).toFixed(2)
          : null;

        let actualBalance: bigint | null = null;
        try {
          actualBalance = BigInt(tb.value);
        } catch {
          actualBalance = null;
        }

        const tokenTrades = tradesByToken.get(tokenAddress) ?? [];
        const accumulation = computeCostBasis(tokenTrades);

        const heldCostBasis =
          actualBalance !== null ? costBasisForHolding(accumulation, actualBalance) : null;

        const trackedCostBasis = heldCostBasis
          ? { wei: heldCostBasis.costBasisWei.toString(), eth: formatEther(heldCostBasis.costBasisWei) }
          : null;

        // Realized P&L is only meaningful once at least one tracked buy exists.
        const realizedPnl = accumulation.hasAnyBuyHistory
          ? {
              wei: accumulation.realizedPnlWei.toString(),
              eth: formatEther(accumulation.realizedPnlWei),
            }
          : null;

        // Unrealized P&L = current market value of the held balance minus
        // its tracked cost basis, both in wei. Requires a live quote AND a
        // tracked cost basis — if either is unavailable, report null rather
        // than approximate.
        let unrealizedPnl: { wei: string; eth: string } | null = null;
        if (heldCostBasis && actualBalance !== null) {
          const currentValueWei = await estimateCurrentValueWei(
            tb.token.address_hash as Address,
            actualBalance
          );
          const diff = computeUnrealizedPnl({
            currentValueWei,
            costBasisWei: heldCostBasis.costBasisWei,
          });
          if (diff !== null) {
            unrealizedPnl = { wei: diff.toString(), eth: formatEther(diff) };
          }
        }

        return {
          token: {
            address: tb.token.address_hash,
            name: tb.token.name,
            symbol: tb.token.symbol,
            decimals,
          },
          walletBalance,
          balanceFormatted,
          exchangeRateUsd: tb.token.exchange_rate,
          estimatedMarketValue: estimatedMarketValueUsd,
          // Backward-compatible alias for existing consumers.
          valueUsd: estimatedMarketValueUsd,
          trackedCostBasis,
          realizedPnl,
          unrealizedPnl,
          costBasisUnavailable: !heldCostBasis,
        };
      })
    );

    return NextResponse.json({
      address,
      ethBalance: ethBalance.toString(),
      ethBalanceFormatted: formatEther(ethBalance),
      ethUsd,
      holdings,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
