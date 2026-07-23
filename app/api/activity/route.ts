import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { blockscoutGet } from "@/src/lib/blockscout/client";
import { prisma } from "@/src/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/src/lib/security/rate-limit";

const querySchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

interface BlockscoutTx {
  hash: string;
  block: number;
  timestamp: string;
  from: { hash: string };
  to: { hash: string } | null;
  value: string;
  status: string;
  gas_used: string;
  method: string | null;
}

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, { ...RATE_LIMITS.onchainRead, bucket: "activity" });
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }

  const address = parsed.data.address.toLowerCase();
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);

  try {
    const [onchain, tracked] = await Promise.all([
      blockscoutGet<{ items: BlockscoutTx[] }>(
        `/addresses/${address}/transactions`
      ).catch(() => ({ items: [] })),
      prisma.trackedTransaction.findMany({
        where: { walletAddress: address, chainId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const transactions = onchain.items.map((tx: any) => ({
      hash: tx.hash,
      blockNumber: tx.block,
      timestamp: tx.timestamp,
      from: tx.from.hash,
      to: tx.to?.hash ?? null,
      value: tx.value,
      status: tx.status === "ok" ? "confirmed" : tx.status === "error" ? "reverted" : "unknown",
      gasUsed: tx.gas_used,
      method: tx.method,
      explorerUrl: `https://robinhoodchain.blockscout.com/tx/${tx.hash}`,
    }));

    return NextResponse.json({ transactions, tracked });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
