import { type Address } from "viem";

// RobinFun launchpad factory versions (newest first)
export const ROBINFUN_FACTORIES: Address[] = [
  "0xd861cb5DC71A0171E8F0f6586cADb069f3A35E4d", // V5 (current)
  "0x42B1f2Fb09502b66Ae21769b3384a7788d020d73", // V4
  "0x9A4a94Bd3aF6acF5567A3B22f264E08B0962B8c8", // V3
  "0xD69A9fDee44a42c8E614128FEda486128cB27222", // V2
  "0xD952A74C85a2221a7DaB185c62cfD7EBa8C94AFC", // V1
];

// Graduation DEX (Uniswap V2 style on Robinhood Chain)
export const DEX_FACTORY: Address = "0x8bcEaA40B9AcdfAedF85AdF4FF01F5Ad6517937f";
export const DEX_ROUTER: Address = "0x89e5DB8B5aA49aA85AC63f691524311AEB649eba";
export const WETH: Address = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";

// RobinFun staking pool (not used for trading, listed for reference)
export const ROBINFUN_STAKING: Address = "0x2cE2B3B7bC9A0093681Fc280b1bF77C30DB3f1a3";

export function isRobinFunFactory(address: string): boolean {
  return ROBINFUN_FACTORIES.some(
    (f) => f.toLowerCase() === address.toLowerCase()
  );
}

export function isAllowlistedRouter(address: string): boolean {
  const env = process.env.ALLOWED_ROUTER_ADDRESSES;
  if (!env) return address.toLowerCase() === DEX_ROUTER.toLowerCase();
  return env
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .includes(address.toLowerCase());
}

export function isAllowlistedFactory(address: string): boolean {
  const env = process.env.ALLOWED_FACTORY_ADDRESSES;
  if (!env) return address.toLowerCase() === DEX_FACTORY.toLowerCase();
  return env
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .includes(address.toLowerCase());
}
