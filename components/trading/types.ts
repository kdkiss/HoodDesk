import { type Address } from "viem";

/** Shape returned by POST /api/quote (all bigint fields serialized as decimal strings). */
export interface QuoteApiResponse {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: string;
  expectedAmountOut: string;
  minimumAmountOut: string;
  displayPrice: string;
  inversePrice: string;
  estimatedPriceImpactBps: number;
  route: {
    kind: "curve" | "v2";
    path: Address[];
    factoryAddress: Address;
    routerAddress?: Address;
  };
  approvalTarget: Address;
  expiresAt: number;
}

/** Client-side quote with bigint fields parsed for safe arithmetic. */
export interface ParsedQuote {
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  expectedAmountOut: bigint;
  minimumAmountOut: bigint;
  displayPrice: string;
  inversePrice: string;
  estimatedPriceImpactBps: number;
  route: {
    kind: "curve" | "v2";
    path: Address[];
    factoryAddress: Address;
    routerAddress?: Address;
  };
  approvalTarget: Address;
  expiresAt: number;
}

export function parseQuote(raw: QuoteApiResponse): ParsedQuote {
  return {
    tokenIn: raw.tokenIn,
    tokenOut: raw.tokenOut,
    amountIn: BigInt(raw.amountIn),
    expectedAmountOut: BigInt(raw.expectedAmountOut),
    minimumAmountOut: BigInt(raw.minimumAmountOut),
    displayPrice: raw.displayPrice,
    inversePrice: raw.inversePrice,
    estimatedPriceImpactBps: raw.estimatedPriceImpactBps,
    route: raw.route,
    approvalTarget: raw.approvalTarget,
    expiresAt: raw.expiresAt,
  };
}

export type Direction = "buy" | "sell";

export type FlowStep =
  | "form"
  | "needs-approval"
  | "approving"
  | "review"
  | "signing"
  | "pending"
  | "confirmed"
  | "reverted"
  | "rejected"
  | "error";
