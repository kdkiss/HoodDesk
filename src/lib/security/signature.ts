import { verifyMessage } from "viem";

export const SIGNATURE_VALIDITY_MS = 5 * 60 * 1000;

type AuthorizationValue = null | boolean | number | string | AuthorizationValue[] | {
  [key: string]: AuthorizationValue | undefined;
};

export type AuthorizationPayload = Record<string, AuthorizationValue | undefined>;

function canonicalize(value: AuthorizationValue | undefined): string {
  if (value === undefined) return "null";
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;

  return `{${Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

export function generateAuthMessage(
  action: string,
  ownerAddress: string,
  timestamp: number,
  payload: AuthorizationPayload
): string {
  return `I authorize this action on HoodDesk.
Action: ${action}
Owner: ${ownerAddress.toLowerCase()}
Timestamp: ${timestamp}
Payload: ${canonicalize(payload)}`;
}

export async function verifyAuthSignature(
  action: string,
  ownerAddress: string,
  timestamp: number,
  payload: AuthorizationPayload,
  signature: `0x${string}`
): Promise<{ valid: boolean; error?: string }> {
  const now = Date.now();
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > SIGNATURE_VALIDITY_MS) {
    return { valid: false, error: "Signature expired or timestamp invalid" };
  }

  const message = generateAuthMessage(action, ownerAddress, timestamp, payload);
  try {
    const valid = await verifyMessage({
      address: ownerAddress as `0x${string}`,
      message,
      signature,
    });
    if (!valid) return { valid: false, error: "Invalid signature" };

    return { valid: true };
  } catch {
    return { valid: false, error: "Signature verification failed" };
  }
}
