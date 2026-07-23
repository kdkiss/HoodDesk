import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActiveDcaOrders } from "../components/swap/active-dca-orders";

const mockOrders = [
  {
    id: "dca-1",
    orderType: "DCA",
    status: "ARMED",
    amountIn: "1000000000000000000",
    tokenIn: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    tokenOut: "0x2222222222222222222222222222222222222222",
    orderSubtype: "DAILY",
    metadata: { currentIteration: 2, totalIterations: 10 },
  },
  {
    id: "dca-2",
    orderType: "DCA",
    status: "PAUSED",
    amountIn: "500000000000000000",
    tokenIn: "0x3333333333333333333333333333333333333333",
    tokenOut: "0x4444444444444444444444444444444444444444",
    orderSubtype: "WEEKLY",
    metadata: { currentIteration: 1, totalIterations: 5 },
  },
];

const signMessageAsync = vi.fn().mockResolvedValue("0xfakesig");

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x1111111111111111111111111111111111111111" }),
  useSignMessage: () => ({ signMessageAsync }),
}));

vi.mock("@/src/lib/security/signature", () => ({
  generateAuthMessage: vi.fn(() => "HoodDesk signed message"),
}));

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ orders: mockOrders }),
    ok: true,
  } as Response);
  globalThis.confirm = vi.fn().mockReturnValue(true) as unknown as typeof globalThis.confirm;
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).fetch;
});

it("renders nothing when there are no DCA orders", async () => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ orders: [] }),
    ok: true,
  } as Response);

  const { container } = render(<ActiveDcaOrders />);
  await waitFor(() => expect(container.innerHTML).toBe(""));
});

it("fetches and displays DCA orders", async () => {
  render(<ActiveDcaOrders />);

  await waitFor(() => {
    expect(screen.getByText("Active DCA Orders")).toBeInTheDocument();
  });

  expect(screen.getByText("ARMED")).toBeInTheDocument();
  expect(screen.getByText("PAUSED")).toBeInTheDocument();
  expect(screen.getByText(/2 \/ 10/)).toBeInTheDocument();
});

it("shows pause, resume, and cancel buttons", async () => {
  render(<ActiveDcaOrders />);

  await waitFor(() => {
    expect(screen.getAllByText("Pause").length).toBeGreaterThanOrEqual(1);
  });
  expect(screen.getByText("Resume")).toBeInTheDocument();
  expect(screen.getAllByText("Cancel").length).toBe(2);
});

it("handles fetch error gracefully", async () => {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error("network error"));

  const { container } = render(<ActiveDcaOrders />);
  await new Promise((r) => setTimeout(r, 200));
  expect(container.innerHTML).toBe("");
});

it("cancels a DCA order", async () => {
  const user = userEvent.setup();
  render(<ActiveDcaOrders />);
  await waitFor(() => {
    expect(screen.getAllByText("Cancel").length).toBeGreaterThan(0);
  });

  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

  const cancelBtns = screen.getAllByText("Cancel");
  await user.click(cancelBtns[0]);

  await waitFor(() => {
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/orders/dca-1"),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"action":"cancel"'),
      })
    );
  });
});

it("pauses a DCA order", async () => {
  const user = userEvent.setup();
  render(<ActiveDcaOrders />);
  await waitFor(() => {
    expect(screen.getAllByText("Pause").length).toBeGreaterThan(0);
  });

  globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

  const pauseBtns = screen.getAllByText("Pause");
  await user.click(pauseBtns[0]);

  await waitFor(() => {
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/orders/dca-1"),
      expect.objectContaining({
        method: "PATCH",
        body: expect.stringContaining('"action":"pause"'),
      })
    );
  });
});

it("resumes a DCA order and handles API failure", async () => {
  const user = userEvent.setup();
  render(<ActiveDcaOrders />);
  await waitFor(() => {
    expect(screen.getByText("Resume")).toBeInTheDocument();
  });

  const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: false,
    json: () => Promise.resolve({ error: "Unauthorized" }),
  });

  const resumeBtn = screen.getByText("Resume");
  await user.click(resumeBtn);

  await waitFor(() => {
    expect(alertSpy).toHaveBeenCalledWith("Failed to resume order: Unauthorized");
  });
  alertSpy.mockRestore();
});

it("signs and sends action, handles sign rejection gracefully via alert", async () => {
  signMessageAsync.mockRejectedValueOnce(new Error("user rejected"));
  const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});

  const user = userEvent.setup();
  render(<ActiveDcaOrders />);
  await waitFor(() => {
    expect(screen.getAllByText("Cancel").length).toBe(2);
  });

  const cancelBtns = screen.getAllByText("Cancel");
  await user.click(cancelBtns[0]);

  await waitFor(() => {
    expect(alertSpy).toHaveBeenCalledWith("Error trying to cancel order.");
  });
  alertSpy.mockRestore();
});
