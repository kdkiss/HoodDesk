import { type Address } from "viem";

/**
 * Computed portfolio metrics for a single token.
 */
export interface PortfolioTokenMetrics {
  /** Token address (checksummed). */
  token: Address;
  /** Weighted-average cost basis (ETH per token, display units). */
  costBasisEth: string;
  /** Always null (no ETH/USD reference). */
  costBasisUsd: null;
  /** Realized P&L (ETH, display units). */
  realizedPnlEth: string;
  /** Always null (no ETH/USD reference). */
  realizedPnlUsd: null;
  /** Unrealized P&L (ETH, display units). */
  unrealizedPnlEth: string;
  /** Always null (no ETH/USD reference). */
  unrealizedPnlUsd: null;
  /** Total P&L (ETH, display units). */
  totalPnlEth: string;
  /** Always null (no ETH/USD reference). */
  totalPnlUsd: null;
  /** Current token balance (raw units). */
  tokensHeld: string;
}

/**
 * Raw transaction data used for portfolio computation.
 */
export interface TransactionData {
  type: "BUY" | "SELL" | "TRANSFER_IN" | "TRANSFER_OUT";
  ethAmount: bigint; // wei
  tokenAmount: bigint; // raw token units
  timestamp: Date;
}

export interface PortfolioMoneyAmount {
  wei: string;
  eth: string;
}

export interface PortfolioHolding {
  token: {
    address: string;
    name: string;
    symbol: string;
    decimals: number;
  };
  balanceFormatted: string;
  estimatedMarketValue: string | null;
  valueUsd: string | null;
  trackedCostBasis: PortfolioMoneyAmount | null;
  realizedPnl: PortfolioMoneyAmount | null;
  unrealizedPnl: PortfolioMoneyAmount | null;
  costBasisUnavailable: boolean;
}

export interface PortfolioResponse {
  address: string;
  ethBalance: string;
  ethBalanceFormatted: string;
  ethUsd: number | null;
  holdings: PortfolioHolding[];
}
