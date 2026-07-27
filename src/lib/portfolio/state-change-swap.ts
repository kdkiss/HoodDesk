export interface WalletStateChange {
  type: "coin" | "token";
  address: { hash: string };
  token: { address_hash: string } | null;
  change: string | null;
}

interface DeriveStateChangeSwapInput {
  walletAddress: string;
  tokenAddress: string;
  gasFeeWei: bigint;
  stateChanges: readonly WalletStateChange[];
}

export interface StateChangeSwapAmounts {
  side: "buy" | "sell";
  tokenAmount: bigint;
  ethAmount: bigint;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

export function deriveStateChangeSwapAmounts(
  input: DeriveStateChangeSwapInput
): StateChangeSwapAmounts {
  const walletChanges = input.stateChanges.filter(
    (change) =>
      sameAddress(change.address.hash, input.walletAddress) &&
      change.change !== null &&
      BigInt(change.change) !== 0n
  );
  const coinChanges = walletChanges.filter(
    (change) => change.type === "coin" && change.token === null
  );
  const tokenChanges = walletChanges.filter(
    (change) => change.type === "token"
  );

  if (coinChanges.length !== 1 || tokenChanges.length !== 1) {
    throw new Error(
      "External swap must have exactly one wallet coin leg and one token leg"
    );
  }
  const tokenChange = tokenChanges[0];
  if (
    !tokenChange.token ||
    !sameAddress(tokenChange.token.address_hash, input.tokenAddress)
  ) {
    throw new Error("External swap token leg does not match the requested token");
  }

  const coinBalanceChange = BigInt(coinChanges[0].change!);
  const tokenBalanceChange = BigInt(tokenChange.change!);
  // The explorer's coin balance change includes transaction gas. Add the
  // receipt fee back to isolate only the native amount exchanged by the call.
  const nativeTradeChange = coinBalanceChange + input.gasFeeWei;

  if (tokenBalanceChange > 0n && nativeTradeChange < 0n) {
    return {
      side: "buy",
      tokenAmount: tokenBalanceChange,
      ethAmount: -nativeTradeChange,
    };
  }
  if (tokenBalanceChange < 0n && nativeTradeChange > 0n) {
    return {
      side: "sell",
      tokenAmount: -tokenBalanceChange,
      ethAmount: nativeTradeChange,
    };
  }
  throw new Error("External swap must have opposite native and token legs");
}
