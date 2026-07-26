"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  useAccount,
  useBalance,
  useReadContract,
  useSimulateContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { formatUnits, maxUint256, parseUnits, type Address } from "viem";
import { getChain } from "@/src/config/chains";
import { WETH } from "@/src/config/contracts";
import { ERC20_ABI } from "@/src/lib/dex/abi/erc20";
import { ROBINFUN_FACTORY_ABI } from "@/src/lib/dex/abi/robinfun-factory";
import { UNISWAP_V2_ROUTER_ABI } from "@/src/lib/dex/abi/uniswap-v2-router";
import { useNetworkHealth } from "@/src/hooks/use-network-health";
import { useTokenInfo } from "@/components/trading/use-token-info";
import { parseQuote, type ParsedQuote, type QuoteApiResponse } from "@/components/trading/types";
import { TokenSelectModal, NATIVE_ETH, type SelectableToken } from "./token-select-modal";
import { LimitForm } from "./limit-form";
import { DcaForm } from "./dca-form";
import { ActiveDcaOrders } from "./active-dca-orders";
import { trackConfirmedSwap } from "@/src/lib/portfolio/track-swap";

const EXPECTED_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
const DEFAULT_SLIPPAGE_BPS = 100;
const MAX_SLIPPAGE_BPS = 500;
const MAX_PRICE_IMPACT_BPS = 800;
const DEADLINE_SECONDS = 300;
const QUOTE_DEBOUNCE_MS = 500;

type Step =
  | "form"
  | "needs-approval"
  | "approving"
  | "ready"
  | "signing"
  | "pending"
  | "confirmed"
  | "reverted"
  | "rejected"
  | "error";

function shorten(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
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

type SwapTab = "swap" | "limit" | "dca";

function SettingsIcon({ className = "" }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function FlipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  );
}

