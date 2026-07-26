import {
  decodeFunctionData,
  getAddress,
  type Address,
  type Hex,
} from "viem";
import { DEX_ROUTER, WETH, isRobinFunFactory } from "@/src/config/contracts";
import { getPublicClient } from "@/src/lib/chain/client";
import { ROBINFUN_FACTORY_ABI } from "@/src/lib/dex/abi/robinfun-factory";
import { ROBINFUN_TOKEN_ABI } from "@/src/lib/dex/abi/robinfun-token";
import { UNISWAP_V2_ROUTER_ABI } from "@/src/lib/dex/abi/uniswap-v2-router";
import { curveAdapter, v2Adapter } from "@/src/lib/dex";
import { deriveSwapAmounts } from "@/src/lib/portfolio/swap-receipt";

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function assertDirectPath(
  path: readonly Address[],
  expected: readonly Address[]
): void {
  if (
    path.length !== expected.length ||
    path.some((address, index) => !sameAddress(address, expected[index]))
  ) {
    throw new Error("Transaction does not use the supported direct swap path");
  }
}

function parseSupportedCall(input: {
  to: Address;
  from: Address;
  data: Hex;
  value: bigint;
}): {
  tokenAddress: Address;
  side: "buy" | "sell";
  target: "curve" | "v2";
} {
  if (sameAddress(input.to, DEX_ROUTER)) {
    const decoded = decodeFunctionData({
      abi: UNISWAP_V2_ROUTER_ABI,
      data: input.data,
    });

    if (
      decoded.functionName ===
      "swapExactETHForTokensSupportingFeeOnTransferTokens"
    ) {
      const [, path, recipient] = decoded.args;
      if (input.value <= 0n || !sameAddress(recipient, input.from)) {
        throw new Error("V2 buy sender, recipient, or value is invalid");
      }
      const tokenAddress = getAddress(path[1]);
      assertDirectPath(path, [WETH, tokenAddress]);
      return { tokenAddress, side: "buy", target: "v2" };
    }

    if (
      decoded.functionName ===
      "swapExactTokensForETHSupportingFeeOnTransferTokens"
    ) {
      const [, , path, recipient] = decoded.args;
      if (input.value !== 0n || !sameAddress(recipient, input.from)) {
        throw new Error("V2 sell sender, recipient, or value is invalid");
      }
      const tokenAddress = getAddress(path[0]);
      assertDirectPath(path, [tokenAddress, WETH]);
      return { tokenAddress, side: "sell", target: "v2" };
    }

    throw new Error("Transaction is not a supported RobinFun V2 swap");
  }

  if (isRobinFunFactory(input.to)) {
    const decoded = decodeFunctionData({
      abi: ROBINFUN_FACTORY_ABI,
      data: input.data,
    });
    if (decoded.functionName !== "buy" && decoded.functionName !== "sell") {
      throw new Error("Transaction is not a supported RobinFun curve swap");
    }
    const side = decoded.functionName;
    if (
      (side === "buy" && input.value <= 0n) ||
      (side === "sell" && input.value !== 0n)
    ) {
      throw new Error("Curve swap direction does not match transaction value");
    }
    return {
      tokenAddress: getAddress(decoded.args[0] as Address),
      side,
      target: "curve",
    };
  }

  throw new Error("Transaction target is not an allowlisted swap contract");
}

export async function verifySwapTransaction(input: {
  chainId: number;
  transactionHash: Hex;
  expectedTokenAddress?: Address;
}) {
  const client = getPublicClient(input.chainId);
  const transactionHash = input.transactionHash.toLowerCase() as Hex;
  const [transaction, receipt] = await Promise.all([
    client.getTransaction({ hash: transactionHash }),
    client.getTransactionReceipt({ hash: transactionHash }),
  ]);

  if (receipt.status !== "success" || !transaction.to) {
    throw new Error("Only successful contract-call transactions can be tracked");
  }

  const walletAddress = getAddress(transaction.from);
  const parsed = parseSupportedCall({
    to: transaction.to,
    from: walletAddress,
    data: transaction.input,
    value: transaction.value,
  });
  if (
    input.expectedTokenAddress &&
    !sameAddress(parsed.tokenAddress, input.expectedTokenAddress)
  ) {
    throw new Error("Transaction token does not match the requested token");
  }
  if (!(await curveAdapter.isRobinFunToken(parsed.tokenAddress))) {
    throw new Error("Token is not a RobinFun token");
  }

  let route:
    | { kind: "curve"; factoryAddress: Address }
    | {
        kind: "v2";
        pairAddress: Address;
        wethTokenIndex: 0 | 1;
      };

  if (parsed.target === "v2") {
    const tokenInfo = await v2Adapter.getTokenInfo(parsed.tokenAddress);
    if (!tokenInfo.pairAddress) {
      throw new Error("Graduated token pair is unavailable");
    }
    const pairTokens = await v2Adapter.getPairTokens(tokenInfo.pairAddress);
    const wethTokenIndex = sameAddress(pairTokens.token0, WETH)
      ? 0
      : sameAddress(pairTokens.token1, WETH)
        ? 1
        : null;
    if (wethTokenIndex === null) {
      throw new Error("Token pair does not contain wrapped native token");
    }
    route = {
      kind: "v2",
      pairAddress: tokenInfo.pairAddress,
      wethTokenIndex,
    };
  } else {
    const tokenFactory = (await client.readContract({
      address: parsed.tokenAddress,
      abi: ROBINFUN_TOKEN_ABI,
      functionName: "factory",
    })) as Address;
    if (!sameAddress(tokenFactory, transaction.to)) {
      throw new Error("Transaction factory does not own the token");
    }
    route = { kind: "curve", factoryAddress: tokenFactory };
  }

  const amounts = deriveSwapAmounts({
    logs: receipt.logs,
    walletAddress,
    tokenAddress: parsed.tokenAddress,
    side: parsed.side,
    route,
    transactionValue: transaction.value,
  });
  const block = await client.getBlock({ blockNumber: receipt.blockNumber });

  return {
    transactionHash,
    walletAddress,
    tokenAddress: parsed.tokenAddress,
    side: parsed.side,
    tokenAmount: amounts.tokenAmount,
    ethAmount: amounts.ethAmount,
    blockNumber: receipt.blockNumber,
    blockTimestampMs: block.timestamp * 1000n,
    gasUsed: receipt.gasUsed,
  };
}
