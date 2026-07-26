import { NextRequest, NextResponse } from "next/server";
import { formatEther } from "viem";
import { isAddress } from "viem";
import { getPublicClient } from "@/src/lib/chain/client";
import { getChain } from "@/src/config/chains";
import { checkRateLimit, RATE_LIMITS } from "@/src/lib/security/rate-limit";

function configuredExecutionAddress(): `0x${string}` | null {
  const address = process.env.EXECUTION_WALLET_ADDRESS;
  return address && isAddress(address) ? address : null;
}

export async function GET(req: NextRequest) {
  const limited = checkRateLimit(req, { ...RATE_LIMITS.standard, bucket: "health" });
  if (limited) return limited;

  try {
    const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663);
    const chain = getChain(chainId);
    const client = getPublicClient(chainId);

    const [blockNumber, gasPrice] = await Promise.all([
      client.getBlockNumber(),
      client.getGasPrice(),
    ]);

    const executionAddress = configuredExecutionAddress();
    const executionWalletBalanceWei = executionAddress
      ? await client.getBalance({ address: executionAddress })
      : null;

    return NextResponse.json({
      status: "ok",
      chainId,
      chainName: chain.name,
      blockNumber: blockNumber.toString(),
      gasPriceWei: gasPrice.toString(),
      gasPriceGwei: (Number(gasPrice) / 1e9).toFixed(4),
      executionEnabled: process.env.EXECUTION_ENABLED === "true",
      emergencyPause: process.env.EMERGENCY_PAUSE === "true",
      executionWalletAddress: executionAddress,
      executionWalletBalanceEth:
        executionWalletBalanceWei !== null ? formatEther(executionWalletBalanceWei) : null,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "error",
        error: err instanceof Error ? err.message : "Unknown error",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
