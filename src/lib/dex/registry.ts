import { type Address } from "viem";
import { DEX_FACTORY, DEX_ROUTER, WETH, ROBINFUN_FACTORIES } from "@/src/config/contracts";


export interface DexConfig {
  id: string;
  name: string;
  kind: "curve" | "v2";
  factoryAddress: Address;
  routerAddress?: Address;
  wethAddress: Address;
}

export const DEX_REGISTRY: DexConfig[] = [
  {
    id: "robinfun-curve",
    name: "RobinFun Bonding Curve",
    kind: "curve",
    factoryAddress: ROBINFUN_FACTORIES[0], // V5
    wethAddress: WETH,
  },
  {
    id: "robinfun-v2",
    name: "RobinFun Uniswap V2",
    kind: "v2",
    factoryAddress: DEX_FACTORY,
    routerAddress: DEX_ROUTER,
    wethAddress: WETH,
  },
];

export function getDexConfig(id: string): DexConfig | undefined {
  return DEX_REGISTRY.find((d) => d.id === id);
}

export function getDefaultDex(): DexConfig {
  return DEX_REGISTRY[1]; // robinfun-v2 for graduated tokens
}

export function getCurveDex(): DexConfig {
  return DEX_REGISTRY[0];
}
