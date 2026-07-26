import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSwapQuote } from "@/src/lib/dex";
import { type Address } from "viem";
import { checkRateLimit, RATE_LIMITS } from "@/src/lib/security/rate-limit";
import { env } from "@/src/config/env";

const bodySchema = z.object({
  tokenIn: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  tokenOut: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amountIn: z.string().regex(/^\d+$/),
  slippageBps: z.number().int().min(1).max(10000).optional(),
});

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, { ...RATE_LIMITS.onchainRead, bucket: "quote" });
  if (limited) return limited;

  try {
    const body = await req.json();
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }

    const { tokenIn, tokenOut, amountIn, slippageBps } = parsed.data;
    const quote = await getSwapQuote(
      tokenIn as Address,
      tokenOut as Address,
      BigInt(amountIn),
      slippageBps ?? Number(process.env.DEFAULT_SLIPPAGE_BPS ?? 100)
    );
    if (quote.estimatedPriceImpactBps > env.MAX_PRICE_IMPACT_BPS) {
      return NextResponse.json(
        {
          error: `Price impact too high (${(quote.estimatedPriceImpactBps / 100).toFixed(2)}% exceeds ${(env.MAX_PRICE_IMPACT_BPS / 100).toFixed(2)}%)`,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      quote: {
        tokenIn: quote.tokenIn,
        tokenOut: quote.tokenOut,
        amountIn: quote.amountIn.toString(),
        expectedAmountOut: quote.expectedAmountOut.toString(),
        minimumAmountOut: quote.minimumAmountOut.toString(),
        displayPrice: quote.displayPrice,
        inversePrice: quote.inversePrice,
        estimatedPriceImpactBps: quote.estimatedPriceImpactBps,
        route: {
          kind: quote.route.kind,
          path: quote.route.path,
          factoryAddress: quote.route.factoryAddress,
          routerAddress: quote.route.routerAddress,
        },
        approvalTarget: quote.approvalTarget,
        expiresAt: quote.expiresAt,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
