"use client";

import { useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { parseUnits } from "viem";
import { TokenSelectModal, NATIVE_ETH, type SelectableToken } from "./token-select-modal";
import { generateAuthMessage } from "@/src/lib/security/signature";
import { useTokenInfo } from "@/components/trading/use-token-info";
import { WETH } from "@/src/config/contracts";

const DEFAULT_SLIPPAGE_BPS = 500;
const MAX_PRICE_IMPACT_BPS = 800;

export function DcaForm({ fixedTokenAddress }: { fixedTokenAddress?: string } = {}) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [direction, setDirection] = useState<"buy" | "sell">("buy");
  const [sellToken, setSellToken] = useState<SelectableToken>(NATIVE_ETH);
  const [buyToken, setBuyToken] = useState<SelectableToken | null>(null);
  const [amountPerInterval, setAmountPerInterval] = useState("");
  const [priceLimit, setPriceLimit] = useState(""); // ETH per token; buy=cap, sell=floor
  const [frequency, setFrequency] = useState<"MINUTELY" | "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY">("DAILY");
  const [durationValue, setDurationValue] = useState("1");
  const [durationUnit, setDurationUnit] = useState<"minutes" | "hours" | "days" | "weeks" | "months">("days");
  const [startAt, setStartAt] = useState<string>(
    new Date().toISOString().slice(0, 16)
  );
  const [pickerSide, setPickerSide] = useState<"sell" | "buy" | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const tokenInfoQuery = useTokenInfo(fixedTokenAddress || "");
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
        isNative: false,
      });
    }
  }, [fixedTokenAddress, tokenInfo, buyToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!address || !buyToken) return;
    if (!/^[1-9]\d*$/.test(durationValue)) {
      setError("Duration must be at least 1");
      return;
    }
    if (priceLimit && Number(priceLimit) <= 0) {
      setError("Price condition must be greater than zero");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const duration = Number(durationValue);
      // Calculate total intervals based on duration
      const durationHours =
        durationUnit === "minutes" ? duration / 60 :
        durationUnit === "hours" ? duration :
        durationUnit === "days" ? duration * 24 :
        durationUnit === "weeks" ? duration * 24 * 7 :
        duration * 24 * 30; // months
      const intervalsPerHour =
        frequency === "MINUTELY" ? 60 :
        frequency === "HOURLY" ? 1 :
        frequency === "DAILY" ? 1 / 24 :
        frequency === "WEEKLY" ? 1 / (24 * 7) :
        1 / (24 * 30); // monthly
      const totalIntervals = Math.max(1, Math.floor(durationHours * intervalsPerHour));
      const durationMonths = Math.max(1, Math.ceil(
        durationUnit === "minutes" ? duration / (60 * 24 * 30) :
        durationUnit === "hours" ? duration / (24 * 30) :
        durationUnit === "days" ? duration / 30 :
        durationUnit === "weeks" ? duration / 4.3 :
        duration
      ));

      const amountPerIntervalWei = parseUnits(amountPerInterval, sellToken.decimals);
      const totalAmountWei = amountPerIntervalWei * BigInt(totalIntervals);

      const priceCondition =
        priceLimit && Number(priceLimit) > 0
          ? {
              // Buy DCA: only buy at/below cap; Sell DCA: only sell at/above floor.
              direction: direction === "buy" ? ("lte" as const) : ("gte" as const),
              price: priceLimit,
            }
          : undefined;

      const timestamp = Date.now();
      const authorizationPayload = {
        ownerAddress: address,
        tokenIn: sellToken.isNative ? WETH : sellToken.address,
        tokenOut: buyToken.isNative ? WETH : buyToken.address,
        amountPerInterval: amountPerIntervalWei.toString(),
        totalAmount: totalAmountWei.toString(),
        frequency,
        durationMonths,
        startAt: new Date(startAt).toISOString(),
        dexAdapterId: (!sellToken.isNative && sellToken.dexLive === false) || (buyToken && !buyToken.isNative && buyToken.dexLive === false) ? "robinfun-curve" : "robinfun-v2",
        maximumSlippageBps: DEFAULT_SLIPPAGE_BPS,
        maximumPriceImpactBps: MAX_PRICE_IMPACT_BPS,
        priceCondition,
      };
      const message = generateAuthMessage("Create DCA Order", address, timestamp, authorizationPayload);
      const signature = await signMessageAsync({ message });

      const response = await fetch("/api/orders/dca", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...authorizationPayload,
          signature,
          timestamp,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to create DCA order");

      const conditionText = priceCondition
        ? direction === "buy"
          ? ` when price ≤ ${priceLimit} ETH`
          : ` when price ≥ ${priceLimit} ETH`
        : "";
      setSuccess(`Scheduled ${frequency.toLowerCase()} ${direction === "buy" ? "buys" : "sells"}${conditionText} for ${durationValue} ${durationUnit}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setDirection("buy")}
          className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
            direction === "buy"
              ? "bg-hood-green/20 text-hood-green border border-hood-green/40"
              : "bg-hood-well text-hood-muted border border-transparent hover:border-hood-green/20"
          }`}
        >
          Buy DCA
        </button>
        <button
          type="button"
          onClick={() => setDirection("sell")}
          className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
            direction === "sell"
              ? "bg-hood-red/20 text-hood-red border border-hood-red/40"
              : "bg-hood-well text-hood-muted border border-transparent hover:border-hood-red/20"
          }`}
        >
          Sell DCA
        </button>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-sm text-hood-muted mb-1 block">Sell</label>
          <button
            type="button"
            onClick={() => setPickerSide("sell")}
            className="w-full flex items-center gap-2 bg-hood-well border border-transparent hover:border-hood-green/30 rounded-xl px-4 py-3 transition-colors shadow-inner"
          >
            <span className="font-medium text-[15px] text-hood-text">{sellToken.symbol}</span>
          </button>
        </div>
        <div>
          <label className="text-sm text-hood-muted mb-1 block">Buy</label>
          <button
            type="button"
            onClick={() => setPickerSide("buy")}
            className="w-full flex items-center gap-2 bg-hood-well border border-transparent hover:border-hood-green/30 rounded-xl px-4 py-3 transition-colors shadow-inner"
          >
            <span className="font-medium text-[15px] text-hood-text">{buyToken ? buyToken.symbol : "Select token"}</span>
          </button>
        </div>
      </div>

      <div>
        <label className="text-sm text-hood-muted mb-1 block">Amount per Interval</label>
        <input
          type="text"
          inputMode="decimal"
          value={amountPerInterval}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || /^\d*\.?\d*$/.test(v)) setAmountPerInterval(v);
          }}
          placeholder="0.001"
          className="hd-input w-full font-mono"
        />
      </div>

      <div>
        <label className="text-sm text-hood-muted mb-1 block">Frequency</label>
        <select
          value={frequency}
          onChange={(e) => setFrequency(e.target.value as "MINUTELY" | "HOURLY" | "DAILY" | "WEEKLY" | "MONTHLY")}
          className="hd-input w-full"
        >
          <option value="MINUTELY">Every Minute</option>
          <option value="HOURLY">Every Hour</option>
          <option value="DAILY">Daily</option>
          <option value="WEEKLY">Weekly</option>
          <option value="MONTHLY">Monthly</option>
        </select>
      </div>

      <div>
        <label className="text-sm text-hood-muted mb-1 block">Duration</label>
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="numeric"
            value={durationValue}
            onChange={(e) => {
              const value = e.target.value;
              if (/^\d*$/.test(value)) setDurationValue(value);
            }}
            onFocus={(e) => e.currentTarget.select()}
            className="hd-input w-24"
          />
          <select
            value={durationUnit}
            onChange={(e) => setDurationUnit(e.target.value as typeof durationUnit)}
            className="hd-input flex-1"
          >
            <option value="minutes">Minutes</option>
            <option value="hours">Hours</option>
            <option value="days">Days</option>
            <option value="weeks">Weeks</option>
            <option value="months">Months</option>
          </select>
        </div>
      </div>

      <div>
        <label className="text-sm text-hood-muted mb-1 block">
          {direction === "buy" ? "Max price (ETH per token, optional)" : "Min price (ETH per token, optional)"}
        </label>
        <input
          type="text"
          inputMode="decimal"
          value={priceLimit}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || /^\d*\.?\d*$/.test(v)) setPriceLimit(v);
          }}
          placeholder={direction === "buy" ? "Only buy at or below…" : "Only sell at or above…"}
          className="hd-input w-full font-mono"
        />
        <p className="text-xs text-hood-muted mt-1">
          {direction === "buy"
            ? "Iterations above this price are skipped."
            : "Iterations below this price are skipped."}
        </p>
      </div>

      <div>
        <label className="text-sm text-hood-muted mb-1 block">Start Date & Time</label>
        <div className="flex gap-2">
          <input
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className="hd-input flex-1"
          />
          <button
            type="button"
            onClick={() => setStartAt(new Date().toISOString().slice(0, 16))}
            className="text-xs text-hood-green border border-hood-green/30 hover:bg-hood-green/10 rounded-lg px-3 py-1.5 transition-colors whitespace-nowrap"
          >
            Now
          </button>
        </div>
      </div>


      {error && (
        <div className="bg-hood-red/10 border border-hood-red text-hood-red px-3 py-2 rounded text-xs">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-hood-green/10 border border-hood-green text-hood-green px-3 py-2 rounded text-xs">
          {success}
        </div>
      )}

      <button type="submit" disabled={isSubmitting || !buyToken} className="hd-btn-primary w-full">
        {isSubmitting ? "Creating..." : "Create DCA Order"}
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
