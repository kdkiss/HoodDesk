import { createWalletClient, createPublicClient, http, parseEther, formatEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { prisma } from "../src/lib/db";
import { ROBINFUN_FACTORY_ABI } from "../src/lib/dex/abi/robinfun-factory";
import { UNISWAP_V2_ROUTER_ABI } from "../src/lib/dex/abi/uniswap-v2-router";
import { ERC20_ABI } from "../src/lib/dex/abi/erc20";
import { ROBINFUN_FACTORIES, DEX_ROUTER, WETH } from "../src/config/contracts";
import { getChain } from "../src/config/chains";
import { priceEthPerTokenFromReserves } from "../src/lib/price-units";
import {
  assertPriceImpactWithinLimit,
  calculateConstantProductPriceImpactBps,
} from "../src/lib/dex/price-impact";
import { deriveSwapAmounts } from "../src/lib/portfolio/swap-receipt";
import { runTokenDiscovery } from "./token-discovery";
import { safeErrorMessage } from "./error-message";
import { handleOrderProcessingError } from "./order-failure";
import {
  resolveWorkerRpcUrl,
  RPC_READ_TRANSPORT_OPTIONS,
  RPC_WRITE_TRANSPORT_OPTIONS,
} from "./rpc-config";

const EXECUTION_ENABLED = process.env.EXECUTION_ENABLED === "true";
const AUTOMATED_ORDERS_ENABLED = process.env.AUTOMATED_ORDERS_ENABLED === "true";
const EMERGENCY_PAUSE = process.env.EMERGENCY_PAUSE === "true";
const POLL_INTERVAL = Number(process.env.EXECUTION_POLL_INTERVAL_MS ?? 8000);
const PRIVATE_KEY = process.env.EXECUTION_PRIVATE_KEY as `0x${string}` | undefined;

// Token discovery runs independently of order execution — it's read-only
// and safe even when EXECUTION_ENABLED=false or EMERGENCY_PAUSE=true.
const TOKEN_DISCOVERY_ENABLED = process.env.TOKEN_DISCOVERY_ENABLED !== "false";
const TOKEN_DISCOVERY_INTERVAL_MS = Number(process.env.TOKEN_DISCOVERY_INTERVAL_MS ?? 5 * 60 * 1000);

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
const chain = getChain(chainId);
const rpcUrl = resolveWorkerRpcUrl(chain.rpcUrl);

const viemChain = {
  id: chain.id,
  name: chain.name,
  nativeCurrency: chain.nativeCurrency,
  rpcUrls: { default: { http: [rpcUrl] } },
} as const;

// Transports retry transient RPC failures (429 rate-limit, timeouts) with
// backoff — the public Robinhood RPC rate-limits aggressively, and without
// retries a single 429 kills an order iteration.
const publicClient = createPublicClient({
  chain: viemChain,
  transport: http(rpcUrl, RPC_READ_TRANSPORT_OPTIONS),
});

let walletClient: ReturnType<typeof createWalletClient> | null = null;
let account: ReturnType<typeof privateKeyToAccount> | null = null;

if (PRIVATE_KEY) {
  account = privateKeyToAccount(PRIVATE_KEY);
  walletClient = createWalletClient({
    account,
    chain: viemChain,
    transport: http(rpcUrl, RPC_WRITE_TRANSPORT_OPTIONS),
  });
}

async function main() {
  console.log(`HoodDesk Worker starting on ${chain.name} (${chainId})`);
  console.log(`Execution enabled: ${EXECUTION_ENABLED}`);
  console.log(`Automated orders enabled: ${AUTOMATED_ORDERS_ENABLED}`);
  console.log(`Emergency pause: ${EMERGENCY_PAUSE}`);
  console.log(`Token discovery enabled: ${TOKEN_DISCOVERY_ENABLED}`);

  // Token discovery is read-only and independent of order execution;
  // run it even when execution is disabled or emergency-paused.
  if (TOKEN_DISCOVERY_ENABLED) {
    runTokenDiscoveryLoop();
  }

  if (!EXECUTION_ENABLED || !AUTOMATED_ORDERS_ENABLED) {
    console.log("Automated execution disabled. Set EXECUTION_ENABLED=true and AUTOMATED_ORDERS_ENABLED=true to enable.");
    if (!TOKEN_DISCOVERY_ENABLED) await keepWorkerHealthy();
    return;
  }
  if (EMERGENCY_PAUSE) {
    console.log("Emergency pause active. Worker will not execute trades.");
    if (!TOKEN_DISCOVERY_ENABLED) await keepWorkerHealthy();
    return;
  }
  if (!walletClient || !account) {
    console.error("EXECUTION_PRIVATE_KEY not configured. Worker cannot sign transactions.");
    if (!TOKEN_DISCOVERY_ENABLED) await keepWorkerHealthy();
    return;
  }

  console.log(`Execution wallet: ${account.address}`);
  console.log(`Polling every ${POLL_INTERVAL}ms`);

  // Main loop
  while (true) {
    try {
      await processOrders();
    } catch (err) {
      console.error(`Worker loop error: ${safeErrorMessage(err)}`);
    }
    await sleep(POLL_INTERVAL);
  }
}

async function runTokenDiscoveryLoop() {
  console.log(`Token discovery polling every ${TOKEN_DISCOVERY_INTERVAL_MS}ms`);
  while (true) {
    try {
      await runTokenDiscovery(publicClient, chainId);
    } catch (err) {
      console.error(`Token discovery loop error: ${safeErrorMessage(err)}`);
    }
    await sleep(TOKEN_DISCOVERY_INTERVAL_MS);
  }
}

import { processDcaOrders } from "./dca";

async function processOrders() {
  // Process standard limit/stop orders
  const orders = await prisma.automatedOrder.findMany({
    where: {
      status: "ARMED",
      chainId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      orderType: { in: ["LIMIT_BUY", "TAKE_PROFIT", "STOP_LOSS"] },
    },
    take: 10,
  });

  for (const order of orders) {
    try {
      const outcome = await processOrder(order);
      if (outcome.result === "success" || outcome.result === "reverted") {
        await prisma.automatedOrder.update({
          where: { id: order.id },
          data: {
            status: outcome.result === "success" ? "CONFIRMED" : "FAILED",
            failureReason: outcome.result === "success" ? null : "Transaction reverted",
          },
        });
      }
    } catch (err) {
      await handleOrderProcessingError(order.id, err);
    }
  }

  // Process DCA orders
  if (EXECUTION_ENABLED && AUTOMATED_ORDERS_ENABLED && !EMERGENCY_PAUSE) {
    await processDcaOrders();
  }
}

export type OrderOutcome =
  | { result: "not-triggered" }
  | { result: "no-wallet" }
  | { result: "success"; txHash: string }
  | { result: "reverted"; txHash: string };

export async function processOrder(order: {
  id: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  triggerPrice: string | null;
  triggerDirection: string | null;
  orderType: string;
  maximumSlippageBps: number;
  maximumPriceImpactBps: number;
  deadlineSeconds: number;
}): Promise<OrderOutcome> {
  if (!walletClient || !account) return { result: "no-wallet" };

  const maxSlippageBps = Number(process.env.MAX_SLIPPAGE_BPS ?? 500);
  if (!Number.isInteger(maxSlippageBps) || order.maximumSlippageBps > maxSlippageBps) {
    throw new Error("Order exceeds the configured maximum slippage");
  }
  const maxPriceImpactBps = Number(process.env.MAX_PRICE_IMPACT_BPS ?? 800);
  if (
    !Number.isInteger(maxPriceImpactBps) ||
    order.maximumPriceImpactBps > maxPriceImpactBps
  ) {
    throw new Error("Order exceeds the configured maximum price impact");
  }

  const minGasBalance = parseEther(process.env.EXECUTION_MIN_GAS_BALANCE_ETH ?? "0.005");
  const executionBalance = await publicClient.getBalance({ address: account.address });
  if (executionBalance < minGasBalance) {
    throw new Error("Execution wallet is below the configured minimum gas balance");
  }
  const maxGasGwei = process.env.EXECUTION_MAX_GAS_GWEI;
  if (maxGasGwei) {
    const gasPrice = await publicClient.getGasPrice();
    if (gasPrice > BigInt(maxGasGwei) * 1_000_000_000n) {
      throw new Error("Current gas price exceeds the configured maximum");
    }
  }

  const tokenIn = order.tokenIn as Address;
  const tokenOut = order.tokenOut as Address;
  const amountIn = BigInt(order.amountIn);
  const isBuy = tokenIn.toLowerCase() === WETH.toLowerCase();

  // Check trigger condition BEFORE locking the order. The curve lives on the
  // factory that created the token (V1–V5), not necessarily the newest.
  const token = isBuy ? tokenOut : tokenIn;
  const meta = await prisma.tokenMetadata.findUnique({
    where: { address: token.toLowerCase() },
  });
  const curveFactory =
    (meta?.factoryAddress &&
      ROBINFUN_FACTORIES.find(
        (f) => f.toLowerCase() === meta.factoryAddress!.toLowerCase()
      )) ||
    ROBINFUN_FACTORIES[0];

  const curve = await publicClient.readContract({
    address: curveFactory,
    abi: ROBINFUN_FACTORY_ABI,
    functionName: "curves",
    args: [token],
  });

  const graduated = curve[8]; // graduated bool
  let currentPrice: bigint;
  let v2PricingBlock: bigint | null = null;
  let v2ReserveIn: bigint | null = null;
  let v2ReserveOut: bigint | null = null;
  let v2PairAddress: Address | null = null;
  let v2WethTokenIndex: 0 | 1 | null = null;

  if (graduated) {
    const pairAddress = meta?.pairAddress;
    if (!pairAddress) throw new Error("Graduated token is missing pair address");

    v2PricingBlock = await publicClient.getBlockNumber();
    const [token0, reserves] = await Promise.all([
      publicClient.readContract({
        address: pairAddress as Address,
        abi: [
          {
            type: "function",
            name: "token0",
            stateMutability: "view",
            inputs: [],
            outputs: [{ name: "", type: "address" }],
          },
        ] as const,
        functionName: "token0",
        blockNumber: v2PricingBlock,
      }),
      publicClient.readContract({
        address: pairAddress as Address,
        abi: [
          {
            type: "function",
            name: "getReserves",
            stateMutability: "view",
            inputs: [],
            outputs: [
              { name: "reserve0", type: "uint112" },
              { name: "reserve1", type: "uint112" },
              { name: "blockTimestampLast", type: "uint32" },
            ],
          },
        ] as const,
        functionName: "getReserves",
        blockNumber: v2PricingBlock,
      }),
    ]);
    const [reserve0, reserve1] = reserves as [bigint, bigint, number];
    const wethIsToken0 = (token0 as Address).toLowerCase() === WETH.toLowerCase();
    v2PairAddress = pairAddress as Address;
    v2WethTokenIndex = wethIsToken0 ? 0 : 1;
    const wethReserve = wethIsToken0 ? reserve0 : reserve1;
    const tokenReserve = wethIsToken0 ? reserve1 : reserve0;
    const price = priceEthPerTokenFromReserves(wethReserve, tokenReserve);
    if (price === null) throw new Error("Graduated token has no token liquidity");
    currentPrice = price;
    v2ReserveIn = isBuy ? wethReserve : tokenReserve;
    v2ReserveOut = isBuy ? tokenReserve : wethReserve;
  } else {
    // Get price from curve
    currentPrice = await publicClient.readContract({
      address: curveFactory,
      abi: ROBINFUN_FACTORY_ABI,
      functionName: "currentPrice",
      args: [token],
    });
  }

  const triggerPrice = parseEther(order.triggerPrice ?? "0");
  const triggered =
    order.triggerDirection === "gte"
      ? currentPrice >= triggerPrice
      : currentPrice <= triggerPrice;

  if (!triggered) {
    return { result: "not-triggered" }; // still ARMED, check again next poll
  }

  let v2ExpectedOut: bigint | null = null;
  if (graduated) {
    if (
      v2PricingBlock === null ||
      v2ReserveIn === null ||
      v2ReserveOut === null
    ) {
      throw new Error("V2 pricing state is unavailable");
    }
    const path = [tokenIn, tokenOut];
    const amounts = await publicClient.readContract({
      address: DEX_ROUTER,
      abi: UNISWAP_V2_ROUTER_ABI,
      functionName: "getAmountsOut",
      args: [amountIn, path],
      blockNumber: v2PricingBlock,
    });
    v2ExpectedOut = amounts[amounts.length - 1];
    const priceImpactBps = calculateConstantProductPriceImpactBps({
      amountIn,
      expectedAmountOut: v2ExpectedOut,
      reserveIn: v2ReserveIn,
      reserveOut: v2ReserveOut,
    });
    assertPriceImpactWithinLimit(
      priceImpactBps,
      order.maximumPriceImpactBps
    );
  }

  // Trigger met — lock the order
  await prisma.automatedOrder.update({
    where: { id: order.id },
    data: {
      status: "EXECUTING",
      triggeredAt: new Date(),
      executionWallet: account.address.toLowerCase(),
    },
  });

  console.log(`Order ${order.id} triggered at price ${formatEther(currentPrice)}`);

  // Build and send transaction
  let txHash: `0x${string}`;
  let quotedExpectedOutput: bigint;
  let quotedMinimumOutput: bigint;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + order.deadlineSeconds);

  if (graduated) {
    // V2 swap
    const path = [tokenIn, tokenOut];
    if (v2ExpectedOut === null) throw new Error("V2 quote is unavailable");
    const expectedOut = v2ExpectedOut;
    // Safety buffer: Ensure at least 500 bps (5%) slippage for automated execution to handle Fee-on-Transfer tokens
    const appliedSlippageBps = Math.max(order.maximumSlippageBps, 500);
    const minOut = (expectedOut * BigInt(10000 - appliedSlippageBps)) / 10000n;
    quotedExpectedOutput = expectedOut;
    quotedMinimumOutput = minOut;

    if (isBuy) {
      txHash = await walletClient.writeContract({
        address: DEX_ROUTER,
        abi: UNISWAP_V2_ROUTER_ABI,
        functionName: "swapExactETHForTokensSupportingFeeOnTransferTokens",
        args: [minOut, path, account.address, deadline],
        value: amountIn,
        account,
        chain: viemChain,
      });
    } else {
      // Approve first
      const allowance = await publicClient.readContract({
        address: tokenIn,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [account.address, DEX_ROUTER],
      });
      if (allowance < amountIn) {
        const approveHash = await walletClient.writeContract({
          address: tokenIn,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [DEX_ROUTER, amountIn],
          account,
          chain: viemChain,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }
      txHash = await walletClient.writeContract({
        address: DEX_ROUTER,
        abi: UNISWAP_V2_ROUTER_ABI,
        functionName: "swapExactTokensForETHSupportingFeeOnTransferTokens",
        args: [amountIn, minOut, path, account.address, deadline],
        account,
        chain: viemChain,
      });
    }
  } else {
    // Curve swap
    if (isBuy) {
      const minOut = await publicClient.readContract({
        address: curveFactory,
        abi: ROBINFUN_FACTORY_ABI,
        functionName: "quoteBuy",
        args: [tokenOut, amountIn],
      });
      const slippageAdjusted = (minOut * BigInt(10000 - order.maximumSlippageBps)) / 10000n;
      quotedExpectedOutput = minOut;
      quotedMinimumOutput = slippageAdjusted;
      txHash = await walletClient.writeContract({
        address: curveFactory,
        abi: ROBINFUN_FACTORY_ABI,
        functionName: "buy",
        args: [tokenOut, slippageAdjusted],
        value: amountIn,
        account,
        chain: viemChain,
      });
    } else {
      const minOut = await publicClient.readContract({
        address: curveFactory,
        abi: ROBINFUN_FACTORY_ABI,
        functionName: "quoteSell",
        args: [tokenIn, amountIn],
      });
      const slippageAdjusted = (minOut * BigInt(10000 - order.maximumSlippageBps)) / 10000n;
      quotedExpectedOutput = minOut;
      quotedMinimumOutput = slippageAdjusted;
      // Approve curve factory to pull tokens
      const allowance = await publicClient.readContract({
        address: tokenIn,
        abi: ERC20_ABI,
        functionName: "allowance",
        args: [account.address, curveFactory],
      });
      if (allowance < amountIn) {
        const approveHash = await walletClient.writeContract({
          address: tokenIn,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [curveFactory, amountIn],
          account,
          chain: viemChain,
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      }
      txHash = await walletClient.writeContract({
        address: curveFactory,
        abi: ROBINFUN_FACTORY_ABI,
        functionName: "sell",
        args: [tokenIn, amountIn, slippageAdjusted],
        account,
        chain: viemChain,
      });
    }
  }

  // Record execution
  const execution = await prisma.orderExecution.create({
    data: {
      orderId: order.id,
      attempt: 1,
      expectedOutput: quotedExpectedOutput.toString(),
      minimumOutput: quotedMinimumOutput.toString(),
      transactionHash: txHash,
      status: "PENDING",
    },
  });

  // Wait for receipt
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  let actualAmounts: { tokenAmount: bigint; ethAmount: bigint } | null = null;
  let accountingError: string | null = null;
  if (receipt.status === "success") {
    try {
      const route = graduated
        ? {
            kind: "v2" as const,
            pairAddress:
              v2PairAddress ??
              (() => {
                throw new Error("V2 pair address is unavailable");
              })(),
            wethTokenIndex:
              v2WethTokenIndex ??
              (() => {
                throw new Error("V2 token orientation is unavailable");
              })(),
          }
        : { kind: "curve" as const, factoryAddress: curveFactory };
      actualAmounts = deriveSwapAmounts({
        logs: receipt.logs,
        walletAddress: account.address,
        tokenAddress: token,
        side: isBuy ? "buy" : "sell",
        route,
        transactionValue: isBuy ? amountIn : 0n,
      });
    } catch (error) {
      accountingError =
        error instanceof Error ? error.message : "Unable to derive swap amounts";
      console.warn(
        `Order ${order.id} confirmed, but receipt accounting is unavailable: ${accountingError}`
      );
    }
  }

  await prisma.orderExecution.update({
    where: { id: execution.id },
    data: {
      status: receipt.status === "success" ? "CONFIRMED" : "FAILED",
      actualTokenAmount: actualAmounts?.tokenAmount.toString(),
      actualEthAmount: actualAmounts?.ethAmount.toString(),
      errorCode: accountingError ? "ACCOUNTING_UNAVAILABLE" : null,
      errorMessage: accountingError,
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    },
  });

  // Record the attempt, but leave the final status to the caller — the
  // limit-order loop finalizes the order, while the DCA scheduler must
  // re-arm it for the next iteration.
  await prisma.automatedOrder.update({
    where: { id: order.id },
    data: {
      status: "ARMED",
      transactionHash: txHash,
      executedAt: new Date(),
      failureReason: receipt.status === "success" ? null : "Transaction reverted",
    },
  });

  await prisma.orderEvent.create({
    data: {
      orderId: order.id,
      eventType: receipt.status === "success" ? "CONFIRMED" : "FAILED",
      message: `Transaction ${txHash} ${receipt.status}`,
    },
  });

  console.log(`Order ${order.id} ${receipt.status}: ${txHash}`);

  return receipt.status === "success"
    ? { result: "success", txHash }
    : { result: "reverted", txHash };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function keepWorkerHealthy() {
  console.log("Worker is idle and will remain available for Docker health checks.");
  while (true) await sleep(60_000);
}

main().catch((error) => {
  console.error(`Worker terminated: ${safeErrorMessage(error)}`);
});
