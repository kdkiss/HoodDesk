"use server";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAddress } from "viem";
import { verifyAndConsumeAuthSignature } from "@/src/lib/security/authorization";
import { prisma } from "@/src/lib/db";
import { checkRateLimit, RATE_LIMITS } from "@/src/lib/security/rate-limit";
import { env } from "@/src/config/env";

const MAX_DCA_ITERATIONS = 10_000n;

const dcaOrderSchema = z.object({
  ownerAddress: z.string().refine(isAddress, "Invalid address"),
  tokenIn: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  tokenOut: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  amountPerInterval: z.string().regex(/^[1-9]\d*$/),
  totalAmount: z.string().regex(/^[1-9]\d*$/),
  frequency: z.enum(["MINUTELY", "HOURLY", "DAILY", "WEEKLY", "MONTHLY"]),
  durationMonths: z.number().int().min(1).max(12),
  startAt: z.string().datetime(),
  dexAdapterId: z.string().optional(),
  maximumSlippageBps: z.number().int().min(1).max(env.MAX_SLIPPAGE_BPS),
  maximumPriceImpactBps: z.number().int().min(1).max(env.MAX_PRICE_IMPACT_BPS),
  gasOnDestination: z.boolean().optional(),
  // Optional price gate per iteration, in ETH per token (ether units):
  // buy DCA uses "lte" (only buy at or below cap), sell DCA uses "gte"
  // (only sell at or above floor). Iterations outside the range are skipped.
  priceCondition: z
    .object({
      direction: z.enum(["gte", "lte"]),
      price: z.string().regex(/^\d+(\.\d+)?$/),
    })
    .optional(),
  signature: z.string(),
  timestamp: z.number(),
}).superRefine((data, ctx) => {
  const amountPerInterval = BigInt(data.amountPerInterval);
  const totalAmount = BigInt(data.totalAmount);
  const totalIterations = totalAmount / amountPerInterval;

  if (totalAmount < amountPerInterval) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["totalAmount"], message: "Total amount must cover at least one interval" });
  }
  if (totalIterations > MAX_DCA_ITERATIONS) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["totalAmount"], message: "DCA order has too many iterations" });
  }
});

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, { ...RATE_LIMITS.mutation, bucket: "orders-dca" });
  if (limited) return limited;

  try {
    const body = await req.json();
    const parsed = dcaOrderSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid DCA order", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    if (process.env.AUTOMATED_ORDERS_ENABLED !== "true") {
      return NextResponse.json({ error: "Automated orders are disabled on this deployment" }, { status: 503 });
    }

    const data = parsed.data;
    const { signature, timestamp, ...authorizationPayload } = data;
    const auth = await verifyAndConsumeAuthSignature(
      "Create DCA Order",
      data.ownerAddress,
      timestamp,
      authorizationPayload,
      signature as `0x${string}`
    );
    if (!auth.valid) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
    const startAt = new Date(data.startAt);
    const totalIterations = Number(BigInt(data.totalAmount) / BigInt(data.amountPerInterval));

    const order = await prisma.automatedOrder.create({
      data: {
        ownerAddress: data.ownerAddress.toLowerCase(),
        executionWallet: process.env.EXECUTION_WALLET_ADDRESS ?? "",
        chainId,
        dexAdapterId: data.dexAdapterId ?? "robinfun-v2",
        tokenIn: data.tokenIn.toLowerCase(),
        tokenOut: data.tokenOut.toLowerCase(),
        amountIn: data.amountPerInterval,
        orderType: "DCA",
        orderSubtype: data.frequency,
        maximumSlippageBps: data.maximumSlippageBps,
        maximumPriceImpactBps: data.maximumPriceImpactBps,
        deadlineSeconds: 300, // 5 minutes per iteration
        status: "ARMED",
        expiresAt: new Date(startAt.getTime() + data.durationMonths * 30 * 24 * 60 * 60 * 1000),
        metadata: {
          totalAmount: data.totalAmount,
          totalIterations,
          currentIteration: 0,
          startAt: data.startAt,
          gasOnDestination: data.gasOnDestination,
          priceCondition: data.priceCondition,
        },
      },
    });

    await prisma.orderEvent.create({
      data: {
        orderId: order.id,
        eventType: "CREATED",
        message: `DCA order created: ${data.amountPerInterval} ${data.tokenIn} -> ${data.tokenOut} (${data.frequency}, ${totalIterations} iterations)`,
      },
    });

    return NextResponse.json({ order });
  } catch (err) {
    console.error("Failed to create DCA order", err);
    return NextResponse.json(
      { error: "Unable to create DCA order" },
      { status: 500 }
    );
  }
}
