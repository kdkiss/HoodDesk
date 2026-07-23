"use server";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { type Address, getAddress, formatEther, formatUnits } from "viem";
import { checkRateLimit, RATE_LIMITS } from "@/src/lib/security/rate-limit";
import { getWalletTrackedTrades } from "@/src/lib/portfolio/tracked-trades";
import { computeCostBasis, costBasisForHolding } from "@/src/lib/portfolio/cost-basis";
import { curveAdapter } from "@/src/lib/dex";
import { getPublicClient } from "@/src/lib/chain/client";
import { erc20Abi } from "viem";

const querySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

interface CostBasisResponse {
  token: Address;
  costBasisEth: string | null; // ETH, display units
  costBasisUsd: null;
  tokensHeld: string | null; // token, display units
}

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, RATE_LIMITS.onchainRead);
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const address = getAddress(parsed.data.address);
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);

  try {
    const client = getPublicClient(chainId);
    const trackedTrades = await getWalletTrackedTrades(address, chainId);

    const tradesByToken = new Map<Address, typeof trackedTrades>();
    for (const trade of trackedTrades) {
      const tokenAddr = getAddress(trade.tokenAddress);
      const list = tradesByToken.get(tokenAddr) ?? [];
      list.push(trade);
      tradesByToken.set(tokenAddr, list);
    }

    const tradedTokens = Array.from(tradesByToken.keys());
    const multicallResults = await client.multicall({
      contracts: tradedTokens.map(token => ({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address]
      }))
    });

    const tokenBalances: Record<Address, bigint> = {};
    tradedTokens.forEach((token, idx) => {
      const res = multicallResults[idx];
      if (res.status === 'success') {
        tokenBalances[token] = res.result as bigint;
      } else {
        tokenBalances[token] = 0n;
      }
    });

    const responses: CostBasisResponse[] = [];

    for (const [tokenAddress, balance] of Object.entries(tokenBalances)) {
      const tokenAddr = getAddress(tokenAddress);
      const isRobinFun = await curveAdapter.isRobinFunToken(tokenAddr);
      if (!isRobinFun) continue;

      const tokenInfo = await curveAdapter.getTokenInfo(tokenAddr);
      const actualBalance = balance;
      const tokenTrades = tradesByToken.get(tokenAddr) ?? [];
      const accumulation = computeCostBasis(tokenTrades);
      const heldCostBasis = costBasisForHolding(accumulation, actualBalance);

      responses.push({
        token: tokenAddr,
        costBasisEth: heldCostBasis ? formatEther(heldCostBasis.costBasisWei) : null,
        costBasisUsd: null,
        tokensHeld: actualBalance > 0n ? formatUnits(actualBalance, tokenInfo.decimals) : null,
      });
    }

    return NextResponse.json(responses);
  } catch (err) {
    if (err instanceof Error && err.message.includes("Token is not a RobinFun token")) {
      return NextResponse.json({ error: "Token not supported" }, { status: 404 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
