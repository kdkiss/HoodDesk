import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getPublicClient } from "@/src/lib/chain/client";
import { blockscoutGet } from "@/src/lib/blockscout/client";
import { checkRateLimit, RATE_LIMITS } from "@/src/lib/security/rate-limit";

const querySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

interface BlockscoutTokenBalance {
  token: { address_hash: string };
  value: string;
}

/** Lightweight wallet balance lookup for token selection. Unlike the full
 * portfolio route, this deliberately avoids pricing and cost-basis work. */
export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, { ...RATE_LIMITS.onchainRead, bucket: "portfolio-balances" });
  if (limited) return limited;

  const parsed = querySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) return NextResponse.json({ error: "Invalid address" }, { status: 400 });

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
  const address = parsed.data.address as `0x${string}`;

  try {
    const [ethBalance, tokenBalances] = await Promise.all([
      getPublicClient(chainId).getBalance({ address }),
      blockscoutGet<BlockscoutTokenBalance[]>(`/addresses/${address}/token-balances`).catch(() => []),
    ]);

    const holdings = (Array.isArray(tokenBalances) ? tokenBalances : []).map((holding) => ({
      token: { address: holding.token.address_hash },
      walletBalance: holding.value,
    }));

    return NextResponse.json({ ethBalance: ethBalance.toString(), holdings });
  } catch (error) {
    console.error("Failed to load wallet balances", error);
    return NextResponse.json({ error: "Unable to load wallet balances" }, { status: 500 });
  }
}
