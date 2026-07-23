import { prisma } from "@/src/lib/db";

import { processOrder } from "./index";

/**
 * Checks DCA orders due for execution and triggers them.
 */
export async function processDcaOrders() {
  const now = new Date();
  const dcaOrders = await prisma.automatedOrder.findMany({
    where: {
      orderType: "DCA",
      status: "ARMED",
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
  });

  for (const order of dcaOrders) {
    const metadata = order.metadata as {
      totalIterations: number;
      currentIteration: number;
      startAt: string;
      gasOnDestination?: boolean;
      priceCondition?: { direction: "gte" | "lte"; price: string };
    } | null;

    if (!metadata) continue;

    const startAt = new Date(metadata.startAt);
    const intervalMs =
      order.orderSubtype === "MINUTELY"
        ? 60 * 1000
        : order.orderSubtype === "HOURLY"
          ? 60 * 60 * 1000
          : order.orderSubtype === "DAILY"
            ? 24 * 60 * 60 * 1000
            : order.orderSubtype === "WEEKLY"
              ? 7 * 24 * 60 * 60 * 1000
              : 30 * 24 * 60 * 60 * 1000;

    const nextExecutionTime = new Date(startAt.getTime() + metadata.currentIteration * intervalMs);
    if (nextExecutionTime > now) continue;

    // Execute the DCA iteration
    try {
      // Optional price gate: buy DCA -> "lte" cap, sell DCA -> "gte" floor.
      // When present, processOrder evaluates the onchain price before trading;
      // "not-triggered" means the iteration is skipped (slot is consumed).
      const hasPriceCondition = Boolean(metadata.priceCondition);
      const outcome = await processOrder({
        ...order,
        triggerPrice: hasPriceCondition ? metadata.priceCondition!.price : "0",
        triggerDirection: hasPriceCondition ? metadata.priceCondition!.direction : "gte",
      });

      if (outcome.result === "not-triggered" && hasPriceCondition) {
        const skippedIteration = metadata.currentIteration + 1;
        await prisma.automatedOrder.update({
          where: { id: order.id },
          data: {
            metadata: {
              ...metadata,
              currentIteration: skippedIteration,
            },
            status: skippedIteration >= metadata.totalIterations ? "COMPLETED" : "ARMED",
          },
        });
        await prisma.orderEvent.create({
          data: {
            orderId: order.id,
            eventType: "ITERATION_SKIPPED",
            message: `DCA iteration ${skippedIteration}/${metadata.totalIterations} skipped: price outside ${metadata.priceCondition!.direction} ${metadata.priceCondition!.price}`,
          },
        });
        continue;
      }

      // Only successful on-chain execution counts as an iteration. Reverts
      // and missing-wallet leave the iteration counter untouched so the
      // schedule retries on the next poll.
      if (outcome.result !== "success") {
        if (outcome.result === "reverted") {
          await prisma.orderEvent.create({
            data: {
              orderId: order.id,
              eventType: "FAILED",
              message: `DCA iteration reverted on-chain (tx ${outcome.txHash}); will retry`,
            },
          });
        }
        continue;
      }

      // Update iteration count
      const updatedIteration = metadata.currentIteration + 1;
      await prisma.automatedOrder.update({
        where: { id: order.id },
        data: {
          metadata: {
            ...metadata,
            currentIteration: updatedIteration,
          },
          status: updatedIteration >= metadata.totalIterations ? "COMPLETED" : "ARMED",
        },
      });

      await prisma.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: "ITERATION_COMPLETED",
          message: `DCA iteration ${updatedIteration}/${metadata.totalIterations} executed`,
        },
      });
    } catch (err) {
      console.error(`DCA order ${order.id} iteration failed:`, err);
      // Re-arm so a transient failure (RPC 429, network error) doesn't strand
      // the order in EXECUTING forever — the iteration retries next poll.
      await prisma.automatedOrder.update({
        where: { id: order.id },
        data: { status: "ARMED" },
      });
      await prisma.orderEvent.create({
        data: {
          orderId: order.id,
          eventType: "FAILED",
          message: `DCA iteration failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      });
    }
  }
}