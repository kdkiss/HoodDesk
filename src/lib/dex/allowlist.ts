import { type Address } from "viem";
import { DEX_FACTORY, DEX_ROUTER, WETH, isRobinFunFactory } from "@/src/config/contracts";

export function isAllowlistedContract(address: Address): boolean {
  const a = address.toLowerCase();
  if (a === DEX_ROUTER.toLowerCase()) return true;
  if (a === DEX_FACTORY.toLowerCase()) return true;
  if (a === WETH.toLowerCase()) return true;
  if (isRobinFunFactory(a)) return true;
  return false;
}

export function isAllowlistedToken(address: Address): boolean {
  const env = process.env.ALLOWED_TOKEN_ADDRESSES;
  if (!env || env.trim() === "") return true; // no additional restriction
  return env
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .includes(address.toLowerCase());
}

export function getAllowlistedRouters(): Address[] {
  const env = process.env.ALLOWED_ROUTER_ADDRESSES;
  if (!env) return [DEX_ROUTER];
  return env.split(",").map((a) => a.trim() as Address);
}

export function getAllowlistedFactories(): Address[] {
  const env = process.env.ALLOWED_FACTORY_ADDRESSES;
  if (!env) return [DEX_FACTORY];
  return env.split(",").map((a) => a.trim() as Address);
}
