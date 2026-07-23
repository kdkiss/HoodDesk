import { type Address, formatEther } from "viem";
import { getPublicClient } from "@/src/lib/chain/client";
import { UNISWAP_V2_ROUTER_ABI } from "../abi/uniswap-v2-router";
import { ERC20_ABI } from "../abi/erc20";
import { ROBINFUN_TOKEN_ABI } from "../abi/robinfun-token";
import { getDefaultDex } from "../registry";
import type { SwapQuote, SwapRoute, TokenInfo, LiquidityPool } from "../types";
import { isAllowlistedContract } from "../allowlist";

export class RobinFunV2Adapter {
  id = "robinfun-v2";
  name = "RobinFun Uniswap V2";

  private client = getPublicClient();
  private dex = getDefaultDex();

  async getTokenInfo(token: Address): Promise<TokenInfo> {
    const [name, symbol, decimals, totalSupply, dexLive, pair, factory] = await Promise.all([
      this.client.readContract({ address: token, abi: ROBINFUN_TOKEN_ABI, functionName: "name" }),
      this.client.readContract({ address: token, abi: ROBINFUN_TOKEN_ABI, functionName: "symbol" }),
      this.client.readContract({ address: token, abi: ROBINFUN_TOKEN_ABI, functionName: "decimals" }),
      this.client.readContract({ address: token, abi: ROBINFUN_TOKEN_ABI, functionName: "totalSupply" }),
      this.client.readContract({ address: token, abi: ROBINFUN_TOKEN_ABI, functionName: "dexLive" }),
      this.client.readContract({ address: token, abi: ROBINFUN_TOKEN_ABI, functionName: "pair" }),
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
      pairAddress: pair as Address,
    };
  }

  async getPairReserves(pair: Address): Promise<LiquidityPool> {
    const [token0, token1, reserves] = await Promise.all([
      this.client.readContract({
        address: pair,
        abi: [
          {
            type: "function",
            name: "token0",
            stateMutability: "view",
            inputs: [],
            outputs: [{ name: "", type: "address" }],
          },
        ] as const,
        functionName: "token0",
      }),
      this.client.readContract({
        address: pair,
        abi: [
          {
            type: "function",
            name: "token1",
            stateMutability: "view",
            inputs: [],
            outputs: [{ name: "", type: "address" }],
          },
        ] as const,
        functionName: "token1",
      }),
      this.client.readContract({
        address: pair,
        abi: [
          {
            type: "function",
            name: "getReserves",
            stateMutability: "view",
            inputs: [],
            outputs: [
              { name: "reserve0", type: "uint112" },
              { name: "reserve1", type: "uint112" },
              { name: "blockTimestampLast", type: "uint32" },
            ],
          },
        ] as const,
        functionName: "getReserves",
      }),
    ]);

    const [reserve0, reserve1] = reserves as [bigint, bigint, number];

    return {
      address: pair,
      token0: token0 as Address,
      token1: token1 as Address,
      reserve0,
      reserve1,
      totalSupply: 0n, // not needed for quotes
    };
  }

  async getAmountsOut(amountIn: bigint, path: Address[]): Promise<bigint[]> {
    const result = await this.client.readContract({
      address: this.dex.routerAddress!,
      abi: UNISWAP_V2_ROUTER_ABI,
      functionName: "getAmountsOut",
      args: [amountIn, path],
    });
    return result as bigint[];
  }

  async buildSwapQuote(
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
    slippageBps: number
  ): Promise<SwapQuote> {
    if (!this.dex.routerAddress) throw new Error("V2 router not configured");
    if (!isAllowlistedContract(this.dex.routerAddress)) {
      throw new Error("Router not allowlisted");
    }

    const path: Address[] = [tokenIn, tokenOut];
    const amounts = await this.getAmountsOut(amountIn, path);
    const expectedOut = amounts[amounts.length - 1];
    const minOut = (expectedOut * BigInt(10000 - slippageBps)) / 10000n;

    const price = Number(formatEther(amountIn)) / Number(formatEther(expectedOut));

    const route: SwapRoute = {
      kind: "v2",
      path,
      routerAddress: this.dex.routerAddress,
      factoryAddress: this.dex.factoryAddress,
    };

    return {
      tokenIn,
      tokenOut,
      amountIn,
      expectedAmountOut: expectedOut,
      minimumAmountOut: minOut,
      displayPrice: price.toString(),
      inversePrice: (1 / price).toString(),
      estimatedPriceImpactBps: 0, // TODO: calculate from reserves
      route,
      approvalTarget: this.dex.routerAddress,
      expiresAt: Math.floor(Date.now() / 1000) + 30,
    };
  }

  async getAllowance(token: Address, owner: Address, spender: Address): Promise<bigint> {
    const result = await this.client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [owner, spender],
    });
    return result as bigint;
  }

  async getBalance(token: Address, owner: Address): Promise<bigint> {
    const result = await this.client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [owner],
    });
    return result as bigint;
  }
}
