import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { curveAdapter } from "@/src/lib/dex";
import { formatEther, type Address } from "viem";
import { checkRateLimit, RATE_LIMITS } from "@/src/lib/security/rate-limit";

const querySchema = z.object({
  token: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, { ...RATE_LIMITS.onchainRead, bucket: "curve" });
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid token address" }, { status: 400 });
  }

  const token = parsed.data.token as Address;

  try {
    const [curve, price] = await Promise.all([
      curveAdapter.getCurveState(token),
      curveAdapter.getCurrentPrice(token).catch(() => 0n),
    ]);

    return NextResponse.json({
      token,
      curve: {
        virtualEth: curve.virtualEth.toString(),
        realEth: curve.realEth.toString(),
        realEthFormatted: formatEther(curve.realEth),
        tokenReserve: curve.tokenReserve.toString(),
        raiseTarget: curve.raiseTarget.toString(),
        raiseTargetFormatted: formatEther(curve.raiseTarget),
        progressPct:
          curve.raiseTarget > 0n
            ? Number((curve.realEth * 10000n) / curve.raiseTarget) / 100
            : 0,
        readyToGraduate: curve.readyToGraduate,
        graduated: curve.graduated,
        creator: curve.creator,
      },
      priceWei: price.toString(),
      priceEth: formatEther(price),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
