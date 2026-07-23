import { describe, it, expect } from "vitest";

type OrderStatus = "ARMED" | "TRIGGERED" | "EXECUTING" | "CONFIRMED" | "CANCELLED" | "FAILED" | "PAUSED";

function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  const valid: Record<OrderStatus, OrderStatus[]> = {
    ARMED: ["TRIGGERED", "CANCELLED", "PAUSED"],
    TRIGGERED: ["EXECUTING", "FAILED"],
    EXECUTING: ["CONFIRMED", "FAILED"],
    CONFIRMED: [],
    CANCELLED: [],
    FAILED: ["ARMED"],
    PAUSED: ["ARMED", "CANCELLED"],
  };
  return valid[from].includes(to);
}

describe("Order state transitions", () => {
  it("allows ARMED to TRIGGERED", () => {
    expect(canTransition("ARMED", "TRIGGERED")).toBe(true);
  });

  it("allows ARMED to CANCELLED", () => {
    expect(canTransition("ARMED", "CANCELLED")).toBe(true);
  });

  it("allows EXECUTING to CONFIRMED", () => {
    expect(canTransition("EXECUTING", "CONFIRMED")).toBe(true);
  });

  it("rejects CONFIRMED to anything", () => {
    expect(canTransition("CONFIRMED", "ARMED")).toBe(false);
    expect(canTransition("CONFIRMED", "CANCELLED")).toBe(false);
  });

  it("rejects CANCELLED to anything", () => {
    expect(canTransition("CANCELLED", "ARMED")).toBe(false);
  });

  it("allows PAUSED to ARMED", () => {
    expect(canTransition("PAUSED", "ARMED")).toBe(true);
  });
});
