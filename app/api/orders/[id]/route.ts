import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { verifyAndConsumeAuthSignature } from "@/src/lib/security/authorization";
import { checkRateLimit, RATE_LIMITS } from "@/src/lib/security/rate-limit";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = checkRateLimit(req, { ...RATE_LIMITS.standard, bucket: "orders-id-get" });
  if (limited) return limited;

  const { id } = await params;
  try {
    const order = await prisma.automatedOrder.findUnique({
      where: { id },
      include: { executions: true, events: { orderBy: { createdAt: "desc" } } },
    });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    return NextResponse.json({ order });
  } catch (err) {
    console.error("Failed to load automated order", err);
    return NextResponse.json(
      { error: "Unable to load automated order" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const limited = checkRateLimit(req, { ...RATE_LIMITS.mutation, bucket: "orders-id-patch" });
  if (limited) return limited;

  const { id } = await params;
  try {
    const body = await req.json();
    const { action, signature, timestamp } = body as { action: string; signature?: string; timestamp?: number };

    const order = await prisma.automatedOrder.findUnique({ where: { id } });
    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (!signature || !timestamp) {
      return NextResponse.json({ error: "Missing signature or timestamp" }, { status: 400 });
    }

    const authAction = action === "cancel" ? "Cancel Order" : action === "pause" ? "Pause Order" : action === "resume" ? "Resume Order" : "Modify Order";
    const auth = await verifyAndConsumeAuthSignature(
      authAction,
      order.ownerAddress,
      timestamp,
      { action, orderId: id },
      signature as `0x${string}`
    );
    if (!auth.valid) {
      return NextResponse.json({ error: auth.error }, { status: 401 });
    }

    // An EXECUTING order whose tx was never broadcast (worker crashed or the
    // RPC rejected the send) stays stuck forever. Allow cancel once it has
    // been EXECUTING for >10 minutes — by then any legitimately broadcast tx
    // would long have settled.
    const STUCK_EXECUTING_MS = 10 * 60 * 1000;
    const isStuckExecuting =
      order.status === "EXECUTING" &&
      order.triggeredAt != null &&
      Date.now() - order.triggeredAt.getTime() > STUCK_EXECUTING_MS;

    let newStatus = order.status;
    if (action === "cancel" && (!["EXECUTING", "CONFIRMED"].includes(order.status) || isStuckExecuting)) {
      newStatus = "CANCELLED";
    } else if (action === "pause" && order.status === "ARMED") {
      newStatus = "PAUSED";
    } else if (action === "resume" && order.status === "PAUSED") {
      newStatus = "ARMED";
    } else {
      return NextResponse.json(
        { error: `Cannot ${action} order in status ${order.status}` },
        { status: 400 }
      );
    }

    const updated = await prisma.automatedOrder.update({
      where: { id },
      data: { status: newStatus },
    });

    await prisma.orderEvent.create({
      data: {
        orderId: id,
        eventType: newStatus,
        message: `Order ${action}ed`,
      },
    });

    return NextResponse.json({ order: updated });
  } catch (err) {
    console.error("Failed to update automated order", err);
    return NextResponse.json(
      { error: "Unable to update automated order" },
      { status: 500 }
    );
  }
}
