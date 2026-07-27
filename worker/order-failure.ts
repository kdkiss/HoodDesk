import { prisma } from "../src/lib/db";
import { isTransientRpcError } from "../src/lib/chain/retry";
import { safeErrorMessage } from "./error-message";

const RPC_DEFERRED_EVENT_COOLDOWN_MS = 5 * 60 * 1000;

export type OrderErrorDisposition = "deferred" | "failed";

/**
 * Transient provider failures must not change order state. An ARMED order will
 * be checked again, while an EXECUTING order stays locked if submission may
 * already have occurred. Deterministic safety failures remain terminal.
 */
export async function handleOrderProcessingError(
  orderId: string,
  error: unknown,
  now = new Date()
): Promise<OrderErrorDisposition> {
  const summary = safeErrorMessage(error);

  if (isTransientRpcError(error)) {
    console.warn(`Order ${orderId} deferred after a temporary RPC failure: ${summary}`);

    const latestDeferredEvent = await prisma.orderEvent.findFirst({
      where: { orderId, eventType: "RPC_DEFERRED" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const shouldRecordEvent =
      !latestDeferredEvent ||
      now.getTime() - latestDeferredEvent.createdAt.getTime() >=
        RPC_DEFERRED_EVENT_COOLDOWN_MS;

    if (shouldRecordEvent) {
      await prisma.orderEvent.create({
        data: {
          orderId,
          eventType: "RPC_DEFERRED",
          message:
            "Order processing deferred after a temporary RPC failure; existing state preserved",
        },
      });
    }
    return "deferred";
  }

  console.error(`Order ${orderId} failed: ${summary}`);
  await prisma.automatedOrder.update({
    where: { id: orderId },
    data: {
      status: "FAILED",
      failureReason: summary,
    },
  });
  await prisma.orderEvent.create({
    data: {
      orderId,
      eventType: "FAILED",
      message: `Order failed: ${summary}`,
    },
  });
  return "failed";
}
