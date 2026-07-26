import {
  decodeEventLog,
  type Address,
  type Hex,
} from "viem";
import { ERC20_ABI } from "@/src/lib/dex/abi/erc20";
import { ROBINFUN_FACTORY_ABI } from "@/src/lib/dex/abi/robinfun-factory";
import { UNISWAP_V2_PAIR_ABI } from "@/src/lib/dex/abi/uniswap-v2-pair";

export interface SwapReceiptLog {
  address: Address;
  data: Hex;
  topics: readonly Hex[];
}

type SwapRoute =
  | {
      kind: "curve";
      factoryAddress: Address;
    }
  | {
      kind: "v2";
      pairAddress: Address;
      wethTokenIndex: 0 | 1;
    };

interface DeriveSwapAmountsInput {
  logs: readonly SwapReceiptLog[];
  walletAddress: Address;
  tokenAddress: Address;
  side: "buy" | "sell";
  route: SwapRoute;
  transactionValue: bigint;
}

export interface ActualSwapAmounts {
  tokenAmount: bigint;
  ethAmount: bigint;
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function eventTopics(log: SwapReceiptLog): [Hex, ...Hex[]] {
  if (log.topics.length === 0) {
    throw new Error("Event log has no topics");
  }
  return log.topics as [Hex, ...Hex[]];
}

function getNetTokenMovement(
  logs: readonly SwapReceiptLog[],
  tokenAddress: Address,
  walletAddress: Address
): { incoming: bigint; outgoing: bigint } {
  let incoming = 0n;
  let outgoing = 0n;

  for (const log of logs) {
    if (!sameAddress(log.address, tokenAddress)) continue;
    try {
      const decoded = decodeEventLog({
        abi: ERC20_ABI,
        eventName: "Transfer",
        data: log.data,
        topics: eventTopics(log),
      });
      const args = decoded.args as {
        from: Address;
        to: Address;
        value: bigint;
      };
      if (sameAddress(args.to, walletAddress)) incoming += args.value;
      if (sameAddress(args.from, walletAddress)) outgoing += args.value;
    } catch {
      // Other token events are irrelevant to accounting.
    }
  }

  return { incoming, outgoing };
}

function getCurveEthAmount(
  logs: readonly SwapReceiptLog[],
  input: DeriveSwapAmountsInput
): bigint {
  const matches: bigint[] = [];

  for (const log of logs) {
    if (
      input.route.kind !== "curve" ||
      !sameAddress(log.address, input.route.factoryAddress)
    ) {
      continue;
    }

    try {
      if (input.side === "buy") {
        const decoded = decodeEventLog({
          abi: ROBINFUN_FACTORY_ABI,
          eventName: "Buy",
          data: log.data,
          topics: eventTopics(log),
        });
        const args = decoded.args as {
          token: Address;
          buyer: Address;
          ethIn: bigint;
        };
        if (
          sameAddress(args.token, input.tokenAddress) &&
          sameAddress(args.buyer, input.walletAddress)
        ) {
          matches.push(args.ethIn);
        }
      } else {
        const decoded = decodeEventLog({
          abi: ROBINFUN_FACTORY_ABI,
          eventName: "Sell",
          data: log.data,
          topics: eventTopics(log),
        });
        const args = decoded.args as {
          token: Address;
          seller: Address;
          ethOut: bigint;
        };
        if (
          sameAddress(args.token, input.tokenAddress) &&
          sameAddress(args.seller, input.walletAddress)
        ) {
          matches.push(args.ethOut);
        }
      }
    } catch {
      // Other factory events are irrelevant to this swap.
    }
  }

  if (matches.length !== 1 || matches[0] <= 0n) {
    throw new Error("Unable to match one RobinFun swap event");
  }
  return matches[0];
}

function getV2SellEthAmount(
  logs: readonly SwapReceiptLog[],
  input: DeriveSwapAmountsInput
): bigint {
  if (input.route.kind !== "v2") {
    throw new Error("V2 route required");
  }

  let directTokenToPair = 0n;
  for (const log of logs) {
    if (!sameAddress(log.address, input.tokenAddress)) continue;
    try {
      const decoded = decodeEventLog({
        abi: ERC20_ABI,
        eventName: "Transfer",
        data: log.data,
        topics: eventTopics(log),
      });
      const args = decoded.args as {
        from: Address;
        to: Address;
        value: bigint;
      };
      if (
        sameAddress(args.from, input.walletAddress) &&
        sameAddress(args.to, input.route.pairAddress)
      ) {
        directTokenToPair += args.value;
      }
    } catch {
      // Ignore non-Transfer token logs.
    }
  }

  const matches: bigint[] = [];
  for (const log of logs) {
    if (!sameAddress(log.address, input.route.pairAddress)) continue;
    try {
      const decoded = decodeEventLog({
        abi: UNISWAP_V2_PAIR_ABI,
        eventName: "Swap",
        data: log.data,
        topics: eventTopics(log),
      });
      const args = decoded.args as {
        amount0In: bigint;
        amount1In: bigint;
        amount0Out: bigint;
        amount1Out: bigint;
      };
      const tokenInput =
        input.route.wethTokenIndex === 0 ? args.amount1In : args.amount0In;
      const wethOutput =
        input.route.wethTokenIndex === 0 ? args.amount0Out : args.amount1Out;
      if (tokenInput === directTokenToPair && wethOutput > 0n) {
        matches.push(wethOutput);
      }
    } catch {
      // Ignore other pair events.
    }
  }

  if (directTokenToPair <= 0n || matches.length !== 1) {
    throw new Error("Unable to match the wallet token transfer to one V2 swap");
  }
  return matches[0];
}

/**
 * Derives accounting amounts only from mined transaction facts.
 *
 * Token amounts use the wallet's net Transfer movement, which correctly
 * handles fee-on-transfer tokens. Sell proceeds use the matching curve or
 * V2 Swap event so internal fee-token swaps cannot be counted as proceeds.
 */
export function deriveSwapAmounts(
  input: DeriveSwapAmountsInput
): ActualSwapAmounts {
  const movement = getNetTokenMovement(
    input.logs,
    input.tokenAddress,
    input.walletAddress
  );
  const tokenAmount =
    input.side === "buy"
      ? movement.incoming - movement.outgoing
      : movement.outgoing - movement.incoming;

  if (tokenAmount <= 0n) {
    throw new Error("Swap receipt has no positive wallet token movement");
  }

  let ethAmount: bigint;
  if (input.route.kind === "curve") {
    ethAmount = getCurveEthAmount(input.logs, input);
  } else if (input.side === "buy") {
    ethAmount = input.transactionValue;
  } else {
    ethAmount = getV2SellEthAmount(input.logs, input);
  }

  if (ethAmount <= 0n) {
    throw new Error("Swap receipt has no positive native-token amount");
  }

  return { tokenAmount, ethAmount };
}
