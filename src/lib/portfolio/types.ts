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