import { NextRequest, NextResponse } from "next/server";
import { getAddress, type Hex } from "viem";
import { z } from "zod";
import { prisma } from "@/src/lib/db";
import { verifySwapTransaction } from "@/src/lib/portfolio/verified-swap";
import { checkRateLimit, RATE_LIMITS } from "@/src/lib/security/rate-limit";

const bodySchema = z.object({
  transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  tokenAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, {
    ...RATE_LIMITS.mutation,
    bucket: "track-transaction",
  });
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid transaction hash or token address" },
      { status: 400 }
    );
  }

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);

  try {
    const verified = await verifySwapTransaction({
      chainId,
      transactionHash: parsed.data.transactionHash.toLowerCase() as Hex,
      expectedTokenAddress: getAddress(parsed.data.tokenAddress),
    });
    const metadata = {
      tokenAddress: verified.tokenAddress.toLowerCase(),
      tokenAmount: verified.tokenAmount.toString(),
      ethAmount: verified.ethAmount.toString(),
      timestampMs: verified.blockTimestampMs.toString(),
      source: "verified_receipt",
    };

    await prisma.trackedTransaction.upsert({
      where: { transactionHash: verified.transactionHash },
      create: {
        walletAddress: verified.walletAddress.toLowerCase(),
        chainId,
        transactionHash: verified.transactionHash,
        transactionType: verified.side === "buy" ? "BUY" : "SELL",
        status: "confirmed",
        blockNumber: verified.blockNumber.toString(),
        gasUsed: verified.gasUsed.toString(),
        metadata,
      },
      update: {
        walletAddress: verified.walletAddress.toLowerCase(),
        chainId,
        transactionType: verified.side === "buy" ? "BUY" : "SELL",
        status: "confirmed",
        blockNumber: verified.blockNumber.toString(),
        gasUsed: verified.gasUsed.toString(),
        metadata,
      },
    });

    return NextResponse.json({
      tracked: true,
      transactionHash: verified.transactionHash,
      walletAddress: verified.walletAddress,
      side: verified.side,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to verify transaction",
      },
      { status: 400 }
    );
  }
}
