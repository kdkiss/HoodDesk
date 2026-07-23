import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAddress } from "viem";
import { verifyAndConsumeAuthSignature } from "@/src/lib/security/authorization";
import { prisma } from "@/src/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/src/lib/security/rate-limit";
import { env } from "@/src/config/env";

const createOrderSchema = z.object({
  ownerAddress: z.string().refine(isAddress, "Invalid address"),
  tokenIn: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  tokenOut: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amountIn: z.string().regex(/^\d+$/),
  triggerPrice: z.string().regex(/^\d+(\.\d+)?$/),
  triggerDirection: z.enum(["gte", "lte"]),
  orderType: z.enum(["LIMIT_BUY", "TAKE_PROFIT", "STOP_LOSS"]),
  dexAdapterId: z.string().optional(),
  maximumSlippageBps: z.number().int().min(1).max(env.MAX_SLIPPAGE_BPS),
  maximumPriceImpactBps: z.number().int().min(1).max(env.MAX_PRICE_IMPACT_BPS),
  deadlineSeconds: z.number().int().min(30).max(3_600),
  maximumGasPriceGwei: z.string().optional(),
  expiresAt: z.string().datetime().optional(),
  signature: z.string(),
  timestamp: z.number(),
});

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, { ...RATE_LIMITS.standard, bucket: "orders-get" });
  if (limited) return limited;

  const { searchParams } = new URL(req.url);
  const owner = searchParams.get("owner");
  const status = searchParams.get("status");

  try {
    const orders = await prisma.automatedOrder.findMany({
      where: {
        ...(owner ? { ownerAddress: owner } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ orders });
  } catch (err) {
    console.error("Failed to list automated orders", err);
    return NextResponse.json(
      { error: "Unable to load automated orders" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, { ...RATE_LIMITS.mutation, bucket: "orders-post" });
  if (limited) return limited;

  try {
    const body = await req.json();
    const parsed = createOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid order", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    if (process.env.AUTOMATED_ORDERS_ENABLED !== "true") {
      return NextResponse.json({ error: "Automated orders are disabled on this deployment" }, { status: 503 });
    }

    const data = parsed.data;
    const { signature, timestamp, ...authorizationPayload } = data;
    const auth = await verifyAndConsumeAuthSignature(
      "Create Order",
      data.ownerAddress,
      timestamp,
      authorizationPayload,
      signature as `0x${string}`
    );
    if (!auth.valid) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);

    const order = await prisma.automatedOrder.create({
      data: {
        ownerAddress: data.ownerAddress.toLowerCase(),
        executionWallet: process.env.EXECUTION_WALLET_ADDRESS ?? "",
        chainId,
        dexAdapterId: data.dexAdapterId ?? "robinfun-v2",
        tokenIn: data.tokenIn.toLowerCase(),
        tokenOut: data.tokenOut.toLowerCase(),
        amountIn: data.amountIn,
        triggerPrice: data.triggerPrice,
        triggerDirection: data.triggerDirection,
        orderType: data.orderType,
        maximumSlippageBps: data.maximumSlippageBps,
        maximumPriceImpactBps: data.maximumPriceImpactBps,
        deadlineSeconds: data.deadlineSeconds,
        maximumGasPriceGwei: data.maximumGasPriceGwei,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        status: "ARMED",
      },
    });

    await prisma.orderEvent.create({
      data: {
        orderId: order.id,
        eventType: "CREATED",
        message: `Order created: ${data.orderType} ${data.amountIn} at ${data.triggerPrice}`,
      },
    });

    return NextResponse.json({ order });
  } catch (err) {
    console.error("Failed to create automated order", err);
    return NextResponse.json(
      { error: "Unable to create automated order" },
      { status: 500 }
    );
  }
}
