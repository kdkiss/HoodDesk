import { type Address } from "viem";

export interface TokenInfo {
  address: Address;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply?: bigint;
  creator?: Address;
  isRobinFun: boolean;
  dexLive: boolean;
  pairAddress?: Address;
  exchangeRateUsd?: string;
  holdersCount?: number;
}

export interface BondingCurveState {
  virtualEth: bigint;
  realEth: bigint;
  tokenReserve: bigint;
  raiseTarget: bigint;
  lpEth: bigint;
  treasuryEth: bigint;
  k: bigint;
  readyToGraduate: boolean;
  graduated: boolean;
  creator: Address;
  feeRecipient: Address;
}

export interface SwapQuote {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  expectedAmountOut: bigint;
  minimumAmountOut: bigint;
  displayPrice: string;
  inversePrice: string;
  estimatedPriceImpactBps: number;
  estimatedGas?: bigint;
  route: SwapRoute;
  approvalTarget: Address;
  expiresAt: number;
  blockNumber?: bigint;
}

export interface SwapRoute {
  kind: "curve" | "v2";
  path: Address[];
  poolAddress?: Address;
  factoryAddress: Address;
  routerAddress?: Address;
}

export interface LiquidityPool {
  address: Address;
  token0: Address;
  token1: Address;
  reserve0: bigint;
  reserve1: bigint;
  totalSupply: bigint;
}

export interface TradeEvent {
  txHash: string;
  blockNumber: bigint;
  timestamp: number;
  token: Address;
  side: "buy" | "sell";
  ethAmount: bigint;
  tokenAmount: bigint;
  priceWeiPerToken: bigint;
  trader: Address;
}

export type OrderType = "LIMIT_BUY" | "TAKE_PROFIT" | "STOP_LOSS";
export type OrderStatus =
  | "DRAFT"
  | "PENDING_FUNDING"
  | "ARMED"
  | "TRIGGERED"
  | "EXECUTING"
  | "CONFIRMED"
  | "CANCELLED"
  | "EXPIRED"
  | "FAILED"
  | "PAUSED";

export interface AutomatedOrder {
  id: string;
  ownerAddress: Address;
  executionWallet: string;
  chainId: number;
  dexAdapterId: string;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  triggerPrice: string;
  triggerDirection: "gte" | "lte";
  orderType: OrderType;
  maximumSlippageBps: number;
  maximumPriceImpactBps: number;
  deadlineSeconds: number;
  maximumGasPriceGwei?: string;
  expiresAt?: Date;
  status: OrderStatus;
  transactionHash?: string;
  failureReason?: string;
  retryCount: number;
  triggeredAt?: Date;
  executedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
