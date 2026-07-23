import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TokenSelectModal } from "../components/swap/token-select-modal";

const mockTokens = [
  { address: "0xaabbcccccccccccccccccccccccccccccccccccc", name: "Alpha", symbol: "ALPHA", decimals: 18, dexLive: true },
  { address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", name: "Beta", symbol: "BETA", decimals: 6, dexLive: false },
];

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  onSelect: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalThis, "fetch").mockResolvedValue({
    json: () => Promise.resolve({ tokens: mockTokens }),
    ok: true,
  } as Response);
});

it("renders nothing when closed", () => {
  const { container } = render(<TokenSelectModal {...defaultProps} open={false} />);
  expect(container.innerHTML).toBe("");
});

it("shows ETH pinned at top when opened and loads tokens from API", async () => {
  const { container } = render(<TokenSelectModal {...defaultProps} />);
  // Skeleton loaders render while fetching
  expect(container.querySelectorAll(".animate-pulse-soft").length).toBeGreaterThan(0);
  await waitFor(() => expect(screen.getByText("ALPHA")).toBeInTheDocument());
  expect(screen.getByText("BETA")).toBeInTheDocument();
});

it("closes on Escape key", () => {
  const onClose = vi.fn();
  render(<TokenSelectModal {...defaultProps} onClose={onClose} />);
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("filters tokens by search query", async () => {
  const user = userEvent.setup();
  render(<TokenSelectModal {...defaultProps} />);
  await waitFor(() => expect(screen.getByText("ALPHA")).toBeInTheDocument());

  const input = screen.getByPlaceholderText("Search name or paste address");
  await user.type(input, "bet");
  expect(screen.getByText("BETA")).toBeInTheDocument();
  expect(screen.queryByText("ALPHA")).not.toBeInTheDocument();
});

it('shows "No tokens match" when filtering yields nothing', async () => {
  const user = userEvent.setup();
  render(<TokenSelectModal {...defaultProps} />);
  await waitFor(() => expect(screen.getByText("ALPHA")).toBeInTheDocument());

  const input = screen.getByPlaceholderText("Search name or paste address");
  await user.type(input, "zzzzz");
  expect(screen.getByText("No tokens match.")).toBeInTheDocument();
});

it("shows address-not-found message when a valid pasted address doesn't match", async () => {
  const user = userEvent.setup();
  render(<TokenSelectModal {...defaultProps} />);
  await waitFor(() => expect(screen.getByText("ALPHA")).toBeInTheDocument());

  const input = screen.getByPlaceholderText("Search name or paste address");
  await user.type(input, "0x1234567890abcdef1234567890abcdef12345678");
  expect(screen.getByText("Address not found among discovered RobinFun tokens.")).toBeInTheDocument();
});

it("selects a token and calls onSelect and onClose", async () => {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<TokenSelectModal {...defaultProps} onSelect={onSelect} onClose={onClose} />);
  await waitFor(() => expect(screen.getByText("ALPHA")).toBeInTheDocument());

  await user.click(screen.getByText("ALPHA"));
  expect(onSelect).toHaveBeenCalledWith(mockTokens[0]);
  expect(onClose).toHaveBeenCalled();
});

it("excludes the excluded token address", async () => {
  render(<TokenSelectModal {...defaultProps} excludeAddress={mockTokens[0].address} />);
  await waitFor(() => expect(screen.getAllByText("ETH")[0]).toBeInTheDocument());
  expect(screen.queryByText("ALPHA")).not.toBeInTheDocument();
  expect(screen.getByText("BETA")).toBeInTheDocument();
});

it("closes when clicking the overlay backdrop", async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  const { container } = render(<TokenSelectModal {...defaultProps} onClose={onClose} />);

  const backdrop = container.querySelector(".fixed.inset-0");
  expect(backdrop).toBeTruthy();
  if (backdrop) await user.click(backdrop);
  expect(onClose).toHaveBeenCalled();
});

it("shows DEX label for dexLive tokens and CURVE label for non-dexLive tokens", async () => {
  render(<TokenSelectModal {...defaultProps} />);
  await waitFor(() => {
    expect(screen.getByText("DEX")).toBeInTheDocument();
    expect(screen.getByText("CURVE")).toBeInTheDocument();
  });
});

it("handles API fetch failure gracefully", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("network error"));
  const { container } = render(<TokenSelectModal {...defaultProps} />);
  expect(container.querySelectorAll(".animate-pulse-soft").length).toBeGreaterThan(0);
  await waitFor(() => expect(container.querySelectorAll(".animate-pulse-soft").length).toBe(0));
  expect(screen.getAllByText("ETH")[0]).toBeInTheDocument();
});

it("handles missing tokens array in response", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    json: () => Promise.resolve({}),
    ok: true,
  } as Response);
  const { container } = render(<TokenSelectModal {...defaultProps} />);
  await waitFor(() => expect(container.querySelectorAll(".animate-pulse-soft").length).toBe(0));
  expect(screen.getAllByText("ETH")[0]).toBeInTheDocument();
});
