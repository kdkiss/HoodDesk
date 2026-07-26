import { loadEnvFile } from "node:process";
import type { Address, Hex } from "viem";

try {
  loadEnvFile(".env");
} catch {
  // Deployed environments normally provide variables directly.
}

async function main() {
  const [
    { prisma },
    { getPublicClient },
    { DEX_ROUTER, WETH, isRobinFunFactory },
    { v2Adapter },
    { deriveSwapAmounts },
  ] = await Promise.all([
    import("../src/lib/db"),
    import("../src/lib/chain/client"),
    import("../src/config/contracts"),
    import("../src/lib/dex"),
    import("../src/lib/portfolio/swap-receipt"),
  ]);

  const executions = await prisma.orderExecution.findMany({
    where: {
      status: "CONFIRMED",
      transactionHash: { not: null },
      OR: [
        { actualTokenAmount: null },
        { actualEthAmount: null },
      ],
    },
    include: { order: true },
    orderBy: { createdAt: "asc" },
  });

  let updated = 0;
  let failed = 0;

  for (const execution of executions) {
    const order = execution.order;
    const client = getPublicClient(order.chainId);
    const transactionHash = execution.transactionHash as Hex;
    const isBuy = order.tokenIn.toLowerCase() === WETH.toLowerCase();
    const tokenAddress = (isBuy ? order.tokenOut : order.tokenIn) as Address;

    try {
      const [transaction, receipt] = await Promise.all([
        client.getTransaction({ hash: transactionHash }),
        client.getTransactionReceipt({ hash: transactionHash }),
      ]);
      if (receipt.status !== "success" || !transaction.to) {
        throw new Error("Transaction was not a successful contract call");
      }

      let route:
        | { kind: "curve"; factoryAddress: Address }
        | {
            kind: "v2";
            pairAddress: Address;
            wethTokenIndex: 0 | 1;
          };

      if (transaction.to.toLowerCase() === DEX_ROUTER.toLowerCase()) {
        const tokenInfo = await v2Adapter.getTokenInfo(tokenAddress);
        if (!tokenInfo.pairAddress) {
          throw new Error("Graduated token pair is unavailable");
        }
        const pairTokens = await v2Adapter.getPairTokens(tokenInfo.pairAddress);
        const wethTokenIndex = pairTokens.token0.toLowerCase() === WETH.toLowerCase()
          ? 0
          : pairTokens.token1.toLowerCase() === WETH.toLowerCase()
            ? 1
            : null;
        if (wethTokenIndex === null) {
          throw new Error("Pair does not contain wrapped native token");
        }
        route = {
          kind: "v2",
          pairAddress: tokenInfo.pairAddress,
          wethTokenIndex,
        };
      } else if (isRobinFunFactory(transaction.to)) {
        route = {
          kind: "curve",
          factoryAddress: transaction.to,
        };
      } else {
        throw new Error("Transaction target is not a supported swap contract");
      }

      const amounts = deriveSwapAmounts({
        logs: receipt.logs,
        walletAddress: transaction.from,
        tokenAddress,
        side: isBuy ? "buy" : "sell",
        route,
        transactionValue: transaction.value,
      });

      await prisma.$transaction([
        prisma.orderExecution.update({
          where: { id: execution.id },
          data: {
            actualTokenAmount: amounts.tokenAmount.toString(),
            actualEthAmount: amounts.ethAmount.toString(),
            gasUsed: receipt.gasUsed.toString(),
            effectiveGasPrice: receipt.effectiveGasPrice.toString(),
            errorCode: null,
            errorMessage: null,
          },
        }),
        prisma.automatedOrder.update({
          where: { id: order.id },
          data: { executionWallet: transaction.from.toLowerCase() },
        }),
      ]);
      updated += 1;
      console.log(`Backfilled ${transactionHash}`);
    } catch (error) {
      failed += 1;
      const message =
        error instanceof Error ? error.message : "Unknown accounting error";
      await prisma.orderExecution.update({
        where: { id: execution.id },
        data: {
          errorCode: "ACCOUNTING_UNAVAILABLE",
          errorMessage: message,
        },
      });
      console.warn(`Skipped ${transactionHash}: ${message}`);
    }
  }

  console.log(
    `Backfill complete: ${updated} updated, ${failed} unavailable, ${executions.length} checked`
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
