"use client";

import { useState, useEffect } from "react";
import { useTokenInfo } from "@/components/trading/use-token-info";
import { useTokenStats } from "@/components/trading/use-token-stats";
import { useAccount, useBalance, useReadContract, useSignMessage } from "wagmi";
import { formatUnits, parseUnits, type Address } from "viem";
import { TokenSelectModal, NATIVE_ETH, type SelectableToken } from "./token-select-modal";
import { generateAuthMessage } from "@/src/lib/security/signature";
import { WETH } from "@/src/config/contracts";
import { ERC20_ABI } from "@/src/lib/dex/abi/erc20";

type OrderType = "LIMIT_BUY" | "TAKE_PROFIT" | "STOP_LOSS";

const ORDER_TYPE_INFO: Record<OrderType, { label: string; direction: "gte" | "lte"; hint: string }> = {
  LIMIT_BUY: { label: "Limit Buy", direction: "lte", hint: "Buy when price drops to or below trigger" },
  TAKE_PROFIT: { label: "Take Profit", direction: "gte", hint: "Sell when price rises to or above trigger" },
  STOP_LOSS: { label: "Stop Loss", direction: "lte", hint: "Sell when price drops to or below trigger" },
};

const DEFAULT_SLIPPAGE_BPS = 500;
const MAX_PRICE_IMPACT_BPS = 800;
const DEADLINE_SECONDS = 300;
const EXPECTED_CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);

function formatDisplayAmount(value: bigint, decimals: number) {
  const formatted = formatUnits(value, decimals);
  const [whole, fraction = ""] = formatted.split(".");
  const trimmedFraction = fraction.slice(0, 8).replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}

function formatLastPrice(value: string) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return value;
  if (numeric < 0.000001) return numeric.toExponential(4);
  return numeric.toLocaleString(undefined, { maximumFractionDigits: 12 });
}

