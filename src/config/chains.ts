export interface ChainConfig {
  id: number;
  name: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrl: string;
  wsRpcUrl?: string;
  explorerUrl: string;
  explorerApiUrl: string;
  isTestnet: boolean;
}

export const ROBINHOOD_MAINNET: ChainConfig = {
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrl: "https://rpc.mainnet.chain.robinhood.com",
  explorerUrl: "https://robinhoodchain.blockscout.com",
  explorerApiUrl: "https://robinhoodchain.blockscout.com/api/v2",
  isTestnet: false,
};

export const ROBINHOOD_TESTNET: ChainConfig = {
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrl: "https://rpc.testnet.chain.robinhood.com",
  explorerUrl: "https://explorer.testnet.chain.robinhood.com",
  explorerApiUrl: "https://explorer.testnet.chain.robinhood.com/api/v2",
  isTestnet: true,
};

export const CHAINS: Record<number, ChainConfig> = {
  [ROBINHOOD_MAINNET.id]: ROBINHOOD_MAINNET,
  [ROBINHOOD_TESTNET.id]: ROBINHOOD_TESTNET,
};

export function getChain(chainId: number): ChainConfig {
  const chain = CHAINS[chainId];
  if (!chain) throw new Error(`Unsupported chain ID: ${chainId}`);
  return chain;
}
