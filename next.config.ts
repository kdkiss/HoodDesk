import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; form-action 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' https: wss:;" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=()" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  output: "standalone",
  webpack: (config) => {
    // wagmi/connectors' baseAccount connector pulls in @coinbase/cdp-sdk's x402 payment
    // module, which depends on optional @x402/* packages we don't install (not used —
    // HoodDesk only uses the injected + walletConnect connectors). Stub them out so the
    // build doesn't fail resolving unused optional deps.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/core": false,
      "@x402/evm": false,
      "@x402/svm": false,
      "@x402/extensions": false,
      // @metamask/sdk's browser bundle references React Native AsyncStorage for
      // its mobile path; HoodDesk is browser-only so this dep is never invoked.
      // Stub it to silence "Module not found" on every Fast Refresh rebuild.
      "@react-native-async-storage/async-storage": false,
      // Wagmi 3's tempo connector relies on an optional accounts module that Next.js Webpack trips on.
      "accounts": false,
      "@base-org/account": false,
      "@coinbase/wallet-sdk": false,
      "@metamask/connect-evm": false,
      "porto/internal": false,
      "porto": false,
      "@safe-global/safe-apps-sdk": false,
      "@safe-global/safe-apps-provider": false,
      "@walletconnect/ethereum-provider": false,
    };
    return config;
  },
};

export default nextConfig;
