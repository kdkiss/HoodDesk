import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MarketsPage from "../app/markets/page";

const ownerAddress = "0x1111111111111111111111111111111111111111";
const robinfunAddress = "0x56a98db16cf501b686c14ba00a5dec02e87083fa";
const hiddenAddress = "0x167dadf3a3665953c2de2fab0e69d27af8064663";

vi.mock("wagmi", () => ({
  useAccount: () => ({ address: ownerAddress }),
  useSignMessage: () => ({ signMessageAsync: vi.fn() }),
}));

beforeEach(() => {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/tokens") {
      return {
        ok: true,
        json: async () => ({
          tokens: [
            {
              address: "0x2222222222222222222222222222222222222222",
              name: "Latest Token",
              symbol: "LATEST",
              decimals: 18,
              dexLive: false,
              priceEth: "0.000000002",
              change24hPct: 0,
              volume24hUsd: 100,
            },
          ],
        }),
      } as Response;
    }
    if (url === `/api/watchlist?owner=${ownerAddress}`) {
      return {
        ok: true,
        json: async () => ({
          watchlist: [{ tokenAddress: robinfunAddress }],
        }),
      } as Response;
    }
    if (url.startsWith("/api/tokens?addresses=")) {
      return {
        ok: true,
        json: async () => ({
          tokens: [
            {
              address: robinfunAddress,
              name: "Robinfun",
              symbol: "ROBINFUN",
              decimals: 18,
              dexLive: true,
              priceEth: "0.000000070286347532",
              change24hPct: 2.1591,
              volume24hUsd: 500,
            },
          ],
        }),
      } as Response;
    }
    if (url === `/api/tokens?address=${hiddenAddress}`) {
      return {
        ok: true,
        json: async () => ({
          token: {
            address: hiddenAddress,
            name: "Robinhood Bird",
            symbol: "BIRD",
            decimals: 18,
            dexLive: true,
            priceEth: "0.000000008806296842",
            change24hPct: 0.4247,
            volume24hUsd: 250,
          },
        }),
      } as Response;
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
});

it("resolves an exact token address outside the loaded market page", async () => {
  const user = userEvent.setup();
  render(<MarketsPage />);

  await user.type(
    screen.getByPlaceholderText("Search by name, symbol, or address..."),
    hiddenAddress
  );

  await waitFor(
    () => {
      expect(screen.getByText("Robinhood Bird")).toBeInTheDocument();
    },
    { timeout: 2_000 }
  );
  expect(screen.getByText("BIRD")).toBeInTheDocument();
  expect(screen.getByText("+0.42%")).toBeInTheDocument();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as Record<string, unknown>).fetch;
});

it("merges watched tokens that fall outside the general market page", async () => {
  const user = userEvent.setup();
  render(<MarketsPage />);

  await waitFor(() => {
    expect(screen.getByText("Robinfun")).toBeInTheDocument();
  });
  expect(screen.getByText("+2.16%")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Watchlist" }));

  expect(screen.getByText("Robinfun")).toBeInTheDocument();
  expect(screen.queryByText("Latest Token")).not.toBeInTheDocument();
});

it("shows Blockscout volume and sorts available values in either direction", async () => {
  const user = userEvent.setup();
  render(<MarketsPage />);

  await waitFor(() => {
    expect(screen.getByText("Robinfun")).toBeInTheDocument();
  });
  expect(screen.getByText("$500")).toBeInTheDocument();

  const sortButton = screen.getByRole("button", {
    name: "Sort by 24-hour volume",
  });
  await user.click(sortButton);
  let rows = screen.getAllByRole("row").slice(1);
  expect(rows[0]).toHaveTextContent("Robinfun");
  expect(rows[1]).toHaveTextContent("Latest Token");

  await user.click(sortButton);
  rows = screen.getAllByRole("row").slice(1);
  expect(rows[0]).toHaveTextContent("Latest Token");
  expect(rows[1]).toHaveTextContent("Robinfun");
});
