"use client";

import { formatEther, formatUnits, type Address } from "viem";
import type { Direction, ParsedQuote } from "./types";

function shorten(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function ReviewPanel({
  direction,
  quote,
  tokenSymbol,
  tokenDecimals,
  chainName,
  walletAddress,
  slippageBps,
  deadlineSeconds,
}: {
  direction: Direction;
  quote: ParsedQuote;
  tokenSymbol: string;
  tokenDecimals: number;
  chainName: string;
  walletAddress: Address;
  slippageBps: number;
  deadlineSeconds: number;
}) {
  const isBuy = direction === "buy";
  const inSymbol = isBuy ? "ETH" : tokenSymbol;
  const outSymbol = isBuy ? tokenSymbol : "ETH";
  const inDecimals = isBuy ? 18 : tokenDecimals;
  const outDecimals = isBuy ? tokenDecimals : 18;

  const spender = quote.route.kind === "curve" ? quote.route.factoryAddress : quote.route.routerAddress;
  const contractLabel = quote.route.kind === "curve" ? "RobinFun Factory" : "Uniswap V2 Router";

  const priceImpactWarn = quote.estimatedPriceImpactBps >= 500;

  return (
    <div className="space-y-3 text-sm">
      <div className="flex justify-between">
        <span className="text-hood-muted">Direction</span>
        <span className={`font-semibold ${isBuy ? "text-hood-green" : "text-hood-red"}`}>
          {isBuy ? "Buy" : "Sell"}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-hood-muted">You pay</span>
        <span className="font-mono">
          {formatUnits(quote.amountIn, inDecimals)} {inSymbol}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-hood-muted">You receive (est.)</span>
        <span className="font-mono">
          {formatUnits(quote.expectedAmountOut, outDecimals)} {outSymbol}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-hood-muted">Minimum received</span>
        <span className="font-mono">
          {formatUnits(quote.minimumAmountOut, outDecimals)} {outSymbol}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-hood-muted">Slippage tolerance</span>
        <span className="font-mono">{(slippageBps / 100).toFixed(2)}%</span>
      </div>
      <div className="flex justify-between">
        <span className="text-hood-muted">Price impact</span>
        <span className={`font-mono ${priceImpactWarn ? "text-hood-red" : ""}`}>
          {(quote.estimatedPriceImpactBps / 100).toFixed(2)}%
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-hood-muted">Route</span>
        <span className="font-mono">
          {quote.route.kind === "curve" ? "Bonding Curve" : "Uniswap V2"}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-hood-muted">Contract</span>
        <span className="font-mono" title={spender}>
          {contractLabel} ({spender ? shorten(spender) : "-"})
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-hood-muted">Deadline</span>
        <span className="font-mono">{deadlineSeconds}s from signing</span>
      </div>
      <div className="flex justify-between">
        <span className="text-hood-muted">Network</span>
        <span className="font-mono">{chainName}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-hood-muted">Wallet</span>
        <span className="font-mono">{shorten(walletAddress)}</span>
      </div>

      {priceImpactWarn && (
        <div className="bg-hood-red/10 border border-hood-red text-hood-red px-3 py-2 rounded text-xs">
          High price impact ({(quote.estimatedPriceImpactBps / 100).toFixed(2)}%). Review carefully
          before confirming.
        </div>
      )}
    </div>
  );
}

export function formatNative(wei: bigint): string {
  return formatEther(wei);
}
