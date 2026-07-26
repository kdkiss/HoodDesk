import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PortfolioAnalystPanel } from "@/components/ai/portfolio-analyst-panel";
import { AI_SETTINGS_STORAGE_KEY } from "@/src/lib/ai/settings";
import { type PortfolioResponse } from "@/src/lib/portfolio/types";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

const portfolio: PortfolioResponse = {
  address: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  ethBalance: "1000000000000000000",
  ethBalanceFormatted: "1",
  ethUsd: 1900,
  holdings: [{
    token: {
      address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      name: "Token A",
      symbol: "TOKA",
      decimals: 18,
    },
    balanceFormatted: "100",
    estimatedMarketValue: "42.50",
    valueUsd: "42.50",
    trackedCostBasis: { wei: "10000000000000000", eth: "0.01" },
    realizedPnl: { wei: "2000000000000000", eth: "0.002" },
    unrealizedPnl: { wei: "-1000000000000000", eth: "-0.001" },
    costBasisUnavailable: false,
  }],
};

beforeEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).fetch;
});

it("keeps portfolio analysis off until local AI settings exist", () => {
  render(<PortfolioAnalystPanel portfolio={portfolio} />);

  expect(screen.getByText(/Add your provider key/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Analyze portfolio" })).toBeDisabled();
});

it("sends a minimized portfolio snapshot and renders the result", async () => {
  window.sessionStorage.setItem(
    AI_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
      apiKey: "test-key-123",
    })
  );
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      analysis: {
        summary: "One token holding has an indexed valuation.",
        sections: [{
          title: "Allocation visibility",
          bullets: ["One of one token holdings has a USD value."],
        }],
        dataGaps: [],
      },
    }),
  })) as unknown as typeof fetch;

  const user = userEvent.setup();
  render(<PortfolioAnalystPanel portfolio={portfolio} />);
  await user.click(screen.getByRole("button", { name: "Analyze portfolio" }));

  await waitFor(() => {
    expect(screen.getByText(/One token holding/)).toBeInTheDocument();
  });

  const request = vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit;
  const body = JSON.parse(String(request.body));
  expect(body.snapshot.kind).toBe("portfolio");
  expect(body.snapshot.knownIncludedTokenValueUsd).toBe(42.5);
  expect(body.snapshot.totalHoldings).toBe(1);
  expect(body.snapshot.includedHoldings).toBe(1);
  expect(body.snapshot).not.toHaveProperty("address");
  expect(body.snapshot.holdings[0]).not.toHaveProperty("address");
  expect(JSON.stringify(body.snapshot)).not.toContain(portfolio.address);
  expect(JSON.stringify(body.snapshot)).not.toContain(
    portfolio.holdings[0].token.address
  );
});

it("limits the provider payload while retaining the full holding count", async () => {
  window.sessionStorage.setItem(
    AI_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      provider: "openrouter",
      model: "openai/gpt-4o-mini",
      apiKey: "test-key-123",
    })
  );
  globalThis.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      analysis: {
        summary: "The included holdings were summarized.",
        sections: [],
        dataGaps: [],
      },
    }),
  })) as unknown as typeof fetch;
  const largePortfolio: PortfolioResponse = {
    ...portfolio,
    holdings: Array.from({ length: 51 }, (_, index) => ({
      ...portfolio.holdings[0],
      token: {
        ...portfolio.holdings[0].token,
        address: `0x${index.toString(16).padStart(40, "0")}`,
        symbol: `TOK${index}`,
      },
      estimatedMarketValue: String(index),
    })),
  };

  const user = userEvent.setup();
  render(<PortfolioAnalystPanel portfolio={largePortfolio} />);
  await user.click(screen.getByRole("button", { name: "Analyze portfolio" }));

  await waitFor(() => {
    expect(screen.getByText(/included holdings were summarized/)).toBeInTheDocument();
  });

  const request = vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit;
  const body = JSON.parse(String(request.body));
  expect(body.snapshot.totalHoldings).toBe(51);
  expect(body.snapshot.includedHoldings).toBe(50);
  expect(body.snapshot.holdings).toHaveLength(50);
});
