"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { formatUnits } from "viem";
import { WETH } from "@/src/config/contracts";
import { generateAuthMessage } from "@/src/lib/security/signature";

interface DcaOrder {
  id: string;
  orderType: string;
  status: string;
  amountIn: string;
  tokenIn: string;
  tokenOut: string;
  orderSubtype: string;
  metadata?: {
    currentIteration?: number;
    totalIterations?: number;
  };
}

function shorten(address: string) {
  if (!address) return "";
  if (address.toLowerCase() === WETH.toLowerCase()) return "ETH";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function ActiveDcaOrders() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [orders, setOrders] = useState<DcaOrder[]>([]);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const fetchOrders = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`/api/orders?owner=${address}`);
      const data = await res.json();
      const dcaOrders = (data.orders || []).filter(
        (o: DcaOrder) => o.orderType === "DCA" && (o.status === "ARMED" || o.status === "PAUSED")
      );
      setOrders(dcaOrders);
    } catch (e) {
      console.error("Failed to fetch DCA orders:", e);
    }
  }, [address]);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 10000);
    return () => clearInterval(interval);
  }, [fetchOrders]);

  const handleAction = async (orderId: string, action: "cancel" | "pause" | "resume") => {
    if (!address) return;
    if (action === "cancel") {
      const confirmed = window.confirm("Cancel this DCA order? This cannot be undone.");
      if (!confirmed) return;
    }
    setLoadingAction(`${orderId}:${action}`);
    try {
      const timestamp = Date.now();
      const authAction =
        action === "cancel"
          ? "Cancel Order"
          : action === "pause"
          ? "Pause Order"
          : "Resume Order";
      const message = generateAuthMessage(authAction, address, timestamp, { action, orderId });
      const signature = await signMessageAsync({ message });

      const res = await fetch(`/api/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, signature, timestamp }),
      });
      if (res.ok) {
        await fetchOrders();
      } else {
        const errorData = await res.json();
        alert(`Failed to ${action} order: ${errorData.error}`);
      }
    } catch (e) {
      console.error(e);
      alert(`Error trying to ${action} order.`);
    } finally {
      setLoadingAction(null);
    }
  };

  if (!address || orders.length === 0) return null;

  return (
    <div className="space-y-3 w-full animate-fade-in mt-4">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold text-hood-text">Active DCA Orders</h3>
        <span className="text-[10px] uppercase tracking-widest text-hood-muted">{orders.length}</span>
      </div>
      <div className="space-y-2">
        {orders.map((o) => {
          const filled = o.metadata?.currentIteration ?? 0;
          const total = o.metadata?.totalIterations ?? 0;
          const pct = total > 0 ? (filled / total) * 100 : 0;
          return (
            <div
              key={o.id}
              className="bg-hood-panel border border-hood-border rounded-2xl p-4 text-sm shadow-card hover:border-hood-borderLight transition-colors"
            >
              <div className="flex justify-between items-start mb-3">
                <div className="flex flex-col min-w-0">
                  <span className="font-mono text-hood-text text-base truncate">
                    {Number(formatUnits(BigInt(o.amountIn), 18)).toLocaleString(undefined, { maximumFractionDigits: 6 })}{" "}
                    <span className="text-hood-text">{shorten(o.tokenIn)}</span>
                    <span className="text-hood-muted mx-1.5">→</span>
                    <span className="text-hood-text">{shorten(o.tokenOut)}</span>
                  </span>
                  <span className="text-[10px] uppercase tracking-widest text-hood-muted mt-1">{o.orderSubtype}</span>
                </div>
                <span
                  className={`shrink-0 ml-2 px-2 py-0.5 rounded-lg text-[10px] font-semibold uppercase tracking-wide ${
                    o.status === "ARMED"
                      ? "bg-hood-greenDim text-hood-green"
                      : "bg-hood-amberDim text-hood-amber"
                  }`}
                >
                  {o.status}
                </span>
              </div>

              {/* Progress bar */}
              <div className="mb-3">
                <div className="flex items-baseline justify-between mb-1">
                  <span className="text-[10px] uppercase tracking-wider text-hood-muted">Progress</span>
                  <span className="text-[11px] font-mono text-hood-text tabular-nums">
                    {filled} / {total}
                  </span>
                </div>
                <div className="h-1 w-full bg-hood-well rounded-full overflow-hidden">
                  <div
                    className="h-full bg-hood-green rounded-full transition-all duration-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2">
                {o.status === "ARMED" && (
                  <button
                    onClick={() => handleAction(o.id, "pause")}
                    disabled={!!loadingAction}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-hood-amber bg-hood-amberDim hover:brightness-125 active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    {loadingAction === `${o.id}:pause` ? "Pausing..." : "Pause"}
                  </button>
                )}
                {o.status === "PAUSED" && (
                  <button
                    onClick={() => handleAction(o.id, "resume")}
                    disabled={!!loadingAction}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-hood-green bg-hood-greenDim hover:brightness-125 active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    {loadingAction === `${o.id}:resume` ? "Resuming..." : "Resume"}
                  </button>
                )}
                <button
                  onClick={() => handleAction(o.id, "cancel")}
                  disabled={!!loadingAction}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-hood-red bg-hood-redDim hover:brightness-125 active:scale-[0.98] transition-all disabled:opacity-50"
                >
                  {loadingAction === `${o.id}:cancel` ? "Cancelling..." : "Cancel"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
