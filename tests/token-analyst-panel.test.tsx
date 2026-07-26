import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TokenAnalystPanel } from "@/components/ai/token-analyst-panel";
import { AI_SETTINGS_STORAGE_KEY } from "@/src/lib/ai/settings";

vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

vi.mock("@/components/trading/use-token-info", () => ({
  useTokenInfo: vi.fn(() => ({
    data: {
      address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "Token A",
      symbol: "TOKA",
      decimals: 18,
      isRobinFun: true,
      dexLive: true,
    },
    isLoading: false,
  })),
}));

vi.mock("@/components/trading/use-token-stats", () => ({
  useTokenStats: vi.fn(() => ({
    data: {
      token: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      graduated: true,
      priceEth: "0.0001",
      priceUsd: 0.2,
      ethUsd: 2000,
      change24hPct: 4.2,
      liquidityEth: "12.5",
      liquidityUsd: 25000,
      marketCapEth: 100,
      marketCapUsd: 200000,
      holdersCount: 42,
      totalSupply: "1000000000000000000000000",
      totalSupplyTokens: "1000000",
      decimals: 18,
      marketDataSource: "Blockscout",
      curve: null,
    },
    isLoading: false,
  })),
}));

beforeEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).fetch;
});

it("prompts users to configure AI settings when no key exists", () => {
  render(<TokenAnalystPanel tokenAddress="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" />);

  expect(screen.getByText(/Add your provider key/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Analyze token" })).toBeDisabled();
});

it("runs analysis with locally configured provider settings", async () => {
  window.sessionStorage.setItem(
    AI_SETTINGS_STORAGE_KEY,
    JSON.stringify({ provider: "openrouter", model: "openai/gpt-4o-mini", apiKey: "test-key-123" })
  );
  globalThis.fetch = vi.fn(async (input) => {
    const url = String(input);
    if (url.startsWith("/api/trades")) {
      return {
        ok: true,
        json: async () => ({ trades: [{ direction: "Buy", price: "0.0001", amountToken: "10", amountEth: "0.001" }] }),
      } as Response;
    }
    return {
      ok: true,
      json: async () => ({
        analysis: {
          summary: "Token A has live stats and recent trade data.",
          sections: [{ title: "Liquidity", bullets: ["Liquidity is visible in HoodDesk data."] }],
          dataGaps: ["No audit data supplied."],
        },
      }),
    } as Response;
  });

  const user = userEvent.setup();
  render(<TokenAnalystPanel tokenAddress="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" />);
  await user.click(screen.getByRole("button", { name: "Analyze token" }));

  await waitFor(() => {
    expect(screen.getByText(/Token A has live stats/)).toBeInTheDocument();
  });
  expect(globalThis.fetch).toHaveBeenCalledWith("/api/analyst", expect.objectContaining({ method: "POST" }));
  const analystCall = vi.mocked(globalThis.fetch).mock.calls.find(
    ([input]) => String(input) === "/api/analyst"
  );
  const requestBody = JSON.parse(String((analystCall?.[1] as RequestInit).body));
  expect(requestBody.snapshot.stats.totalSupplyTokens).toBe("1000000");
  expect(requestBody.snapshot.stats).not.toHaveProperty("totalSupply");
});