export function LimitForm({ fixedTokenAddress }: { fixedTokenAddress?: string } = {}) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [orderType, setOrderType] = useState<OrderType>("LIMIT_BUY");
  const [sellToken, setSellToken] = useState<SelectableToken>(NATIVE_ETH);
  const [buyToken, setBuyToken] = useState<SelectableToken | null>(null);
  const [amount, setAmount] = useState("");
  
  const tokenInfoQuery = useTokenInfo(fixedTokenAddress || "");
  const tokenInfo = tokenInfoQuery.data;
  const isSellOrder = orderType !== "LIMIT_BUY";
  const pricedToken = sellToken.isNative ? buyToken : sellToken;
  const pricedTokenAddress = pricedToken && !pricedToken.isNative ? pricedToken.address : "";
  const tokenStatsQuery = useTokenStats(pricedTokenAddress);
  const lastPriceEth = tokenStatsQuery.data?.priceEth;

  // Initialize the fixed token on the side that matches the selected order type.
  useEffect(() => {
    if (!fixedTokenAddress || !tokenInfo || tokenInfo.address.toLowerCase() !== fixedTokenAddress.toLowerCase()) return;

    const fixedToken = {
        address: tokenInfo.address,
        name: tokenInfo.name,
        symbol: tokenInfo.symbol,
        decimals: tokenInfo.decimals,
        dexLive: tokenInfo.dexLive,
    };

    if (isSellOrder) {
      if (sellToken.address.toLowerCase() !== fixedToken.address.toLowerCase()) setSellToken(fixedToken);
      if (!buyToken?.isNative) setBuyToken(NATIVE_ETH);
    } else if (!buyToken || buyToken.address.toLowerCase() !== fixedToken.address.toLowerCase()) {
      setSellToken(NATIVE_ETH);
      setBuyToken(fixedToken);
    }
  }, [fixedTokenAddress, tokenInfo, buyToken, sellToken.address, isSellOrder]);

  const [triggerPrice, setTriggerPrice] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [pickerSide, setPickerSide] = useState<"sell" | "buy" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const nativeBalance = useBalance({
    address: address as Address | undefined,
    chainId: EXPECTED_CHAIN_ID,
    query: { enabled: Boolean(address && sellToken.isNative) },
  });

  const erc20Balance = useReadContract({
    address: !sellToken.isNative && sellToken.address ? (sellToken.address as Address) : undefined,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address as Address] : undefined,
    chainId: EXPECTED_CHAIN_ID,
    query: { enabled: Boolean(address && !sellToken.isNative && sellToken.address) },
  });

  const sellBalance = sellToken.isNative
    ? nativeBalance.data?.value
    : (erc20Balance.data as bigint | undefined);

  function selectOrderType(nextType: OrderType) {
    setOrderType(nextType);
    const nextIsSellOrder = nextType !== "LIMIT_BUY";

    if (nextIsSellOrder && sellToken.isNative && buyToken && !buyToken.isNative) {
      setSellToken(buyToken);
      setBuyToken(NATIVE_ETH);
      setAmount("");
    } else if (!nextIsSellOrder && !sellToken.isNative && buyToken?.isNative) {
      setBuyToken(sellToken);
      setSellToken(NATIVE_ETH);
      setAmount("");
    }
  }

  function applyBalancePercent(percent: number) {
    if (!sellBalance || sellBalance <= 0n) return;
    const value = (sellBalance * BigInt(percent)) / 100n;
    setAmount(formatDisplayAmount(value, sellToken.decimals));
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || !buyToken || !amount || !triggerPrice) return;

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const timestamp = Date.now();
      const amountInWei = parseUnits(amount, sellToken.decimals);
      const authorizationPayload = {
        ownerAddress: address,
        tokenIn: sellToken.isNative ? WETH : sellToken.address,
        tokenOut: buyToken.isNative ? WETH : buyToken.address,
        amountIn: amountInWei.toString(),
        triggerPrice,
        triggerDirection: ORDER_TYPE_INFO[orderType].direction,
        orderType,
        maximumSlippageBps: DEFAULT_SLIPPAGE_BPS,
        maximumPriceImpactBps: MAX_PRICE_IMPACT_BPS,
        deadlineSeconds: DEADLINE_SECONDS,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        dexAdapterId: (!sellToken.isNative && sellToken.dexLive === false) || (buyToken && !buyToken.isNative && buyToken.dexLive === false) ? "robinfun-curve" : "robinfun-v2",
      };
      const message = generateAuthMessage("Create Order", address, timestamp, authorizationPayload);
      const signature = await signMessageAsync({ message });
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...authorizationPayload,
          signature,
          timestamp,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to create order");

      setSuccess(`${ORDER_TYPE_INFO[orderType].label} order placed. View it on the Orders page.`);
      setAmount("");
      setTriggerPrice("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="text-sm text-hood-muted mb-1.5 block">Order Type</label>
        <div className="grid grid-cols-3 gap-1.5">
          {(Object.keys(ORDER_TYPE_INFO) as OrderType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => selectOrderType(t)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-[0.98] ${
                orderType === t
                  ? "bg-hood-green text-black shadow-sm"
                  : "bg-hood-well text-hood-muted hover:text-hood-text"
              }`}
            >
              {ORDER_TYPE_INFO[t].label}
            </button>
          ))}
        </div>
        <p className="text-xs text-hood-muted mt-2">{ORDER_TYPE_INFO[orderType].hint}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm text-hood-muted mb-1.5 block">Sell</label>
          <button
            type="button"
            onClick={() => !fixedTokenAddress && setPickerSide("sell")}
            disabled={!!fixedTokenAddress}
            className="w-full flex items-center justify-center gap-2 bg-hood-well border border-transparent hover:border-hood-green/40 rounded-xl px-4 py-3 transition-colors shadow-inner disabled:opacity-90"
          >
            <span className="font-semibold text-[15px] text-hood-text">{sellToken.symbol}</span>
          </button>
        </div>
        <div>
          <label className="text-sm text-hood-muted mb-1.5 block">Buy</label>
          <button
            type="button"
            onClick={() => !fixedTokenAddress && setPickerSide("buy")}
            disabled={!!fixedTokenAddress}
            className="w-full flex items-center justify-center gap-2 bg-hood-well border border-transparent hover:border-hood-green/40 rounded-xl px-4 py-3 transition-colors shadow-inner disabled:opacity-90"
          >
            <span className="font-semibold text-[15px] text-hood-text">{buyToken ? buyToken.symbol : "Select token"}</span>
          </button>
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <label className="text-sm text-hood-muted block">Amount</label>
          {sellBalance !== undefined && (
            <span className="text-[11px] text-hood-muted font-mono truncate">
              Balance: {formatDisplayAmount(sellBalance, sellToken.decimals)} {sellToken.symbol}
            </span>
          )}
        </div>
        <input
          type="text"
          aria-label="Amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => {
            const value = e.target.value;
            if (value === "" || /^\d*\.?\d*$/.test(value)) setAmount(value);
          }}
          placeholder="0.0"
          min="0"
          step="any"
          className="hd-input w-full"
        />
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {[25, 50, 75, 100].map((percent) => (
            <button
              key={percent}
              type="button"
              onClick={() => applyBalancePercent(percent)}
              disabled={!sellBalance || sellBalance <= 0n}
              className="rounded-lg border border-hood-border bg-hood-well px-2 py-1.5 text-[11px] font-semibold text-hood-muted transition-colors hover:border-hood-green/40 hover:text-hood-text disabled:cursor-not-allowed disabled:opacity-40"
            >
              {percent === 100 ? "Max" : `${percent}%`}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <label className="text-sm text-hood-muted block">Trigger Price (ETH per token)</label>
          {lastPriceEth && (
            <button
              type="button"
              onClick={() => setTriggerPrice(lastPriceEth)}
              className="text-[11px] font-semibold text-hood-green hover:text-hood-green/80"
            >
              Use last: {formatLastPrice(lastPriceEth)}
            </button>
          )}
        </div>
        <input
          type="text"
          aria-label="Trigger Price (ETH per token)"
          inputMode="decimal"
          value={triggerPrice}
          onChange={(e) => {
            const value = e.target.value;
            if (value === "" || /^\d*\.?\d*$/.test(value)) setTriggerPrice(value);
          }}
          placeholder={lastPriceEth ? formatLastPrice(lastPriceEth) : "0.0"}
          min="0"
          step="any"
          className="hd-input w-full"
        />
        <p className="mt-1 text-xs text-hood-muted">
          Limit triggers use ETH per token, not USD. The latest USD estimate can differ with ETH/USD.
        </p>
      </div>

      <div>
        <label className="text-sm text-hood-muted mb-1.5 block">Expiry (optional)</label>
        <div className="flex gap-1.5">
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="hd-input flex-1"
          />
          {[
            { label: "1h", apply: () => { const d = new Date(); d.setHours(d.getHours() + 1); return d; } },
            { label: "1d", apply: () => { const d = new Date(); d.setDate(d.getDate() + 1); return d; } },
            { label: "1w", apply: () => { const d = new Date(); d.setDate(d.getDate() + 7); return d; } },
          ].map(({ label, apply }) => (
            <button
              key={label}
              type="button"
              onClick={() => setExpiresAt(apply().toISOString().slice(0, 16))}
              className="px-3 py-1 text-[11px] font-semibold text-hood-green bg-hood-greenDim hover:brightness-125 active:scale-[0.98] rounded-lg transition-all whitespace-nowrap"
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="bg-hood-red/10 border border-hood-red text-hood-red px-3 py-2 rounded text-xs">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-hood-green/10 border border-hood-green text-hood-green px-3 py-2 rounded text-xs">
          {success}{" "}
          <a href="/orders" className="hd-link">View orders</a>
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting || !buyToken || !amount || !triggerPrice}
        className="hd-btn-primary w-full"
      >
        {isSubmitting ? "Placing order..." : `Place ${ORDER_TYPE_INFO[orderType].label} Order`}
      </button>

      <TokenSelectModal
        open={pickerSide !== null}
        onClose={() => setPickerSide(null)}
        excludeAddress={pickerSide === "sell" ? buyToken?.address : sellToken.address}
        walletAddress={address}
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
        }}
      />
    </form>
  );
}
