import { type Address } from "viem";
import { getPublicClient } from "@/src/lib/chain/client";
import { ROBINFUN_FACTORY_ABI } from "../abi/robinfun-factory";
import { ROBINFUN_TOKEN_ABI } from "../abi/robinfun-token";
import { getCurveDex } from "../registry";
import type { BondingCurveState, SwapQuote, SwapRoute, TokenInfo } from "../types";
import { ROBINFUN_FACTORIES } from "@/src/config/contracts";
import { retryRpcRead } from "@/src/lib/chain/retry";

export class RobinFunCurveAdapter {
  id = "robinfun-curve";
  name = "RobinFun Bonding Curve";

  private client = getPublicClient();

  /**
   * The token's own factory() getter is the authoritative source for which
   * RobinFun factory (V1–V5) manages its bonding curve. Curves, quotes, and
   * trades all live on that contract — using the newest factory for an older
   * token returns empty curve state and zero quotes. Cached per token.
   */
  private factoryCache = new Map<string, Address>();

  private async factoryFor(token: Address): Promise<Address> {
    const key = token.toLowerCase();
    const cached = this.factoryCache.get(key);
    if (cached) return cached;
    const factory = (await retryRpcRead(() =>
      this.client.readContract({
        address: token,
        abi: ROBINFUN_TOKEN_ABI,
        functionName: "factory",
      })
    )) as Address;
    this.factoryCache.set(key, factory);
    return factory;
  }

  async isRobinFunToken(token: Address): Promise<boolean> {
    try {
      const factory = await this.factoryFor(token);
      return ROBINFUN_FACTORIES.some((f) => f.toLowerCase() === factory.toLowerCase());
    } catch {
      return false;
    }
  }

  async getCurveState(token: Address): Promise<BondingCurveState> {
    const factory = await this.factoryFor(token);
    const result = await retryRpcRead(() =>
      this.client.readContract({
        address: factory,
        abi: ROBINFUN_FACTORY_ABI,
        functionName: "curves",
        args: [token],
      })
    );

    const [
      virtualEth,
      realEth,
      tokenReserve,
      raiseTarget,
      lpEth,
      treasuryEth,
      k,
      readyToGraduate,
      graduated,
      creator,
      feeRecipient,
    ] = result as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean, boolean, Address, Address];

    return {
      virtualEth,
      realEth,
      tokenReserve,
      raiseTarget,
      lpEth,
      treasuryEth,
      k,
      readyToGraduate,
      graduated,
      creator,
      feeRecipient,
    };
  }

  async isGraduated(token: Address): Promise<boolean> {
    const state = await this.getCurveState(token);
    return state.graduated;
  }

  async getTokenInfo(token: Address): Promise<TokenInfo> {
    const [name, symbol, decimals, totalSupply, dexLive, factory] = await Promise.all([
      this.client.readContract({ address: token, abi: ROBINFUN_TOKEN_ABI, functionName: "name" }),
      this.client.readContract({ address: token, abi: ROBINFUN_TOKEN_ABI, functionName: "symbol" }),
      this.client.readContract({ address: token, abi: ROBINFUN_TOKEN_ABI, functionName: "decimals" }),
      this.client.readContract({ address: token, abi: ROBINFUN_TOKEN_ABI, functionName: "totalSupply" }),
      this.client.readContract({ address: token, abi: ROBINFUN_TOKEN_ABI, functionName: "dexLive" }),
      this.client.readContract({ address: token, abi: ROBINFUN_TOKEN_ABI, functionName: "factory" }),
    ]);

    return {
      address: token,
      name: name as string,
      symbol: symbol as string,
      decimals: Number(decimals),
      totalSupply: totalSupply as bigint,
      creator: factory as Address,
      isRobinFun: true,
      dexLive: dexLive as boolean,
    };
  }

  async quoteBuy(token: Address, ethIn: bigint): Promise<bigint> {
    const factory = await this.factoryFor(token);
    const result = await this.client.readContract({
      address: factory,
      abi: ROBINFUN_FACTORY_ABI,
      functionName: "quoteBuy",
      args: [token, ethIn],
    });
    return result as bigint;
  }

  async quoteSell(token: Address, tokensIn: bigint): Promise<bigint> {
    const factory = await this.factoryFor(token);
    const result = await this.client.readContract({
      address: factory,
      abi: ROBINFUN_FACTORY_ABI,
      functionName: "quoteSell",
      args: [token, tokensIn],
    });
    return result as bigint;
  }

  async getCurrentPrice(token: Address): Promise<bigint> {
    const factory = await this.factoryFor(token);
    const result = await this.client.readContract({
      address: factory,
      abi: ROBINFUN_FACTORY_ABI,
      functionName: "currentPrice",
      args: [token],
    });
    return result as bigint;
  }

  async buildSwapQuote(
    tokenIn: Address, // WETH for buy, token for sell
    tokenOut: Address,
    amountIn: bigint,
    slippageBps: number
  ): Promise<SwapQuote> {
    const isBuy = tokenIn.toLowerCase() === getCurveDex().wethAddress.toLowerCase();
    const token = isBuy ? tokenOut : tokenIn;

    const [expectedOut, curve, factory] = await Promise.all([
      isBuy ? this.quoteBuy(token, amountIn) : this.quoteSell(token, amountIn),
      this.getCurveState(token),
      this.factoryFor(token),
    ]);

    if (curve.graduated) {
      throw new Error("Token has graduated; use V2 adapter");
    }

    const minOut = (expectedOut * BigInt(10000 - slippageBps)) / 10000n;
    // price as ETH per token (buy) or token per ETH (sell), using Number for display only
    const price = isBuy
      ? Number(amountIn) / Number(expectedOut)
      : Number(expectedOut) / Number(amountIn);

    const route: SwapRoute = {
      kind: "curve",
      path: [tokenIn, tokenOut],
      factoryAddress: factory,
    };

    return {
      tokenIn,
      tokenOut,
      amountIn,
      expectedAmountOut: expectedOut,
      minimumAmountOut: minOut,
      displayPrice: price.toString(),
      inversePrice: (1 / price).toString(),
      estimatedPriceImpactBps: 0, // curve AMM — impact is inherent in quote
      route,
      approvalTarget: factory,
      expiresAt: Math.floor(Date.now() / 1000) + 30,
    };
  }
}
