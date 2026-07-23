"use client";

import { Fragment, useEffect, useState } from "react";
import { getChain } from "@/src/config/chains";
import { useAccount, useSignMessage } from "wagmi";
import { generateAuthMessage } from "@/src/lib/security/signature";
import { formatUnits } from "viem";

interface Order {
  id: string;
  chainId: number;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  triggerPrice: string;
  triggerDirection: string;
  orderType: string;
  status: string;
  createdAt: string;
  triggeredAt?: string | null;
  transactionHash?: string;
  failureReason?: string | null;
}

interface OrderEvent {
  id: string;
  eventType: string;
  message?: string | null;
  createdAt: string;
}

interface OrderDetail extends Order {
  executions: {
    id: string;
    attempt: number;
    status: string;
    transactionHash?: string | null;
    errorMessage?: string | null;
  }[];
  events: OrderEvent[];
}

// The PATCH handler blocks cancel once EXECUTING or CONFIRMED (already broadcast/settled),
// except for EXECUTING orders stuck >10 min without settling (never-broadcast tx).
const NOT_CANCELLABLE_STATUSES = new Set(["EXECUTING", "CONFIRMED", "COMPLETED", "CANCELLED", "FAILED", "EXPIRED"]);
const STUCK_EXECUTING_MS = 10 * 60 * 1000;

function isCancellable(order: Order) {
  if (order.status === "EXECUTING" && order.triggeredAt) {
    if (Date.now() - new Date(order.triggeredAt).getTime() > STUCK_EXECUTING_MS) return true;
  }
  return !NOT_CANCELLABLE_STATUSES.has(order.status);
}
function isPausable(status: string) {
  return status === "ARMED";
}
function isResumable(status: string) {
  return status === "PAUSED";
}

