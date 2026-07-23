import { z } from "zod";

const envSchema = z.object({
  NEXT_PUBLIC_CHAIN_ID: z.coerce.number().default(4663),
  NEXT_PUBLIC_RPC_URL: z.string().url().default("https://rpc.mainnet.chain.robinhood.com"),
  NEXT_PUBLIC_EXPLORER_URL: z.string().url().default("https://robinhoodchain.blockscout.com"),
  ROBINHOOD_CHAIN_RPC_URL: z.string().url().default("https://rpc.mainnet.chain.robinhood.com"),
  ROBINHOOD_CHAIN_WS_URL: z.string().optional().default(""),
  BLOCKSCOUT_API_URL: z.string().url().default("https://robinhoodchain.blockscout.com/api/v2"),
  BLOCKSCOUT_API_KEY: z.string().optional().default(""),
  DATABASE_URL: z.string().default("file:./dev.db"),
  ROBINFUN_FACTORIES: z.string().optional().default(""),
  DEX_ADAPTER: z.string().optional().default(""),
  DEX_FACTORY_ADDRESS: z.string().optional().default(""),
  DEX_ROUTER_ADDRESS: z.string().optional().default(""),
  DEX_QUOTER_ADDRESS: z.string().optional().default(""),
  WRAPPED_NATIVE_TOKEN_ADDRESS: z.string().optional().default(""),
  ALLOWED_ROUTER_ADDRESSES: z.string().optional().default(""),
  ALLOWED_FACTORY_ADDRESSES: z.string().optional().default(""),
  ALLOWED_QUOTER_ADDRESSES: z.string().optional().default(""),
  ALLOWED_TOKEN_ADDRESSES: z.string().optional().default(""),
  EXECUTION_ENABLED: z.coerce.boolean().default(false),
  AUTOMATED_ORDERS_ENABLED: z.coerce.boolean().default(false),
  EXECUTION_PRIVATE_KEY: z.string().optional().default(""),
  EXECUTION_POLL_INTERVAL_MS: z.coerce.number().default(8000),
  EXECUTION_MAX_ATTEMPTS: z.coerce.number().default(3),
  EXECUTION_CONFIRMATIONS: z.coerce.number().default(1),
  EXECUTION_MIN_GAS_BALANCE_ETH: z.string().default("0.005"),
  EXECUTION_MAX_GAS_GWEI: z.string().regex(/^\d+$/).optional().or(z.literal("")).default(""),
  DEFAULT_SLIPPAGE_BPS: z.coerce.number().int().min(1).max(500).default(100),
  MAX_SLIPPAGE_BPS: z.coerce.number().int().min(1).max(500).default(500),
  MAX_PRICE_IMPACT_BPS: z.coerce.number().int().min(1).max(2_000).default(800),
  DEFAULT_TRANSACTION_DEADLINE_SECONDS: z.coerce.number().default(300),
  EMERGENCY_PAUSE: z.coerce.boolean().default(false),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Environment validation failed:", parsed.error.flatten());
    throw new Error("Invalid environment configuration");
  }
  return parsed.data;
}

export const env = loadEnv();
