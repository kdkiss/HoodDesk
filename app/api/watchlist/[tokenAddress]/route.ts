import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAddress } from "viem";
import { prisma } from "@/src/lib/db";
import { verifyAndConsumeAuthSignature } from "@/src/lib/security/authorization";
import { checkRateLimit, RATE_LIMITS } from "@/src/lib/security/rate-limit";

const addressSchema = z.string().refine((val) => isAddress(val), {
  message: "Invalid address",
});

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ tokenAddress: string }> }
) {
  const limited = checkRateLimit(req, { ...RATE_LIMITS.mutation, bucket: "watchlist-delete" });
  if (limited) return limited;

  const { tokenAddress } = await params;
  const { searchParams } = new URL(req.url);
  const owner = searchParams.get("owner");

  const parsedToken = addressSchema.safeParse(tokenAddress);
  const parsedOwner = addressSchema.safeParse(owner);
  if (!parsedToken.success || !parsedOwner.success) {
    return NextResponse.json(
      { error: "Valid tokenAddress path param and owner query param required" },
      { status: 400 }
    );
  }

  let body: { signature?: string; timestamp?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Signature and timestamp are required" }, { status: 400 });
  }
  if (!body.signature || !body.timestamp) {
    return NextResponse.json({ error: "Signature and timestamp are required" }, { status: 400 });
  }

  const auth = await verifyAndConsumeAuthSignature(
    "Remove from Watchlist",
    parsedOwner.data,
    body.timestamp,
    { tokenAddress: parsedToken.data.toLowerCase() },
    body.signature as `0x${string}`
  );
  if (!auth.valid) return NextResponse.json({ error: auth.error }, { status: 401 });

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);

  try {
    await prisma.watchlist.deleteMany({
      where: {
        ownerAddress: parsedOwner.data.toLowerCase(),
        tokenAddress: parsedToken.data.toLowerCase(),
        chainId,
      },
    });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to remove watchlist entry", err);
    return NextResponse.json(
      { error: "Unable to remove watchlist entry" },
      { status: 500 }
    );
  }
}