export default function OrdersPage() {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    loadOrders();
  }, []);

  async function loadOrders() {
    setLoading(true);
    try {
      const res = await fetch("/api/orders");
      const data = await res.json();
      setOrders(data.orders ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function toggleDetails(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      setDetail(null);
      setDetailError(null);
      return;
    }
    setExpandedId(id);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/orders/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load order details");
      setDetail(data.order);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to load order details");
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshDetail(id: string) {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const res = await fetch(`/api/orders/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load order details");
      setDetail(data.order);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Failed to load order details");
    } finally {
      setDetailLoading(false);
    }
  }

  async function performAction(order: Order, action: "cancel" | "pause" | "resume") {
    if (action === "cancel") {
      const confirmed = window.confirm(
        "Cancel this order? This cannot be undone. If it has already started broadcasting, cancellation may fail."
      );
      if (!confirmed) return;
    }

    setActionLoading(`${order.id}:${action}`);
    setRowErrors((prev) => {
      const next = { ...prev };
      delete next[order.id];
      return next;
    });

    try {
      if (!address) throw new Error("Wallet not connected");
      const timestamp = Date.now();
      const authAction = action === "cancel" ? "Cancel Order" : action === "pause" ? "Pause Order" : action === "resume" ? "Resume Order" : "Modify Order";
      const message = generateAuthMessage(authAction, address, timestamp, { action, orderId: order.id });
      const signature = await signMessageAsync({ message });

      const res = await fetch(`/api/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, signature, timestamp }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? `Failed to ${action} order`);
      }
      await loadOrders();
      if (expandedId === order.id) {
        await refreshDetail(order.id);
      }
    } catch (err) {
      setRowErrors((prev) => ({
        ...prev,
        [order.id]: err instanceof Error ? err.message : `Failed to ${action} order`,
      }));
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="hd-page">
      <h1 className="hd-h1 mb-6">Orders</h1>

      {loading ? (
        <div className="hd-card p-4 space-y-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-12 bg-hood-well/50 rounded-lg animate-pulse-soft" />
          ))}
        </div>
      ) : orders.length === 0 ? (
        <div className="hd-card p-12 text-center">
          <p className="text-hood-muted text-sm">No orders yet.</p>
          <p className="text-hood-muted/60 text-xs mt-2">Create an automated order from the Trade page.</p>
        </div>
      ) : (
        <div className="hd-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="hd-table">
              <thead>
                <tr>
                  <th className="pl-4">Type</th>
                  <th className="text-right">Amount In</th>
                  <th className="text-right">Trigger Price</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Tx Hash</th>
                  <th className="pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => {
                  const rowKey = order.id;
                  const cancelling = actionLoading === `${rowKey}:cancel`;
                  const pausing = actionLoading === `${rowKey}:pause`;
                  const resuming = actionLoading === `${rowKey}:resume`;
                  const anyActionPending = actionLoading?.startsWith(`${rowKey}:`) ?? false;
                  let explorerUrl: string | null = null;
                  try {
                    explorerUrl = getChain(order.chainId).explorerUrl;
                  } catch {
                    explorerUrl = null;
                  }

                  return (
                    <Fragment key={rowKey}>
                      <tr>
                        <td className="pl-4 font-medium">{order.orderType}</td>
                        <td className="font-mono text-right">{Number(formatUnits(BigInt(order.amountIn), 18)).toLocaleString(undefined, { maximumFractionDigits: 6 })}</td>
                        <td className="font-mono text-right">{order.triggerPrice}</td>
                        <td>
                          <StatusBadge status={order.status} />
                        </td>
                        <td className="text-hood-muted">
                          {new Date(order.createdAt).toLocaleString()}
                        </td>
                        <td className="font-mono text-hood-muted">
                          {order.transactionHash ? (
                            <a
                              href={`${explorerUrl ?? "https://robinhoodchain.blockscout.com"}/tx/${order.transactionHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:text-hood-green transition-colors"
                            >
                              {order.transactionHash.slice(0, 10)}...
                            </a>
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="pr-4">
                          <div className="flex gap-2 justify-end items-center">
                            <button
                              onClick={() => toggleDetails(order.id)}
                              className="hd-btn-ghost px-3 py-1 text-xs"
                            >
                              {expandedId === order.id ? "Hide" : "Details"}
                            </button>
                            {isPausable(order.status) && (
                              <button
                                onClick={() => performAction(order, "pause")}
                                disabled={anyActionPending}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-hood-amber bg-hood-amberDim hover:brightness-125 active:scale-[0.98] transition-all disabled:opacity-50"
                              >
                                {pausing ? "Pausing..." : "Pause"}
                              </button>
                            )}
                            {isResumable(order.status) && (
                              <button
                                onClick={() => performAction(order, "resume")}
                                disabled={anyActionPending}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-hood-green bg-hood-greenDim hover:brightness-125 active:scale-[0.98] transition-all disabled:opacity-50"
                              >
                                {resuming ? "Resuming..." : "Resume"}
                              </button>
                            )}
                            {isCancellable(order) && (
                              <button
                                onClick={() => performAction(order, "cancel")}
                                disabled={anyActionPending}
                                className="px-3 py-1.5 rounded-lg text-xs font-semibold text-hood-red bg-hood-redDim hover:brightness-125 active:scale-[0.98] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                              >
                                {cancelling ? "Cancelling..." : "Cancel"}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                      {rowErrors[order.id] && (
                        <tr key={`${rowKey}-error`}>
                          <td colSpan={7} className="px-4 py-2">
                            <div className="hd-error text-xs">{rowErrors[order.id]}</div>
                          </td>
                        </tr>
                      )}
                      {expandedId === order.id && (
                        <tr key={`${rowKey}-detail`} className="bg-hood-well/40">
                          <td colSpan={7} className="py-3 px-4">
                            <OrderDetailsPanel
                              detail={detail}
                              loading={detailLoading}
                              error={detailError}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function OrderDetailsPanel({
  detail,
  loading,
  error,
}: {
  detail: OrderDetail | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) {
    return <div className="text-hood-muted text-xs">Loading order details...</div>;
  }
  if (error) {
    return <div className="hd-error text-xs">{error}</div>;
  }
  if (!detail) return null;

  let explorerUrl: string | null = null;
  try {
    explorerUrl = getChain(detail.chainId).explorerUrl;
  } catch {
    explorerUrl = null;
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
      <Field label="Order ID" value={detail.id} mono />
      <Field label="Trigger Direction" value={detail.triggerDirection === "gte" ? "At or above" : "At or below"} />
      <Field label="Trigger Price" value={detail.triggerPrice} mono />
      <Field label="Token In" value={detail.tokenIn} mono />
      <Field label="Token Out" value={detail.tokenOut} mono />
      <Field label="Amount In" value={Number(formatUnits(BigInt(detail.amountIn), 18)).toLocaleString(undefined, { maximumFractionDigits: 6 })} mono />
      {detail.status === "FAILED" && detail.failureReason && (
        <Field label="Failure Reason" value={detail.failureReason} danger />
      )}
      {detail.transactionHash && explorerUrl && (
        <div>
          <div className="text-hood-muted mb-1">Transaction</div>
          <a
            href={`${explorerUrl}/tx/${detail.transactionHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-hood-green hover:underline"
          >
            View on Blockscout
          </a>
        </div>
      )}
      {detail.executions.length > 0 && (
        <div className="col-span-2 md:col-span-4">
          <div className="text-hood-muted mb-1">Execution Attempts</div>
          <div className="flex flex-col gap-1">
            {detail.executions.map((ex) => (
              <div key={ex.id} className="flex gap-3 items-center font-mono">
                <span className="text-hood-muted">#{ex.attempt}</span>
                <StatusBadge status={ex.status} />
                {ex.transactionHash && explorerUrl && (
                  <a
                    href={`${explorerUrl}/tx/${ex.transactionHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-hood-green"
                  >
                    {ex.transactionHash.slice(0, 10)}...
                  </a>
                )}
                {ex.errorMessage && <span className="text-hood-red">{ex.errorMessage}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      {detail.events.length > 0 && (
        <div className="col-span-2 md:col-span-4">
          <div className="text-hood-muted mb-1">Event Log</div>
          <div className="flex flex-col gap-1">
            {detail.events.map((ev) => (
              <div key={ev.id} className="flex gap-3">
                <span className="text-hood-muted w-40 shrink-0">
                  {new Date(ev.createdAt).toLocaleString()}
                </span>
                <span>{ev.eventType}</span>
                {ev.message && <span className="text-hood-muted">- {ev.message}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  mono,
  danger,
}: {
  label: string;
  value: string;
  mono?: boolean;
  danger?: boolean;
}) {
  return (
    <div>
      <div className="text-hood-muted mb-1">{label}</div>
      <div className={`${mono ? "font-mono" : ""} ${danger ? "text-hood-red" : ""} break-all`}>
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    DRAFT: "hd-badge-muted",
    PENDING_FUNDING: "hd-badge-yellow",
    ARMED: "hd-badge bg-blue-500/15 text-blue-400",
    TRIGGERED: "hd-badge-yellow",
    EXECUTING: "hd-badge bg-purple-500/15 text-purple-400",
    CONFIRMED: "hd-badge-green",
    CANCELLED: "hd-badge-muted",
    EXPIRED: "hd-badge-muted",
    FAILED: "hd-badge-red",
    PAUSED: "hd-badge-yellow",
  };
  return <span className={styles[status] ?? "hd-badge-muted"}>{status}</span>;
}
