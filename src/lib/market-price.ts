import { formatEther, type Address } from "viem";
import { WETH } from "@/src/config/contracts";
import { curveAdapter, v2Adapter } from "@/src/lib/dex";
import { priceEthPerTokenFromReserves } from "@/src/lib/price-units";

/**
 * Returns the current on-chain price in ETH per whole token.  We deliberately
 * do not label this as USD: the application has no verified ETH/USD oracle.
 */
export async function getLivePriceEth(
  token: Address,
  dexLive: boolean,
  knownPairAddress?: string | null
): Promise<string | null> {
  try {
    if (!dexLive) {
      return formatEther(await curveAdapter.getCurrentPrice(token));
    }

    const pairAddress = knownPairAddress ?? (await v2Adapter.getTokenInfo(token)).pairAddress;
    if (!pairAddress) return null;

    const reserves = await v2Adapter.getPairReserves(pairAddress as Address);
    const wethIsToken0 = reserves.token0.toLowerCase() === WETH.toLowerCase();
    const wethReserve = wethIsToken0 ? reserves.reserve0 : reserves.reserve1;
    const tokenReserve = wethIsToken0 ? reserves.reserve1 : reserves.reserve0;
    const price = priceEthPerTokenFromReserves(wethReserve, tokenReserve);
    if (price === null) return null;

    return formatEther(price);
  } catch {
    // A newly created or illiquid token can have no readable price yet.
    return null;
  }
}
