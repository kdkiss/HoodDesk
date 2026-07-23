import { type Address } from "viem";
import { WETH } from "@/src/config/contracts";
import { RobinFunCurveAdapter } from "./adapters/robinfun-curve";
import { RobinFunV2Adapter } from "./adapters/robinfun-v2";
import type { SwapQuote, TokenInfo } from "./types";

const curveAdapter = new RobinFunCurveAdapter();
const v2Adapter = new RobinFunV2Adapter();

export async function getTokenInfo(token: Address): Promise<TokenInfo> {
  const isRobinFun = await curveAdapter.isRobinFunToken(token);
  if (!isRobinFun) {
    throw new Error("Token is not a RobinFun token");
  }
  const graduated = await curveAdapter.isGraduated(token);
  if (graduated) {
    return v2Adapter.getTokenInfo(token);
  }
  return curveAdapter.getTokenInfo(token);
}

export async function getSwapQuote(
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  slippageBps: number
): Promise<SwapQuote> {
  const isBuy = tokenIn.toLowerCase() === WETH.toLowerCase();
  const token = isBuy ? tokenOut : tokenIn;
  const curveState = await curveAdapter.getCurveState(token);
  if (curveState.graduated) {
    return v2Adapter.buildSwapQuote(tokenIn, tokenOut, amountIn, slippageBps);
  }
  return curveAdapter.buildSwapQuote(tokenIn, tokenOut, amountIn, slippageBps);
}

export { curveAdapter, v2Adapter };
export * from "./types";
export * from "./registry";
export * from "./allowlist";