export function SwapCard({ fixedTokenAddress }: { fixedTokenAddress?: string } = {}) {
  const { address: walletAddress, isConnected, chainId } = useAccount();
  const { data: health } = useNetworkHealth();

  const [activeTab, setActiveTab] = useState<SwapTab>("swap");
  const [sellToken, setSellToken] = useState<SelectableToken>(NATIVE_ETH);
  const [buyToken, setBuyToken] = useState<SelectableToken | null>(null);
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(DEFAULT_SLIPPAGE_BPS);
  const [slippageInput, setSlippageInput] = useState((DEFAULT_SLIPPAGE_BPS / 100).toString());
  const [showSettings, setShowSettings] = useState(false);
  const [pickerSide, setPickerSide] = useState<"sell" | "buy" | null>(null);

  const [quote, setQuote] = useState<ParsedQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("form");
  const [flowError, setFlowError] = useState<string | null>(null);
  const [trackingWarning, setTrackingWarning] = useState<string | null>(null);
  const trackedSwapHash = useRef<string | null>(null);
  const [unlimitedApproval, setUnlimitedApproval] = useState(false);

  const correctChain = isConnected && chainId === EXPECTED_CHAIN_ID;
  const emergencyPause = health?.emergencyPause ?? false;

  // The non-native side of the swap must be a RobinFun token; native ETH maps
  // to WETH for routing. tokenInfo validates allowlist membership.
  const robinfunToken = sellToken.isNative ? buyToken : sellToken;
  const robinfunAddress = robinfunToken && !robinfunToken.isNative ? robinfunToken.address : "";
  const tokenInfoQuery = useTokenInfo(robinfunAddress || fixedTokenAddress || "");
  const tokenInfo = tokenInfoQuery.data;

  // Initialize buyToken if fixedTokenAddress is provided and loaded
  useEffect(() => {
    if (fixedTokenAddress && tokenInfo && !buyToken && tokenInfo.address.toLowerCase() === fixedTokenAddress.toLowerCase()) {
      setBuyToken({
        address: tokenInfo.address,
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        decimals: tokenInfo.decimals,
        dexLive: tokenInfo.dexLive,
      });
    }
  }, [fixedTokenAddress, tokenInfo, buyToken]);

  const isSellNative = sellToken.isNative === true;
  const sellDecimals = sellToken.decimals;
  const buyDecimals = buyToken?.decimals ?? 18;

  const nativeBalance = useBalance({
    address: walletAddress,
    chainId: EXPECTED_CHAIN_ID,
    query: { enabled: Boolean(walletAddress) },
  });

  const sellErc20Balance = useReadContract({
    address: !isSellNative && robinfunAddress ? (robinfunAddress as Address) : undefined,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: walletAddress ? [walletAddress] : undefined,
    chainId: EXPECTED_CHAIN_ID,
    query: { enabled: Boolean(walletAddress && !isSellNative && robinfunAddress) },
  });

  const sellBalance: bigint | null = isSellNative
    ? (nativeBalance.data?.value ?? null)
    : ((sellErc20Balance.data as bigint | undefined) ?? null);

  let amountInWei: bigint | null = null;
  try {
    if (amount && Number(amount) > 0) amountInWei = parseUnits(amount, sellDecimals);
  } catch {
    amountInWei = null;
  }

  const sufficientBalance =
    amountInWei !== null && sellBalance !== null && sellBalance >= amountInWei;

  // ---- Debounced auto-quote (Jupiter-style: quote appears as you type) ----
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quoteSeq = useRef(0);

  const bothSelected = Boolean(sellToken && buyToken);
  const canQuote =
    bothSelected &&
    amountInWei !== null &&
    amountInWei > 0n &&
    Boolean(tokenInfo?.isRobinFun) &&
    !emergencyPause;

  const fetchQuote = useCallback(async () => {
    if (!canQuote || !amountInWei || !buyToken) return;
    const seq = ++quoteSeq.current;
    setQuoteLoading(true);
    setQuoteError(null);
    try {
      const tokenIn = isSellNative ? WETH : (sellToken.address as Address);
      const tokenOut = isSellNative ? (buyToken.address as Address) : WETH;
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
      if (seq !== quoteSeq.current) return; // stale
      if (!res.ok) throw new Error(data.error ?? "Failed to fetch quote");
      const parsed = parseQuote(data.quote as QuoteApiResponse);
      if (parsed.estimatedPriceImpactBps > MAX_PRICE_IMPACT_BPS) {
        setQuote(null);
        setQuoteError(
          `Price impact too high (${(parsed.estimatedPriceImpactBps / 100).toFixed(2)}%). Reduce size.`
        );
        return;
      }
      setQuote(parsed);
    } catch (e) {
      if (seq !== quoteSeq.current) return;
      setQuote(null);
      setQuoteError(e instanceof Error ? e.message : "Failed to fetch quote");
    } finally {
      if (seq === quoteSeq.current) setQuoteLoading(false);
    }
  }, [canQuote, amountInWei, buyToken, isSellNative, sellToken.address, slippageBps]);

  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    setStep("form");
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    if (!canQuote) return;
    quoteTimer.current = setTimeout(fetchQuote, QUOTE_DEBOUNCE_MS);
    return () => {
      if (quoteTimer.current) clearTimeout(quoteTimer.current);
    };
  }, [fetchQuote, canQuote]);

  const quoteFresh = Boolean(quote && Math.floor(Date.now() / 1000) < quote.expiresAt);

  // Live countdown to quote expiry for the details accordion.
  const [quoteSecondsLeft, setQuoteSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!quote) {
      setQuoteSecondsLeft(null);
      return;
    }
    const update = () => setQuoteSecondsLeft(Math.max(0, quote.expiresAt - Math.floor(Date.now() / 1000)));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [quote]);

  // ---- Allowance (only when selling the ERC-20 side) ----
  const allowanceRead = useReadContract({
    address: !isSellNative && robinfunAddress ? (robinfunAddress as Address) : undefined,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: walletAddress && quote ? [walletAddress, quote.approvalTarget] : undefined,
    chainId: EXPECTED_CHAIN_ID,
    query: { enabled: Boolean(walletAddress && !isSellNative && robinfunAddress && quote) },
  });

  const needsApproval =
    !isSellNative &&
    quote !== null &&
    allowanceRead.data !== undefined &&
    (allowanceRead.data as bigint) < quote.amountIn;

  // ---- Approval ----
  const approve = useWriteContract();
  const approveReceipt = useWaitForTransactionReceipt({ hash: approve.data });

  useEffect(() => {
    if (approveReceipt.isSuccess && step === "approving") {
      allowanceRead.refetch().then(() => setStep("ready"));
    }
    if (approveReceipt.isError && step === "approving") {
      setFlowError("Approval transaction reverted.");
      setStep("needs-approval");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveReceipt.isSuccess, approveReceipt.isError]);

  async function handleApprove() {
    if (!quote || !robinfunAddress) return;
    setFlowError(null);
    try {
      const amountToApprove = unlimitedApproval ? maxUint256 : quote.amountIn;
      await approve.writeContractAsync({
        address: robinfunAddress as Address,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [quote.approvalTarget, amountToApprove],
        chainId: EXPECTED_CHAIN_ID,
      });
      setStep("approving");
    } catch (e) {
      setFlowError(isUserRejection(e) ? "Approval rejected in wallet." : e instanceof Error ? e.message : "Approval failed");
    }
  }

  // ---- Simulation (curve vs V2 x buy vs sell) ----
  const readyToSimulate = step === "ready" && quoteFresh && Boolean(walletAddress) && Boolean(quote);
  const curveEnabled = readyToSimulate && quote?.route.kind === "curve";
  const v2Enabled = readyToSimulate && quote?.route.kind === "v2";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const deadline = useMemo(() => BigInt(Math.floor(Date.now() / 1000) + DEADLINE_SECONDS), [step]);

  const simCurveBuy = useSimulateContract({
    address: quote?.route.factoryAddress,
    abi: ROBINFUN_FACTORY_ABI,
    functionName: "buy",
    args: quote && !isSellNative ? [sellToken.address as Address, quote.minimumAmountOut] : undefined,
    value: quote?.amountIn,
    account: walletAddress,
    chainId: EXPECTED_CHAIN_ID,
    query: { enabled: curveEnabled && isSellNative },
  });

  const simCurveSell = useSimulateContract({
    address: quote?.route.factoryAddress,
    abi: ROBINFUN_FACTORY_ABI,
    functionName: "sell",
    args: quote && !isSellNative ? [sellToken.address as Address, quote.amountIn, quote.minimumAmountOut] : undefined,
    account: walletAddress,
    chainId: EXPECTED_CHAIN_ID,
    query: { enabled: curveEnabled && !isSellNative },
  });

  const simV2Buy = useSimulateContract({
    address: quote?.route.routerAddress,
    abi: UNISWAP_V2_ROUTER_ABI,
    functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
    args: quote && walletAddress && buyToken
      ? [quote.minimumAmountOut, [WETH, buyToken.address as Address], walletAddress, deadline]
      : undefined,
    value: quote?.amountIn,
    account: walletAddress,
    chainId: EXPECTED_CHAIN_ID,
    query: { enabled: v2Enabled && isSellNative },
  });

  const simV2Sell = useSimulateContract({
    address: quote?.route.routerAddress,
    abi: UNISWAP_V2_ROUTER_ABI,
    functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens",
    args: quote && walletAddress
      ? [quote.amountIn, quote.minimumAmountOut, [sellToken.address as Address, WETH], walletAddress, deadline]
      : undefined,
    account: walletAddress,
    chainId: EXPECTED_CHAIN_ID,
    query: { enabled: v2Enabled && !isSellNative },
  });

  const activeSim = curveEnabled
    ? isSellNative ? simCurveBuy : simCurveSell
    : v2Enabled
      ? isSellNative ? simV2Buy : simV2Sell
      : null;

  // Submit once simulation resolves after entering "ready" — the simulation
  // hooks only activate on the render where step === "ready", so the write
  // must be triggered from an effect, not the click handler.
  useEffect(() => {
    if (step !== "ready") return;
    if (!activeSim) return;
    if (activeSim.isFetching) return;
    if (activeSim.isError) {
      setStep("error");
      setFlowError(
        activeSim.error instanceof Error ? activeSim.error.message : "Simulation failed"
      );
      return;
    }
    if (activeSim.data?.request) {
      void handleSwap();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, activeSim?.isFetching, activeSim?.isError, activeSim?.data]);

  // ---- Submit ----
  const swap = useWriteContract();
  const swapReceipt = useWaitForTransactionReceipt({ hash: swap.data });

  useEffect(() => {
    if (swap.data && step === "signing") setStep("pending");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swap.data]);

  useEffect(() => {
    if (swapReceipt.isSuccess && step === "pending") {
      const confirmed = swapReceipt.data.status === "success";
      setStep(confirmed ? "confirmed" : "reverted");
      if (
        confirmed &&
        swap.data &&
        robinfunAddress &&
        trackedSwapHash.current !== swap.data
      ) {
        trackedSwapHash.current = swap.data;
        setTrackingWarning(null);
        void trackConfirmedSwap(
          swap.data,
          robinfunAddress as Address
        ).catch((error) => {
          setTrackingWarning(
            error instanceof Error
              ? `Portfolio history was not recorded: ${error.message}`
              : "Portfolio history was not recorded."
          );
        });
      }
      nativeBalance.refetch();
      sellErc20Balance.refetch();
      allowanceRead.refetch();
    }
    if (swapReceipt.isError && step === "pending") {
      setStep("reverted");
      setFlowError("Failed to confirm transaction receipt.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [swapReceipt.isSuccess, swapReceipt.isError, swapReceipt.data]);

  async function handleSwap() {
    if (!activeSim?.data?.request) {
      setFlowError("Simulation failed or not ready.");
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

  function flip() {
    if (fixedTokenAddress) return; // Disable flip in terminal mode
    if (!buyToken) return;
    setSellToken(buyToken);
    setBuyToken(sellToken);
    setAmount("");
    setQuote(null);
    setStep("form");
  }

  function reset() {
    setAmount("");
    setQuote(null);
    setQuoteError(null);
    setFlowError(null);
    setTrackingWarning(null);
    setStep("form");
    swap.reset();
    approve.reset();
  }

  let explorerTxUrl: string | undefined;
  try {
    if (swap.data) explorerTxUrl = `${getChain(EXPECTED_CHAIN_ID).explorerUrl}/tx/${swap.data}`;
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

  // Primary button label/state (Jupiter's single action button)
  let buttonLabel = "Select tokens";
  let buttonAction: (() => void) | null = null;
  let buttonDisabled = true;

  if (!isConnected) buttonLabel = "Connect wallet";
  else if (!correctChain) buttonLabel = `Switch to ${chainName}`;
  else if (emergencyPause) buttonLabel = "Trading paused";
  else if (!bothSelected) buttonLabel = "Select tokens";
  else if (tokenInfoQuery.isError) buttonLabel = "Token not supported";
  else if (!amountInWei || amountInWei <= 0n) buttonLabel = "Enter an amount";
  else if (!sufficientBalance) buttonLabel = `Insufficient ${sellToken.symbol} balance`;
  else if (quoteLoading) buttonLabel = "Quoting...";
  else if (quoteError) buttonLabel = "Quote unavailable";
  else if (!quote) buttonLabel = "Enter an amount";
  else if (needsApproval && step !== "approving") {
    buttonLabel = `Approve ${sellToken.symbol}`;
    buttonAction = handleApprove;
    buttonDisabled = false;
  } else if (step === "approving") buttonLabel = "Approving...";
  else if (step === "form" || step === "ready" || step === "needs-approval") {
    if (!quoteFresh) buttonLabel = "Quote expired - refresh";
    else {
      buttonLabel = "Swap";
      buttonAction = () => {
        // Entering "ready" activates the simulation hooks; the effect above
        // submits the swap once the simulated request is available.
        setStep("ready");
      };
      buttonDisabled = false;
    }
  }

  const inFlight = step === "signing" || step === "pending";
  const terminal = step === "confirmed" || step === "reverted" || step === "rejected" || step === "error";

  return (
    <div className="w-full max-w-md flex flex-col items-center">
      <div className="bg-hood-panel border border-hood-border rounded-2xl p-4 w-full shadow-card animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-0.5 bg-hood-bg rounded-xl p-0.5 border border-hood-border">
          {(["swap", "limit", "dca"] as SwapTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-all ${
                activeTab === tab
                  ? "bg-hood-green text-black shadow-sm"
                  : "text-hood-muted hover:text-hood-text"
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
        {activeTab === "swap" && (
          <button
            onClick={() => setShowSettings((s) => !s)}
            className={`p-1.5 rounded-lg transition-colors ${showSettings ? "text-hood-green bg-hood-greenDim" : "text-hood-muted hover:text-hood-text hover:bg-hood-well"}`}
            aria-label="Settings"
          >
            <SettingsIcon />
          </button>
        )}
      </div>

      {/* Slippage settings: slide-down panel */}
      <div
        className={`grid transition-all duration-200 ease-out ${
          showSettings ? "grid-rows-[1fr] opacity-100 mb-3" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="p-3 bg-hood-bg rounded-xl border border-hood-border">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-medium text-hood-text">Slippage tolerance</div>
              <div className={`text-xs font-mono ${slippageBps > 300 ? "text-hood-amber" : "text-hood-muted"}`}>
                {(slippageBps / 100).toFixed(2)}%
              </div>
            </div>
            <div className="flex gap-1.5">
              {[50, 100, 300].map((bps) => (
                <button
                  key={bps}
                  onClick={() => {
                    setSlippageBps(bps);
                    setSlippageInput((bps / 100).toString());
                  }}
                  className={`flex-1 py-1.5 text-xs rounded-lg font-medium transition-all active:scale-[0.98] ${
                    slippageBps === bps
                      ? "bg-hood-green text-black shadow-sm"
                      : "bg-hood-panel border border-hood-border text-hood-muted hover:text-hood-text hover:border-hood-borderLight"
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
                    const pct = Number(e.target.value);
                    const value = e.target.value;
                    if (value !== "" && !/^\d*\.?\d*$/.test(value)) return;
                    setSlippageInput(value);
                    if (value === "" || Number.isNaN(pct)) return;
                    setSlippageBps(Math.min(Math.max(Math.round(pct * 100), 1), MAX_SLIPPAGE_BPS));
                  }}
                  onBlur={() => {
                    if (slippageInput === "") setSlippageInput((slippageBps / 100).toString());
                  }}
                  className="w-full bg-hood-panel border border-hood-border rounded-lg px-2 py-1.5 text-xs font-mono text-hood-text focus:outline-none focus:border-hood-green/50 text-right pr-5"
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-hood-muted text-[10px]">%</span>
              </div>
            </div>
            {slippageBps > 300 && (
              <div className="mt-2 text-[11px] text-hood-amber flex items-center gap-1.5">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                High slippage increases risk of front-running
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === "swap" && (
        <>
          {/* Sell panel — red tint when amount exceeds balance */}
          <div
            className={`rounded-2xl p-4 border transition-colors ${
              amountInWei !== null && sellBalance !== null && amountInWei > sellBalance
                ? "bg-hood-redDim/40 border-hood-red/40"
                : "bg-hood-well border-transparent focus-within:border-hood-green/40"
            }`}
          >
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-medium text-hood-muted">You&apos;re selling</span>
              {isConnected && sellBalance !== null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-hood-muted font-mono">
                    {Number(formatUnits(sellBalance, sellDecimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })}
                  </span>
                  <div className="flex gap-0.5">
                    {[25, 50, 75].map((pct) => (
                      <button
                        key={pct}
                        onClick={() => {
                          const v = (sellBalance * BigInt(pct)) / 100n;
                          setAmount(formatUnits(v, sellDecimals));
                        }}
                        className="px-1.5 py-0.5 text-[10px] font-semibold text-hood-muted hover:text-hood-green hover:bg-hood-greenDim rounded transition-colors"
                      >
                        {pct}%
                      </button>
                    ))}
                    <button
                      onClick={() => setAmount(formatUnits(sellBalance, sellDecimals))}
                      className="px-1.5 py-0.5 text-[10px] font-semibold text-hood-green bg-hood-greenDim hover:brightness-125 rounded transition-all"
                    >
                      MAX
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "" || /^\d*\.?\d*$/.test(v)) setAmount(v);
                }}
                placeholder="0.00"
                className="flex-1 bg-transparent text-[28px] leading-8 font-mono text-hood-text placeholder:text-hood-muted/40 focus:outline-none min-w-0"
              />
              <TokenButton token={sellToken} onClick={() => !fixedTokenAddress && setPickerSide("sell")} disabled={!!fixedTokenAddress} />
            </div>
            {amountInWei !== null && sellBalance !== null && amountInWei > sellBalance && (
              <div className="mt-1.5 text-[11px] text-hood-red">
                Amount exceeds available balance
              </div>
            )}
          </div>

          {/* Flip — overlaps both panels, rotates on hover */}
          <div className="flex justify-center -my-[18px] relative z-10">
            <button
              onClick={flip}
              disabled={!buyToken || !!fixedTokenAddress}
              className="w-9 h-9 rounded-xl bg-hood-panel border-4 border-hood-bg text-hood-muted hover:text-hood-green hover:border-hood-greenDim transition-all hover:rotate-180 duration-300 disabled:opacity-40 disabled:hover:rotate-0 flex items-center justify-center"
              aria-label="Flip direction"
            >
              <FlipIcon />
            </button>
          </div>

          {/* Buy panel */}
          <div className="bg-hood-well rounded-2xl p-4 border border-transparent">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-medium text-hood-muted">You&apos;re buying</span>
              {quoteLoading && (
                <span className="text-[10px] text-hood-muted uppercase tracking-wider">quoting</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <div
                className={`flex-1 text-[28px] leading-8 font-mono min-w-0 truncate transition-opacity ${
                  quote ? "text-hood-text" : "text-hood-muted/40"
                } ${quoteLoading ? "animate-pulse-soft" : ""}`}
              >
                {quoteLoading
                  ? "…"
                  : quote
                    ? Number(formatUnits(quote.expectedAmountOut, buyDecimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })
                    : "0.00"}
              </div>
              <TokenButton token={buyToken} onClick={() => !fixedTokenAddress && setPickerSide("buy")} placeholder disabled={!!fixedTokenAddress} />
            </div>
          </div>

          {/* Quote details — Jupiter-style accordion */}
          {quote && !quoteLoading && (
            <QuoteDetails
              quote={quote}
              sellSymbol={sellToken.symbol}
              buySymbol={buyToken?.symbol ?? ""}
              sellDecimals={sellDecimals}
              buyDecimals={buyDecimals}
              slippageBps={slippageBps}
              secondsLeft={quoteSecondsLeft}
            />
          )}

          {quoteError && (
            <div className="mt-3 bg-hood-red/10 border border-hood-red text-hood-red px-3 py-2 rounded text-xs">
              {quoteError}
            </div>
          )}
          {flowError && !terminal && (
            <div className="mt-3 bg-hood-red/10 border border-hood-red text-hood-red px-3 py-2 rounded text-xs">
              {flowError}
            </div>
          )}
          {activeSim?.isError && step === "ready" && (
            <div className="mt-3 bg-hood-red/10 border border-hood-red text-hood-red px-3 py-2 rounded text-xs">
              Simulation failed: {activeSim.error instanceof Error ? activeSim.error.message : "Transaction would revert"}
            </div>
          )}

          {/* Approval explainer (shown when approval is the next action) */}
          {needsApproval && (step === "form" || step === "needs-approval") && (
            <div className="mt-3 text-xs text-hood-muted space-y-2">
              <p>
                HoodDesk needs permission for{" "}
                <span className="font-mono text-hood-text">{shorten(quote!.approvalTarget)}</span> to
                spend {sellToken.symbol} before this swap. Standard one-time ERC-20 approval.
              </p>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={unlimitedApproval}
                  onChange={(e) => setUnlimitedApproval(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Approve unlimited instead of exact amount.{" "}
                  <span className="text-hood-red font-semibold">Not recommended for one-off trades.</span>
                </span>
              </label>
            </div>
          )}

          {/* Primary action */}
          {!inFlight && !terminal && (
            <button
              onClick={() => buttonAction?.()}
              disabled={buttonDisabled}
              className={`mt-4 w-full font-bold text-lg py-4 rounded-2xl transition-all flex items-center justify-center gap-2 active:scale-[0.99] ${
                buttonDisabled
                  ? "bg-hood-border text-hood-muted cursor-not-allowed"
                  : "bg-hood-green text-black hover:brightness-110 hover:shadow-glow"
              }`}
            >
              {(approve.isPending || approveReceipt.isLoading || buttonLabel === "Quoting...") && (
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
              )}
              {approve.isPending || approveReceipt.isLoading ? "Confirm in wallet..." : buttonLabel}
            </button>
          )}
        </>
      )}
      {activeTab === "limit" && <LimitForm fixedTokenAddress={fixedTokenAddress} />}
      {activeTab === "dca" && <DcaForm fixedTokenAddress={fixedTokenAddress} />}

      {/* In-flight */}
      {activeTab === "swap" && inFlight && (
        <div className="mt-4 text-center space-y-2 py-2">
          <div className="w-6 h-6 border-2 border-hood-green border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-hood-muted">
            {step === "signing" ? "Confirm in your wallet..." : "Transaction pending..."}
          </p>
          {explorerTxUrl && (
            <a href={explorerTxUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-mono text-hood-green hover:underline">
              {shorten(swap.data!)} - view on Blockscout
            </a>
          )}
        </div>
      )}

      {/* Terminal states */}
      {terminal && (
        <div className="mt-4 text-center space-y-2 py-2">
          <p className={`font-semibold ${step === "confirmed" ? "text-hood-green" : "text-hood-red"}`}>
            {step === "confirmed"
              ? "Swap confirmed"
              : step === "rejected"
                ? "Rejected in wallet"
                : step === "reverted"
                  ? "Transaction reverted"
                  : "Transaction failed"}
          </p>
          {flowError && <p className="text-xs text-hood-muted">{flowError}</p>}
          {step === "confirmed" && trackingWarning && (
            <p className="text-xs text-hood-muted">{trackingWarning}</p>
          )}
          {explorerTxUrl && (
            <a href={explorerTxUrl} target="_blank" rel="noopener noreferrer" className="block text-xs font-mono text-hood-green hover:underline">
              {shorten(swap.data!)} - view on Blockscout
            </a>
          )}
          <button
            onClick={reset}
            className="w-full bg-hood-green text-black font-semibold py-2.5 rounded-lg hover:bg-hood-green/90 transition-colors"
          >
            New swap
          </button>
        </div>
      )}

      {/* Token picker modal */}
      <TokenSelectModal
        open={pickerSide !== null}
        onClose={() => setPickerSide(null)}
        excludeAddress={pickerSide === "sell" ? buyToken?.address : sellToken.address}
        walletAddress={walletAddress}
        prioritizeBalances={pickerSide === "sell"}
        onSelect={(t) => {
          if (pickerSide === "sell") {
            setSellToken(t);
            if (buyToken && t.address.toLowerCase() === buyToken.address.toLowerCase()) {
              setBuyToken(sellToken);
            }
          } else {
            setBuyToken(t);
            if (t.address.toLowerCase() === sellToken.address.toLowerCase()) {
              setSellToken(buyToken ?? NATIVE_ETH);
            }
          }
          setQuote(null);
          setStep("form");
        }}
      />
    </div>
    {activeTab === "dca" && <ActiveDcaOrders />}
    </div>
  );
}

function TokenButton({
  token,
  onClick,
  placeholder,
  disabled,
}: {
  token: SelectableToken | null;
  onClick: () => void;
  placeholder?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-2 px-3 py-1.5 rounded-full font-medium transition-all ${
        placeholder && !token
          ? "bg-hood-green text-black hover:brightness-110"
          : "bg-hood-panel border border-hood-border hover:border-hood-borderLight text-hood-text"
      } ${disabled ? "opacity-90 cursor-default" : ""}`}
    >
      {token ? (
        <>
          <span className="font-semibold text-sm">{token.symbol}</span>
        </>
      ) : (
        <span className={`text-sm ${placeholder && !token ? "text-black font-semibold" : "text-hood-muted"}`}>
          {placeholder ? "Select token" : "Select"}
        </span>
      )}
      <span className={`text-xs ${placeholder && !token ? "text-black font-bold" : "text-hood-muted"}`}>▾</span>
    </button>
  );
}

function QuoteDetails({
  quote,
  sellSymbol,
  buySymbol,
  sellDecimals,
  buyDecimals,
  slippageBps,
  secondsLeft,
}: {
  quote: ParsedQuote;
  sellSymbol: string;
  buySymbol: string;
  sellDecimals: number;
  buyDecimals: number;
  slippageBps: number;
  secondsLeft: number | null;
}) {
  const [open, setOpen] = useState(false);
  const inAmt = Number(formatUnits(quote.amountIn, sellDecimals));
  const outAmt = Number(formatUnits(quote.expectedAmountOut, buyDecimals));
  const rate = inAmt > 0 ? outAmt / inAmt : 0;
  const impact = quote.estimatedPriceImpactBps;
  const warn = impact >= 500;
  const expired = secondsLeft !== null && secondsLeft <= 0;

  return (
    <div
      className={`mt-3 rounded-xl border transition-colors ${
        expired ? "border-hood-red/40 bg-hood-redDim/20" : "border-hood-border bg-hood-bg"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-xs group"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-hood-muted shrink-0">1 {sellSymbol}</span>
          <span className="text-hood-muted shrink-0">≈</span>
          <span className="font-mono text-hood-text truncate">
            {rate > 0 ? rate.toPrecision(6) : "-"} {buySymbol}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {secondsLeft !== null && (
            <span
              className={`font-mono text-[10px] tabular-nums ${
                expired ? "text-hood-red" : secondsLeft < 10 ? "text-hood-amber" : "text-hood-muted"
              }`}
            >
              {expired ? "expired" : `${secondsLeft}s`}
            </span>
          )}
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`text-hood-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </button>
      <div
        className={`grid transition-all duration-200 ease-out ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="px-3 pb-3 pt-1 space-y-1.5 text-xs border-t border-hood-border/50">
            <DetailRow
              label="Minimum received"
              value={`${Number(formatUnits(quote.minimumAmountOut, buyDecimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${buySymbol}`}
            />
            <DetailRow
              label="Route"
              value={quote.route.kind === "curve" ? "RobinFun Bonding Curve" : "RobinFun V2 Pool"}
            />
            <DetailRow label="Slippage" value={`${(slippageBps / 100).toFixed(2)}%`} />
            {impact > 0 && (
              <DetailRow
                label="Price impact"
                value={`${(impact / 100).toFixed(2)}%`}
                warn={warn}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailRow({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-hood-muted">{label}</span>
      <span className={`font-mono ${warn ? "text-hood-red" : ""}`}>{value}</span>
    </div>
  );
}
