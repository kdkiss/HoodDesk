export function priceEthPerTokenFromReserves(
  wethReserve: bigint,
  tokenReserve: bigint,
  tokenDecimals = 18
) {
  if (tokenReserve <= 0n) return null;
  return (wethReserve * 10n ** BigInt(tokenDecimals)) / tokenReserve;
}
