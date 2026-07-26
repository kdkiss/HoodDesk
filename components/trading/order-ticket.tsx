"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useBalance,
  useReadContract,
  useSimulateContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { formatUnits, isAddress, maxUint256, parseUnits, type Address } from "viem";
import { getChain } from "@/src/config/chains";
import { WETH } from "@/src/config/contracts";
import { ERC20_ABI } from "@/src/lib/dex/abi/erc20";
import { ROBINFUN_FACTORY_ABI } from "@/src/lib/dex/abi/robinfun-factory";
import { UNISWAP_V2_ROUTER_ABI } from "@/src/lib/dex/abi/uniswap-v2-router";
import { useNetworkHealth } from "@/src/hooks/use-network-health";
import { useTokenInfo } from "./use-token-info";
import { ReviewPanel } from "./review-panel";
import { parseQuote, type Direction, type FlowStep, type ParsedQuote, type QuoteApiResponse } from "./types";
import { trackConfirmedSwap } from "@/src/lib/portfolio/track-swap";

const EXPECTED_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
const DEFAULT_SLIPPAGE_BPS = 100;
const MAX_SLIPPAGE_BPS = 500;
const MAX_PRICE_IMPACT_BPS = 800;
const DEADLINE_SECONDS = 300;

function shorten(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function OrderTicket({ tokenAddress: tokenAddressProp }: { tokenAddress?: string }) {
  const { address: walletAddress, isConnected, chainId } = useAccount();
  const { data: health } = useNetworkHealth();

  const [direction, setDirection] = useState<Direction>("buy");
  const [tokenAddressInput, setTokenAddressInput] = useState("");
  // When rendered inside the per-token terminal, the address is fixed by the
  // route and the manual input is hidden.
  const tokenAddress = tokenAddressProp ?? tokenAddressInput;
  const setTokenAddress = (v: string) => setTokenAddressInput(v);
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [slippageInput, setSlippageInput] = useState((DEFAULT_SLIPPAGE_BPS / 100).toString());
  const [unlimitedApproval, setUnlimitedApproval] = useState(false);

  const [step, setStep] = useState<FlowStep>("form");
  const [quote, setQuote] = useState<ParsedQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [trackingWarning, setTrackingWarning] = useState<string | null>(null);
  const trackedSwapHash = useRef<string | null>(null);

  const correctChain = isConnected && chainId === EXPECTED_CHAIN_ID;
  const tokenValid = isAddress(tokenAddress);

  const tokenInfoQuery = useTokenInfo(tokenAddress);
  const tokenInfo = tokenInfoQuery.data;
  const tokenDecimals = tokenInfo?.decimals ?? 18;
  const tokenSymbol = tokenInfo?.symbol ?? "TOKEN";

  const nativeBalance = useBalance({
    address: walletAddress,
    chainId: EXPECTED_CHAIN_ID,
    query: { enabled: Boolean(walletAddress) },
  });

  const tokenBalanceRead = useReadContract({
    address: tokenValid ? (tokenAddress as Address) : undefined,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: walletAddress ? [walletAddress] : undefined,
    chainId: EXPECTED_CHAIN_ID,
    query: { enabled: Boolean(walletAddress && tokenValid && direction === "sell") },
  });

  const allowanceRead = useReadContract({
    address: tokenValid ? (tokenAddress as Address) : undefined,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: walletAddress && quote ? [walletAddress, quote.approvalTarget] : undefined,
    chainId: EXPECTED_CHAIN_ID,
    query: { enabled: Boolean(walletAddress && tokenValid && direction === "sell" && quote) },
  });

  let amountInWei: bigint | null = null;
  try {
    if (amount && Number(amount) > 0) {
      amountInWei = parseUnits(amount, direction === "buy" ? 18 : tokenDecimals);
    }
  } catch {
    amountInWei = null;
  }

  const sufficientBalance = useMemo(() => {
    if (!amountInWei) return false;
    if (direction === "buy") {
      return Boolean(nativeBalance.data && nativeBalance.data.value >= amountInWei);
    }
    return Boolean(tokenBalanceRead.data && (tokenBalanceRead.data as bigint) >= amountInWei);
  }, [amountInWei, direction, nativeBalance.data, tokenBalanceRead.data]);

  const emergencyPause = health?.emergencyPause ?? false;

  const canFetchQuote =
    isConnected &&
    correctChain &&
    tokenValid &&
    Boolean(tokenInfo?.isRobinFun) &&
    amountInWei !== null &&
    amountInWei > 0n &&
    sufficientBalance &&
    !emergencyPause;

  async function fetchQuote() {
    if (!amountInWei || !tokenValid) return;
    setQuoteLoading(true);
    setQuoteError(null);
    setFlowError(null);
    try {
      const tokenIn = direction === "buy" ? WETH : (tokenAddress as Address);
      const tokenOut = direction === "buy" ? (tokenAddress as Address) : WETH;
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenIn,
          tokenOut,
          amountIn: amountInWei.toString(),
          slippageBps,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch quote");
      const parsed = parseQuote(data.quote as QuoteApiResponse);

      if (parsed.estimatedPriceImpactBps > MAX_PRICE_IMPACT_BPS) {
        setQuoteError(
          `Price impact too high (${(parsed.estimatedPriceImpactBps / 100).toFixed(2)}%). Reduce order size.`
        );
        setQuote(null);
        return;
      }

      setQuote(parsed);

      if (direction === "sell") {
        const allowance = (await allowanceRead.refetch()).data as bigint | undefined;
        if (allowance === undefined || allowance < parsed.amountIn) {
          setStep("needs-approval");
        } else {
          setStep("review");
        }
      } else {
        setStep("review");
      }
    } catch (e) {
      setQuoteError(e instanceof Error ? e.message : "Failed to fetch quote");
      setQuote(null);
    } finally {
      setQuoteLoading(false);
    }
  }

  // ---- Approval ----
  const approve = useWriteContract();
  const approveReceipt = useWaitForTransactionReceipt({ hash: approve.data });

  useEffect(() => {
    if (approveReceipt.isSuccess && step === "approving") {
      allowanceRead.refetch().then((res) => {
        const allowance = res.data as bigint | undefined;
        if (quote && allowance !== undefined && allowance >= quote.amountIn) {
          setStep("review");
        } else {
          setStep("needs-approval");
        }
      });
    }
    if (approveReceipt.isError && step === "approving") {
      setFlowError("Approval transaction reverted.");
      setStep("needs-approval");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveReceipt.isSuccess, approveReceipt.isError]);

  async function handleApprove() {
    if (!quote || !tokenValid) return;
    setFlowError(null);
    try {
      const amountToApprove = unlimitedApproval ? maxUint256 : quote.amountIn;
      await approve.writeContractAsync({
        address: tokenAddress as Address,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [quote.approvalTarget, amountToApprove],
        chainId: EXPECTED_CHAIN_ID,
      });
      setStep("approving");
    } catch (e) {
      if (isUserRejection(e)) {
        setFlowError("Approval rejected in wallet.");
      } else {
        setFlowError(e instanceof Error ? e.message : "Approval failed");
      }
    }
  }

  // ---- Simulation (4 branches, always called to satisfy rules-of-hooks) ----
  const isBuy = direction === "buy";
  const quoteFresh = Boolean(quote && Math.floor(Date.now() / 1000) < quote.expiresAt);
  const readyToSimulate = step === "review" && quoteFresh && Boolean(walletAddress) && Boolean(quote);

  const curveEnabled = readyToSimulate && quote?.route.kind === "curve";
  const v2Enabled = readyToSimulate && quote?.route.kind === "v2";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const deadline = useMemo(() => BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS), [step]);

  const simCurveBuy = useSimulateContract({
    address: quote?.route.factoryAddress,
    abi: ROBINFUN_FACTORY_ABI,
    functionName: "buy",
    args: quote && tokenValid ? [tokenAddress as Address, quote.minimumAmountOut] : undefined,
    value: quote?.amountIn,
    account: walletAddress,
    chainId: EXPECTED_CHAIN_ID,
    query: { enabled: curveEnabled && isBuy },
  });

  const simCurveSell = useSimulateContract({
    address: quote?.route.factoryAddress,
    abi: ROBINFUN_FACTORY_ABI,
    functionName: "sell",
    args:
      quote && tokenValid
        ? [tokenAddress as Address, quote.amountIn, quote.minimumAmountOut]
        : undefined,
    account: walletAddress,
    chainId: EXPECTED_CHAIN_ID,
    query: { enabled: curveEnabled && !isBuy },
  });

  const simV2Buy = useSimulateContract({
    address: quote?.route.routerAddress,
    abi: UNISWAP_V2_ROUTER_ABI,
    functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
    args:
      quote && walletAddress
        ? [quote.minimumAmountOut, quote.route.path, walletAddress, deadline]
        : undefined,
    value: quote?.amountIn,
    account: walletAddress,
    chainId: EXPECTED_CHAIN_ID,
    query: { enabled: v2Enabled && isBuy },
  });

  const simV2Sell = useSimulateContract({
    address: quote?.route.routerAddress,
    abi: UNISWAP_V2_ROUTER_ABI,
    functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens",
    args:
      quote && walletAddress
        ? [quote.amountIn, quote.minimumAmountOut, quote.route.path, walletAddress, deadline]
        : undefined,
    account: walletAddress,
    chainId: EXPECTED_CHAIN_ID,
    query: { enabled: v2Enabled && !isBuy },
  });

  const activeSim = curveEnabled ? (isBuy ? simCurveBuy : simCurveSell) : v2Enabled ? (isBuy ? simV2Buy : simV2Sell) : null;

  // ---- Submit ----
  const swap = useWriteContract();
  const swapReceipt = useWaitForTransactionReceipt({ hash: swap.data });

  useEffect(() => {
    if (swap.data && step === "signing") {
      setStep("pending");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swap.data]);

  useEffect(() => {
    if (swapReceipt.isSuccess && step === "pending") {
      const confirmed = swapReceipt.data.status === "success";
      setStep(confirmed ? "confirmed" : "reverted");
      if (
        confirmed &&
        swap.data &&
        tokenValid &&
        trackedSwapHash.current !== swap.data
      ) {
        trackedSwapHash.current = swap.data;
        setTrackingWarning(null);
        void trackConfirmedSwap(
          swap.data,
          tokenAddress as Address
        ).catch((error) => {
          setTrackingWarning(
            error instanceof Error
              ? `Portfolio history was not recorded: ${error.message}`
              : "Portfolio history was not recorded."
          );
        });
      }
      nativeBalance.refetch();
      tokenBalanceRead.refetch();
      allowanceRead.refetch();
    }
    if (swapReceipt.isError && step === "pending") {
      setStep("reverted");
      setFlowError("Failed to confirm transaction receipt.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapReceipt.isSuccess, swapReceipt.isError, swapReceipt.data]);

  async function handleSubmit() {
    if (!activeSim || !activeSim.data?.request) {
      setFlowError("Simulation failed or not ready. Cannot submit trade.");
      return;
    }
    setFlowError(null);
    setStep("signing");
    try {
      await swap.writeContractAsync(activeSim.data.request as Parameters<typeof swap.writeContractAsync>[0]);
    } catch (e) {
      if (isUserRejection(e)) {
        setStep("rejected");
        setFlowError("Transaction rejected in wallet.");
      } else {
        setStep("error");
        setFlowError(e instanceof Error ? e.message : "Transaction failed to broadcast.");
      }
    }
  }

  function resetFlow() {
    setStep("form");
    setQuote(null);
    setQuoteError(null);
    setFlowError(null);
    setTrackingWarning(null);
    swap.reset();
    approve.reset();
  }

  let explorerTxUrl: string | undefined;
  try {
    if (swap.data) {
      explorerTxUrl = `${getChain(EXPECTED_CHAIN_ID).explorerUrl}/tx/${swap.data}`;
    }
  } catch {
    explorerTxUrl = undefined;
  }

  const chainName = (() => {
    try {
      return getChain(EXPECTED_CHAIN_ID).name;
    } catch {
      return `chain ${EXPECTED_CHAIN_ID}`;
    }
  })();

  return (
    <div className="hd-card p-4 space-y-4">
      <div className="flex gap-1 p-1 bg-hood-bg rounded-xl border border-hood-border">
        <button
          onClick={() => {
            setDirection("buy");
            resetFlow();
          }}
          disabled={step !== "form"}
          className={`flex-1 py-2 rounded-lg font-semibold text-sm transition-all active:scale-[0.98] disabled:opacity-50 ${
            direction === "buy"
              ? "bg-hood-green text-black shadow-sm"
              : "text-hood-muted hover:text-hood-text"
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => {
            setDirection("sell");
            resetFlow();
          }}
          disabled={step !== "form"}
          className={`flex-1 py-2 rounded-lg font-semibold text-sm transition-all active:scale-[0.98] disabled:opacity-50 ${
            direction === "sell"
              ? "bg-hood-red text-white shadow-sm"
              : "text-hood-muted hover:text-hood-text"
          }`}
        >
          Sell
        </button>
      </div>

      {step === "form" && (
        <>
          {!tokenAddressProp && (
          <div>
            <label className="block text-sm text-hood-muted mb-1">Token Address</label>
            <input
              type="text"
              value={tokenAddress}
              onChange={(e) => setTokenAddress(e.target.value.trim())}
              placeholder="0x..."
              className="hd-input w-full font-mono"
            />
            {tokenAddress && !tokenValid && (
              <p className="text-xs text-hood-red mt-1">Invalid address format</p>
            )}
            {tokenValid && tokenInfoQuery.isError && (
              <p className="text-xs text-hood-red mt-1">
                {tokenInfoQuery.error instanceof Error ? tokenInfoQuery.error.message : "Token not supported"}
              </p>
            )}
            {tokenValid && tokenInfo && (
              <p className="text-xs text-hood-muted mt-1">
                {tokenInfo.symbol} - {tokenInfo.name} {tokenInfo.pairAddress ? "(graduated)" : "(bonding curve)"}
              </p>
            )}
          </div>
          )}

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-sm text-hood-muted">
                {direction === "buy" ? "ETH Amount" : `${tokenSymbol} Amount`}
              </label>
              {isConnected && (
                <span className="text-xs text-hood-muted font-mono">
                  Balance:{" "}
                  {direction === "buy"
                    ? nativeBalance.data
                      ? `${Number(formatUnits(nativeBalance.data.value, nativeBalance.data.decimals)).toFixed(4)} ETH`
                      : "-"
                    : tokenBalanceRead.data
                      ? `${formatUnits(tokenBalanceRead.data as bigint, tokenDecimals)} ${tokenSymbol}`
                      : "-"}
                </span>
              )}
            </div>
            <input
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                const value = e.target.value;
                if (value === "" || /^\d*\.?\d*$/.test(value)) setAmount(value);
              }}
              placeholder="0.0"
              className="hd-input w-full font-mono"
            />
            {isConnected && direction === "sell" && (
              <div className="flex gap-1.5 mt-2">
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    onClick={() => {
                      if (!tokenBalanceRead.data) return;
                      const bal = tokenBalanceRead.data as bigint;
                      const portion = (bal * BigInt(pct)) / 100n;
                      setAmount(formatUnits(portion, tokenDecimals));
                    }}
                    className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-hood-well text-hood-muted hover:text-hood-green hover:bg-hood-greenDim transition-all active:scale-[0.98]"
                  >
                    {pct === 100 ? "MAX" : `${pct}%`}
                  </button>
                ))}
              </div>
            )}
            {isConnected && direction === "buy" && (
              <div className="flex gap-1.5 mt-2">
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    onClick={() => {
                      if (!nativeBalance.data) return;
                      const portion = (nativeBalance.data.value * BigInt(pct)) / 100n;
                      setAmount(formatUnits(portion, 18));
                    }}
                    className="flex-1 py-1.5 text-xs font-semibold rounded-lg bg-hood-well text-hood-muted hover:text-hood-green hover:bg-hood-greenDim transition-all active:scale-[0.98]"
                  >
                    {pct === 100 ? "MAX" : `${pct}%`}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm text-hood-muted mb-1">
              Slippage Tolerance ({(slippageBps / 100).toFixed(2)}%)
            </label>
            <div className="flex gap-1.5">
              {[50, 100, 300].map((bps) => (
                <button
                  key={bps}
                  onClick={() => {
                    setSlippageBps(bps);
                    setSlippageInput((bps / 100).toString());
                  }}
                  className={`flex-1 py-1.5 text-xs font-semibold rounded-lg transition-all active:scale-[0.98] ${
                    slippageBps === bps
                      ? "bg-hood-green text-black shadow-sm"
                      : "bg-hood-well text-hood-muted hover:text-hood-text"
                  }`}
                >
                  {(bps / 100).toFixed(2)}%
                </button>
              ))}
              <div className="relative w-20">
                <input
                  type="text"
                  inputMode="decimal"
                  value={slippageInput}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value !== "" && !/^\d*\.?\d*$/.test(value)) return;
                    setSlippageInput(value);
                    if (value === "") return;
                    const pct = Number(value);
                    if (Number.isNaN(pct)) return;
                    const bps = Math.round(pct * 100);
                    setSlippageBps(Math.min(Math.max(bps, 1), MAX_SLIPPAGE_BPS));
                  }}
                  onBlur={() => {
                    if (slippageInput === "") setSlippageInput((slippageBps / 100).toString());
                  }}
                  className="w-full bg-hood-well border border-transparent rounded-lg px-2 py-1.5 text-xs font-mono text-hood-text focus:outline-none focus:border-hood-green/40 text-right pr-5"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-hood-muted text-[10px]">%</span>
              </div>
            </div>
          </div>

          {!isConnected && (
            <p className="text-xs text-hood-muted">Connect your wallet to trade.</p>
          )}
          {isConnected && !correctChain && (
            <p className="text-xs text-hood-red">Switch to {chainName} to trade.</p>
          )}
          {emergencyPause && (
            <p className="text-xs text-hood-red">Trading is paused. Emergency pause active.</p>
          )}
          {amountInWei !== null && amountInWei > 0n && !sufficientBalance && isConnected && (
            <p className="text-xs text-hood-red">Insufficient balance.</p>
          )}

          {quoteError && (
            <div className="bg-hood-red/10 border border-hood-red text-hood-red px-3 py-2 rounded text-sm">
              {quoteError}
            </div>
          )}

          <button
            onClick={fetchQuote}
            disabled={!canFetchQuote || quoteLoading}
            className="hd-btn-primary w-full"
          >
            {quoteLoading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Fetching Quote
              </span>
            ) : (
              "Get Quote"
            )}
          </button>
        </>
      )}

      {(step === "needs-approval" || step === "approving") && quote && tokenValid && (
        <div className="space-y-3 text-sm">
          <p className="text-hood-muted">
            HoodDesk needs your permission to let{" "}
            <span className="font-mono text-hood-text">{shorten(quote.approvalTarget)}</span> spend{" "}
            {tokenSymbol} on your behalf before this trade can execute. This is a standard ERC-20
            approval, required once per spender (or per amount if using exact approval).
          </p>
          <div className="flex justify-between text-xs">
            <span className="text-hood-muted">Spender</span>
            <span className="font-mono">{quote.approvalTarget}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-hood-muted">Approval amount</span>
            <span className="font-mono">
              {unlimitedApproval
                ? "Unlimited"
                : `${formatUnits(quote.amountIn, tokenDecimals)} ${tokenSymbol} (exact)`}
            </span>
          </div>
          <label className="flex items-start gap-2 text-xs text-hood-muted">
            <input
              type="checkbox"
              checked={unlimitedApproval}
              onChange={(e) => setUnlimitedApproval(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Approve unlimited spending instead of the exact amount. This lets the spender pull any
              amount of {tokenSymbol} from your wallet in future transactions without asking again.
              only enable this if you trust this contract.{" "}
              <span className="text-hood-red font-semibold">Not recommended for one-off trades.</span>
            </span>
          </label>

          {flowError && (
            <div className="bg-hood-red/10 border border-hood-red text-hood-red px-3 py-2 rounded text-xs">
              {flowError}
            </div>
          )}

          <button
            onClick={handleApprove}
            disabled={step === "approving" || approve.isPending || approveReceipt.isLoading}
            className="hd-btn-primary w-full"
          >
            {approve.isPending
              ? "Confirm in wallet..."
              : approveReceipt.isLoading
                ? "Approving..."
                : "Approve"}
          </button>
          <button
            onClick={resetFlow}
            className="w-full text-xs text-hood-muted hover:text-hood-text py-1"
          >
            Cancel
          </button>
        </div>
      )}

      {step === "review" && quote && walletAddress && (
        <div className="space-y-4">
          <ReviewPanel
            direction={direction}
            quote={quote}
            tokenSymbol={tokenSymbol}
            tokenDecimals={tokenDecimals}
            chainName={chainName}
            walletAddress={walletAddress}
            slippageBps={slippageBps}
            deadlineSeconds={DEADLINE_SECONDS}
          />

          {!quoteFresh && (
            <div className="bg-hood-red/10 border border-hood-red text-hood-red px-3 py-2 rounded text-xs">
              Quote expired. Go back and fetch a new one.
            </div>
          )}

          {activeSim?.isError && (
            <div className="bg-hood-red/10 border border-hood-red text-hood-red px-3 py-2 rounded text-xs">
              Simulation failed: {activeSim.error instanceof Error ? activeSim.error.message : "Transaction would revert"}
            </div>
          )}

          {flowError && (
            <div className="bg-hood-red/10 border border-hood-red text-hood-red px-3 py-2 rounded text-xs">
              {flowError}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={!quoteFresh || !activeSim?.data?.request || activeSim.isFetching}
            className="hd-btn-primary w-full"
          >
            {activeSim?.isFetching ? "Simulating..." : "Confirm & Sign"}
          </button>
          <button onClick={resetFlow} className="w-full text-xs text-hood-muted hover:text-hood-text py-1">
            Cancel
          </button>
        </div>
      )}

      {(step === "signing" || step === "pending") && (
        <div className="space-y-3 text-sm text-center py-4">
          <div className="w-6 h-6 border-2 border-hood-green border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-hood-muted">
            {step === "signing" ? "Waiting for wallet signature..." : "Transaction pending on-chain..."}
          </p>
          {swap.data && explorerTxUrl && (
            <a
              href={explorerTxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-mono text-hood-green hover:underline"
            >
              {shorten(swap.data)} - view on Blockscout
            </a>
          )}
        </div>
      )}

      {step === "confirmed" && (
        <div className="space-y-3 text-sm text-center py-4">
          <p className="text-hood-green font-semibold text-lg">Trade Confirmed</p>
          {swap.data && explorerTxUrl && (
            <a
              href={explorerTxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs font-mono text-hood-green hover:underline"
            >
              {shorten(swap.data)} - view on Blockscout
            </a>
          )}
          {swapReceipt.data && (
            <p className="text-xs text-hood-muted">Gas used: {swapReceipt.data.gasUsed.toString()}</p>
          )}
          {trackingWarning && (
            <p className="text-xs text-hood-muted">{trackingWarning}</p>
          )}
          <button
            onClick={resetFlow}
            className="hd-btn-primary w-full mt-2"
          >
            New Trade
          </button>
        </div>
      )}

      {(step === "reverted" || step === "rejected" || step === "error") && (
        <div className="space-y-3 text-sm text-center py-4">
          <p className="text-hood-red font-semibold text-lg">
            {step === "rejected" ? "Transaction Rejected" : step === "reverted" ? "Transaction Reverted" : "Transaction Failed"}
          </p>
          {flowError && <p className="text-xs text-hood-muted">{flowError}</p>}
          {swap.data && explorerTxUrl && (
            <a
              href={explorerTxUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block text-xs font-mono text-hood-green hover:underline"
            >
              {shorten(swap.data)} - view on Blockscout
            </a>
          )}
          <button
            onClick={resetFlow}
            className="hd-btn-primary w-full mt-2"
          >
            Try Again
          </button>
        </div>
      )}
    </div>
  );
}

function isUserRejection(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const message = "message" in err ? String((err as { message?: unknown }).message) : "";
  const name = "name" in err ? String((err as { name?: unknown }).name) : "";
  return (
    name === "UserRejectedRequestError" ||
    message.toLowerCase().includes("user rejected") ||
    message.toLowerCase().includes("user denied")
  );
}
