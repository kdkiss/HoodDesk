const BASIS_POINTS = 10_000n;

export interface ConstantProductPriceImpactInput {
  amountIn: bigint;
  expectedAmountOut: bigint;
  reserveIn: bigint;
  reserveOut: bigint;
}

/**
 * Compare a V2 quote's execution rate with the pool's pre-trade spot rate.
 * The result includes the pool fee because the router's expected output is
 * compared with the fee-free reserve ratio.
 */
export function calculateConstantProductPriceImpactBps({
  amountIn,
  expectedAmountOut,
  reserveIn,
  reserveOut,
}: ConstantProductPriceImpactInput): number {
  if (amountIn <= 0n) throw new Error("Swap amount must be positive");
  if (reserveIn <= 0n || reserveOut <= 0n) {
    throw new Error("V2 pool has no usable liquidity");
  }
  if (expectedAmountOut <= 0n) return Number(BASIS_POINTS);

  const spotOutputNumerator = amountIn * reserveOut;
  const quotedOutputNumerator = expectedAmountOut * reserveIn;
  if (quotedOutputNumerator >= spotOutputNumerator) return 0;

  const impactNumerator = spotOutputNumerator - quotedOutputNumerator;
  const roundedUpBps =
    (impactNumerator * BASIS_POINTS + spotOutputNumerator - 1n) /
    spotOutputNumerator;

  return Number(roundedUpBps > BASIS_POINTS ? BASIS_POINTS : roundedUpBps);
}

export function assertPriceImpactWithinLimit(
  priceImpactBps: number,
  maximumPriceImpactBps: number
): void {
  if (
    !Number.isInteger(maximumPriceImpactBps) ||
    maximumPriceImpactBps < 1 ||
    maximumPriceImpactBps > Number(BASIS_POINTS)
  ) {
    throw new Error("Invalid maximum price impact");
  }
  if (
    !Number.isInteger(priceImpactBps) ||
    priceImpactBps < 0 ||
    priceImpactBps > Number(BASIS_POINTS)
  ) {
    throw new Error("Invalid quoted price impact");
  }
  if (priceImpactBps > maximumPriceImpactBps) {
    throw new Error(
      `Price impact too high (${(priceImpactBps / 100).toFixed(2)}% exceeds ${(maximumPriceImpactBps / 100).toFixed(2)}%)`
    );
  }
}
