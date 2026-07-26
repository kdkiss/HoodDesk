import { loadEnvFile } from "node:process";
import type { Hex } from "viem";

try {
  loadEnvFile(".env");
} catch {
  // Deployed environments normally provide variables directly.
}

interface BlockscoutTransaction {
  hash: string;
  status: string;
  from: { hash: string };
  to: { hash: string } | null;
}

interface BlockscoutPage {
  items: BlockscoutTransaction[];
  next_page_params?: Record<string, string | number> | null;
}

function requestedAddress(): string | null {
  const argument = process.argv.find((value) => value.startsWith("--address="));
  return argument?.slice("--address=".length).toLowerCase() ?? null;
}

async function main() {
  const [
    { prisma },
    { blockscoutGet },
    { DEX_ROUTER, isRobinFunFactory },
    { verifySwapTransaction },
  ] = await Promise.all([
    import("../src/lib/db"),
    import("../src/lib/blockscout/client"),
    import("../src/config/contracts"),
    import("../src/lib/portfolio/verified-swap"),
  ]);

  const requested = requestedAddress();
  const defaultChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
  const walletRows = requested
    ? [{ executionWallet: requested, chainId: defaultChainId }]
    : await prisma.automatedOrder.findMany({
        where: { executionWallet: { not: "" } },
        select: { executionWallet: true, chainId: true },
        distinct: ["executionWallet", "chainId"],
      });

  let imported = 0;
  let alreadyKnown = 0;
  let unsupported = 0;

  for (const walletRow of walletRows) {
    const walletAddress = walletRow.executionWallet.toLowerCase();
    const transactionHashes: Hex[] = [];
    let pageParams: Record<string, string> = {};

    for (let page = 0; page < 20; page += 1) {
      const response = await blockscoutGet<BlockscoutPage>(
        `/addresses/${walletAddress}/transactions`,
        pageParams
      );
      for (const item of response.items) {
        const target = item.to?.hash;
        if (
          item.status !== "ok" ||
          item.from.hash.toLowerCase() !== walletAddress ||
          !target ||
          (target.toLowerCase() !== DEX_ROUTER.toLowerCase() &&
            !isRobinFunFactory(target))
        ) {
          continue;
        }
        transactionHashes.push(item.hash.toLowerCase() as Hex);
      }

      if (!response.next_page_params) break;
      pageParams = Object.fromEntries(
        Object.entries(response.next_page_params).map(([key, value]) => [
          key,
          String(value),
        ])
      );
    }

    const uniqueHashes = [...new Set(transactionHashes)];
    const [knownTracked, knownExecutions] = await Promise.all([
      prisma.trackedTransaction.findMany({
        where: { transactionHash: { in: uniqueHashes } },
        select: { transactionHash: true },
      }),
      prisma.orderExecution.findMany({
        where: { transactionHash: { in: uniqueHashes } },
        select: { transactionHash: true },
      }),
    ]);
    const known = new Set(
      [...knownTracked, ...knownExecutions]
        .map((row) => row.transactionHash?.toLowerCase())
        .filter((hash): hash is string => Boolean(hash))
    );

    for (const transactionHash of uniqueHashes) {
      if (known.has(transactionHash)) {
        alreadyKnown += 1;
        continue;
      }

      try {
        const verified = await verifySwapTransaction({
          chainId: walletRow.chainId,
          transactionHash,
        });
        if (verified.walletAddress.toLowerCase() !== walletAddress) {
          throw new Error("Verified sender does not match imported wallet");
        }
        const metadata = {
          tokenAddress: verified.tokenAddress.toLowerCase(),
          tokenAmount: verified.tokenAmount.toString(),
          ethAmount: verified.ethAmount.toString(),
          timestampMs: verified.blockTimestampMs.toString(),
          source: "verified_receipt_import",
        };
        await prisma.trackedTransaction.upsert({
          where: { transactionHash },
          create: {
            walletAddress,
            chainId: walletRow.chainId,
            transactionHash,
            transactionType: verified.side === "buy" ? "BUY" : "SELL",
            status: "confirmed",
            blockNumber: verified.blockNumber.toString(),
            gasUsed: verified.gasUsed.toString(),
            metadata,
          },
          update: {
            walletAddress,
            chainId: walletRow.chainId,
            transactionType: verified.side === "buy" ? "BUY" : "SELL",
            status: "confirmed",
            blockNumber: verified.blockNumber.toString(),
            gasUsed: verified.gasUsed.toString(),
            metadata,
          },
        });
        imported += 1;
        console.log(`Imported ${transactionHash}`);
      } catch (error) {
        unsupported += 1;
        console.warn(
          `Skipped ${transactionHash}: ${
            error instanceof Error ? error.message : "verification failed"
          }`
        );
      }
    }
  }

  console.log(
    `Import complete: ${imported} imported, ${alreadyKnown} already tracked, ${unsupported} unsupported`
  );
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
