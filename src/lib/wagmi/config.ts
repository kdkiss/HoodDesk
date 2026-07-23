import { createConfig, http, fallback } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import type { Chain } from "viem";
import { ROBINHOOD_MAINNET, ROBINHOOD_TESTNET, type ChainConfig } from "@/src/config/chains";

function toViemChain(config: ChainConfig): Chain {
  return {
    id: config.id,
    name: config.name,
    nativeCurrency: config.nativeCurrency,
    rpcUrls: {
      default: { http: [config.rpcUrl] },
    },
    blockExplorers: {
      default: { name: "Blockscout", url: config.explorerUrl },
    },
    testnet: config.isTestnet,
  };
}

export const robinhoodMainnet = toViemChain(ROBINHOOD_MAINNET);
export const robinhoodTestnet = toViemChain(ROBINHOOD_TESTNET);

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();

// WalletConnect is only wired in when NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is set.
// Otherwise the app degrades gracefully to the injected (MetaMask/browser wallet) connector only,
// which matches the blank default shipped in .env.example.
export const hasWalletConnect = Boolean(walletConnectProjectId);

const connectors = hasWalletConnect
  ? [
      injected(),
      walletConnect({
        projectId: walletConnectProjectId!,
        showQrModal: true,
      }),
    ]
  : [injected()];

export const wagmiConfig = createConfig({
  chains: [robinhoodMainnet, robinhoodTestnet],
  connectors,
  transports: {
    [robinhoodMainnet.id]: fallback([http(robinhoodMainnet.rpcUrls.default.http[0])]),
    [robinhoodTestnet.id]: fallback([http(robinhoodTestnet.rpcUrls.default.http[0])]),
  },
  ssr: true,
});
