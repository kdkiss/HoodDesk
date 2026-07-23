import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import {
  SIGNATURE_VALIDITY_MS,
  type AuthorizationPayload,
  verifyAuthSignature,
} from "@/src/lib/security/signature";

/**
 * Verifies a payload-bound wallet signature and consumes it once. The unique
 * digest prevents a captured authorization from being replayed within its
 * validity window or after a successful request.
 */
export async function verifyAndConsumeAuthSignature(
  action: string,
  ownerAddress: string,
  timestamp: number,
  payload: AuthorizationPayload,
  signature: `0x${string}`
): Promise<{ valid: boolean; error?: string }> {
  const verification = await verifyAuthSignature(
    action,
    ownerAddress,
    timestamp,
    payload,
    signature
  );
  if (!verification.valid) return verification;

  const digest = createHash("sha256")
    .update(`${action}:${ownerAddress.toLowerCase()}:${signature}`)
    .digest("hex");

  try {
    await prisma.usedAuthorization.deleteMany({
      where: { expiresAt: { lte: new Date() } },
    });
    await prisma.usedAuthorization.create({
      data: {
        digest,
        ownerAddress: ownerAddress.toLowerCase(),
        action,
        expiresAt: new Date(timestamp + SIGNATURE_VALIDITY_MS),
      },
    });
    return { valid: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { valid: false, error: "Authorization has already been used" };
    }
    console.error("Unable to record signature authorization", error);
    return { valid: false, error: "Unable to verify authorization" };
  }
}
