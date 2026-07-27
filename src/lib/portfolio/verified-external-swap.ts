import { getAddress, type Address, type Hex } from "viem";
import {
  blockscoutProGetWithMeta,
  type BlockscoutProResult,
} from "@/src/lib/blockscout/client";
import { getPublicClient } from "@/src/lib/chain/client";
import { curveAdapter } from "@/src/lib/dex";
import {
  deriveStateChangeSwapAmounts,
  type WalletStateChange,
} from "@/src/lib/portfolio/state-change-swap";

interface StateChangesPage {
  items: WalletStateChange[];
  next_page_params?: Record<string, string | number | null> | null;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export async function verifyExternalWalletSwapTransaction(input: {
  chainId: number;
  transactionHash: Hex;
  expectedWalletAddress: Address;
}) {
  const client = getPublicClient(input.chainId);
  const transactionHash = input.transactionHash.toLowerCase() as Hex;
  const [transaction, receipt] = await Promise.all([
    client.getTransaction({ hash: transactionHash }),
    client.getTransactionReceipt({ hash: transactionHash }),
  ]);

  if (
    receipt.status !== "success" ||
    !transaction.to ||
    transaction.input === "0x" ||
    !sameAddress(transaction.from, input.expectedWalletAddress)
  ) {
    throw new Error("Transaction is not a successful wallet contract call");
  }

  const stateChanges: WalletStateChange[] = [];
  let pageParams: Record<string, string> = {};
  let creditsRemaining: number | null = null;

  for (let page = 0; page < 10; page += 1) {
    const result: BlockscoutProResult<StateChangesPage> =
      await blockscoutProGetWithMeta<StateChangesPage>(
        input.chainId,
        `/api/v2/transactions/${transactionHash}/state-changes`,
        pageParams,
        { timeoutMs: 20_000 }
      );
    stateChanges.push(...result.data.items);
    creditsRemaining = result.creditsRemaining;

    const next = result.data.next_page_params;
    if (!next) break;
    if (page === 9) {
      throw new Error("External swap state changes exceeded the page limit");
    }
    pageParams = Object.fromEntries(
      Object.entries(next)
        .filter((entry): entry is [string, string | number] => entry[1] !== null)
        .map(([key, value]) => [key, String(value)])
    );
  }

  const walletTokenChanges = stateChanges.filter(
    (change) =>
      change.type === "token" &&
      change.token !== null &&
      change.change !== null &&
      BigInt(change.change) !== 0n &&
      sameAddress(change.address.hash, input.expectedWalletAddress)
  );
  if (walletTokenChanges.length !== 1 || !walletTokenChanges[0].token) {
    throw new Error(
      "External transaction does not have exactly one wallet token balance change"
    );
  }

  const tokenAddress = getAddress(
    walletTokenChanges[0].token.address_hash
  );
  if (!(await curveAdapter.isRobinFunToken(tokenAddress))) {
    throw new Error("External transaction token is not a RobinFun token");
  }

  const amounts = deriveStateChangeSwapAmounts({
    walletAddress: input.expectedWalletAddress,
    tokenAddress,
    gasFeeWei: receipt.gasUsed * receipt.effectiveGasPrice,
    stateChanges,
  });
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });

  return {
    transactionHash,
    walletAddress: getAddress(transaction.from),
    tokenAddress,
    side: amounts.side,
    tokenAmount: amounts.tokenAmount,
    ethAmount: amounts.ethAmount,
    blockNumber: receipt.blockNumber,
    blockTimestampMs: block.timestamp * 1000n,
    gasUsed: receipt.gasUsed,
    targetContract: getAddress(transaction.to),
    creditsRemaining,
  };
}
