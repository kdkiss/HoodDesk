import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SwapCard } from "../components/swap/swap-card";

const useAccountMock = vi.fn<(...args: []) => { address: string | undefined; isConnected: boolean; chainId: number }>(
  () => ({ address: "0x1111111111111111111111111111111111111111", isConnected: true, chainId: 4663 })
);
const useNetworkHealthMock = vi.fn<(...args: []) => { data: { emergencyPause: boolean }; isLoading: boolean }>(
  () => ({ data: { emergencyPause: false }, isLoading: false })
);
const useTokenInfoMock = vi.fn<(...args: []) => { data: { isRobinFun?: boolean; address?: string; name?: string; symbol?: string; decimals?: number; dexLive?: boolean } | undefined; isLoading: boolean; isError: boolean }>(
  () => ({ data: { isRobinFun: true }, isLoading: false, isError: false })
);
const useBalanceMock = vi.fn<(...args: []) => { data: { value: bigint; decimals: number; formatted: string } | undefined; isLoading: boolean }>(
  () => ({ data: { value: 100_000_000_000_000_000_000n, decimals: 18, formatted: "100" }, isLoading: false })
);
const useReadContractMock = vi.fn<(...args: []) => { data: undefined; isLoading: boolean; refetch: () => void }>(
  () => ({ data: undefined, isLoading: false, refetch: vi.fn() })
);
const useSimulateContractMock = vi.fn<(...args: []) => { data: undefined; isLoading: boolean; isFetching: boolean; isError: boolean; error: null }>(
  () => ({ data: undefined, isLoading: false, isFetching: false, isError: false, error: null })
);
const useWriteContractMock = vi.fn<(...args: []) => { writeContractAsync: () => Promise<void>; data: undefined; reset: () => void; isPending: boolean }>(
  () => ({ writeContractAsync: vi.fn(), data: undefined, reset: vi.fn(), isPending: false })
);
const useWaitForTxMock = vi.fn<(...args: []) => { isLoading: boolean; isSuccess: boolean; isError: boolean; data: undefined; refetch: () => void }>(
  () => ({ isLoading: false, isSuccess: false, isError: false, data: undefined, refetch: vi.fn() })
);
const useSignMessageMock = vi.fn<(...args: []) => { signMessageAsync: () => Promise<string> }>(
  () => ({ signMessageAsync: vi.fn() })
);

vi.mock("wagmi", () => ({
  useAccount: (...args: []) => useAccountMock(...args),
  useBalance: (...args: []) => useBalanceMock(...args),
  useReadContract: (...args: []) => useReadContractMock(...args),
  useSimulateContract: (...args: []) => useSimulateContractMock(...args),
  useWriteContract: (...args: []) => useWriteContractMock(...args),
  useWaitForTransactionReceipt: (...args: []) => useWaitForTxMock(...args),
  useSignMessage: (...args: []) => useSignMessageMock(...args),
}));

vi.mock("@/src/hooks/use-network-health", () => ({
  useNetworkHealth: (...args: []) => useNetworkHealthMock(...args),
}));

vi.mock("@/components/trading/use-token-info", () => ({
  useTokenInfo: (...args: []) => useTokenInfoMock(...args),
}));

vi.mock("@/components/trading/use-token-stats", () => ({
  useTokenStats: vi.fn(() => ({ data: undefined, isLoading: false })),
}));

vi.mock("@/components/swap/token-select-modal", () => ({
  TokenSelectModal: ({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (t: Record<string, unknown>) => void }) => {
    if (!open) return null;
    return (
      <div data-testid="token-select-modal">
        <button onClick={() => { onSelect({ address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", name: "Token A", symbol: "TOKA", decimals: 18 }); onClose(); }}>Pick TOKA</button>
      </div>
    );
  },
  NATIVE_ETH: { address: "ETH", name: "Ether", symbol: "ETH", decimals: 18, isNative: true },
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_CHAIN_ID = "4663";
  delete process.env.EMERGENCY_PAUSE;
  globalThis.fetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve({
      quote: {
        tokenIn: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        tokenOut: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        amountIn: "1000000000000000000",
        expectedAmountOut: "2000000000000000000",
        minimumAmountOut: "1950000000000000000",
        displayPrice: "2.0",
        inversePrice: "0.5",
        estimatedPriceImpactBps: 50,
        route: { kind: "v2", path: ["0xeeee...", "0xaaaa..."], factoryAddress: "0x1111111111111111111111111111111111111111", routerAddress: "0x1111111111111111111111111111111111111111" },
        approvalTarget: "0x1111111111111111111111111111111111111111",
        expiresAt: 9999999999,
      },
    }),
    ok: true,
  } as Response);
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).fetch;
});

it("renders supported public-beta tab buttons", () => {
  render(<SwapCard />);
  expect(screen.getByText("Swap")).toBeInTheDocument();
  expect(screen.getByText("Limit")).toBeInTheDocument();
  expect(screen.getByText("Dca")).toBeInTheDocument();
  expect(screen.queryByText("Bridge")).not.toBeInTheDocument();
  expect(screen.queryByText("Cross Chain")).not.toBeInTheDocument();
});

it("shows Select tokens when no token is selected", () => {
  render(<SwapCard />);
  expect(screen.getByText("Select tokens")).toBeInTheDocument();
});

it("switches between tabs", async () => {
  const user = userEvent.setup();
  render(<SwapCard />);

  await user.click(screen.getByText("Limit"));
  await waitFor(() => {
    expect(screen.getByText("Place Limit Buy Order")).toBeInTheDocument();
  });
});

it("opens settings panel and changes slippage", async () => {
  const user = userEvent.setup();
  render(<SwapCard />);

  const settingsBtn = screen.getByLabelText("Settings");
  await user.click(settingsBtn);
  expect(screen.getByText(/Slippage tolerance/)).toBeInTheDocument();

  // The 1.00% chip and the readout both match; click the chip (a button).
  const chip = screen.getAllByText("1.00%").find((el) => el.tagName === "BUTTON");
  await user.click(chip!);
  await waitFor(() => {
    expect(screen.getByDisplayValue("1")).toBeInTheDocument();
  });
});

it("renders with fixedTokenAddress", () => {
  useTokenInfoMock.mockReturnValue({
    data: { isRobinFun: true, address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", name: "TokenA", symbol: "TA", decimals: 18, dexLive: true },
    isLoading: false,
    isError: false,
  });
  render(<SwapCard fixedTokenAddress="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" />);
  expect(screen.getByText("Swap")).toBeInTheDocument();
});
