import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LimitForm } from "../components/swap/limit-form";

const signMessageAsync = vi.fn().mockResolvedValue("0xfakesig");

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: "0x1111111111111111111111111111111111111111", isConnected: true }),
  useSignMessage: () => ({ signMessageAsync }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(() => ({ data: undefined, isLoading: false, error: null })),
}));

vi.mock("@/components/trading/use-token-info", () => ({
  useTokenInfo: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

vi.mock("@/components/swap/token-select-modal", () => ({
  TokenSelectModal: ({ open }: { open: boolean }) => {
    if (!open) return null;
    return <div data-testid="token-select-modal">Modal Open</div>;
  },
  NATIVE_ETH: { address: "ETH", name: "Ether", symbol: "ETH", decimals: 18, isNative: true },
}));

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ order: { id: "limit-1" } }),
    ok: true,
  } as Response);
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).fetch;
});

it("renders with default order type LIMIT_BUY", () => {
  render(<LimitForm />);
  expect(screen.getByText("Limit Buy")).toBeInTheDocument();
  expect(screen.getByText(/Buy when price drops/)).toBeInTheDocument();
});

it("changes order type and updates hint text", async () => {
  const user = userEvent.setup();
  render(<LimitForm />);

  await user.click(screen.getByRole("button", { name: "Take Profit" }));
  await waitFor(() => {
    expect(screen.getByText(/Sell when price rises/)).toBeInTheDocument();
  });
});

it("disables submit until buy token, amount, and trigger price are filled", () => {
  render(<LimitForm />);
  expect(screen.getByText("Place Limit Buy Order")).toBeDisabled();
});

it("renders expiry quick buttons", () => {
  render(<LimitForm />);
  expect(screen.getByText("1h")).toBeInTheDocument();
  expect(screen.getByText("1d")).toBeInTheDocument();
  expect(screen.getByText("1w")).toBeInTheDocument();
});

it("opens token picker on button click", async () => {
  const user = userEvent.setup();
  render(<LimitForm />);

  await user.click(screen.getAllByText("Select token")[0]);
  await waitFor(() => {
    expect(screen.getByTestId("token-select-modal")).toBeInTheDocument();
  });
});

it("disables token picker buttons when fixedTokenAddress is provided", () => {
  render(<LimitForm fixedTokenAddress="0xdddddddddddddddddddddddddddddddddddddddd" />);
  const sellBtn = screen.getByText("ETH").closest("button");
  const buyBtn = screen.getByText("Select token").closest("button");
  expect(sellBtn).toBeDisabled();
  expect(buyBtn).toBeDisabled();
});
