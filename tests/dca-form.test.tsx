import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DcaForm } from "../components/swap/dca-form";

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

vi.mock("@/components/trading/use-token-stats", () => ({
  useTokenStats: vi.fn(() => ({
    data: { priceEth: "0.0001205" },
    isLoading: false,
  })),
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
  process.env.NEXT_PUBLIC_CHAIN_ID = "4663";
  globalThis.fetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ order: { id: "dca-1" } }),
    ok: true,
  } as Response);
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).fetch;
});

it("renders with default sell token", () => {
  render(<DcaForm />);
  expect(screen.getByText("ETH")).toBeInTheDocument();
  expect(screen.getByText("Select token")).toBeInTheDocument();
  expect(screen.getByText("Create DCA Order")).toBeInTheDocument();
});

it("disables submit until a buy token is selected", () => {
  render(<DcaForm />);
  expect(screen.getByText("Create DCA Order")).toBeDisabled();
});

it("changes frequency via select", async () => {
  const user = userEvent.setup();
  render(<DcaForm />);

  const frequency = screen.getByDisplayValue("Daily");
  await user.selectOptions(frequency, "HOURLY");
  await waitFor(() => {
    expect(screen.getByText("Every Hour")).toBeInTheDocument();
  });
});

it("changes duration unit via select", async () => {
  const user = userEvent.setup();
  render(<DcaForm />);

  const selects = screen.getAllByRole("combobox");
  const durationSelect = selects[1];
  expect(durationSelect).toBeInTheDocument();

  await user.selectOptions(durationSelect, "weeks");
  expect((durationSelect as HTMLSelectElement).value).toBe("weeks");
});

it("fills the DCA price condition from the last ETH price", async () => {
  const user = userEvent.setup();
  render(<DcaForm />);

  await user.click(screen.getByRole("button", { name: /Use last:/ }));

  expect(screen.getByLabelText("Max price (ETH per token)")).toHaveValue(
    "0.0001205"
  );
  expect(screen.getByText(/not USD/)).toBeInTheDocument();
});

it("fills buy DCA caps below the last price", async () => {
  const user = userEvent.setup();
  render(<DcaForm />);

  await user.click(screen.getByRole("button", { name: "-5%" }));

  expect(screen.getByLabelText("Max price (ETH per token)")).toHaveValue(
    "0.000114475"
  );
});

it("fills sell DCA floors above the last price", async () => {
  const user = userEvent.setup();
  render(<DcaForm />);

  await user.click(screen.getByRole("button", { name: "Sell DCA" }));
  await user.click(screen.getByRole("button", { name: "+10%" }));

  expect(screen.getByLabelText("Min price (ETH per token)")).toHaveValue(
    "0.00013255"
  );
});
