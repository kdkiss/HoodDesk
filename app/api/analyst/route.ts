import { NextRequest, NextResponse } from "next/server";
import { analystRequestSchema, runAnalyst } from "@/src/lib/ai/analyst";
import { checkRateLimit } from "@/src/lib/security/rate-limit";

const MAX_ANALYST_BODY_BYTES = 64 * 1024;

export async function POST(req: NextRequest) {
  const limited = checkRateLimit(req, { limit: 10, windowMs: 60_000, bucket: "analyst" });
  if (limited) return limited;

  try {
    const body = await readBoundedJson(req);
    const parsed = analystRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid analyst request", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const analysis = await runAnalyst(parsed.data);
    return NextResponse.json({ analysis });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { error: "Analyst request is too large" },
        { status: 413 }
      );
    }
    const message = error instanceof Error ? error.message : "Unable to run analyst";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

class RequestBodyTooLargeError extends Error {}

async function readBoundedJson(req: NextRequest): Promise<unknown> {
  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_ANALYST_BODY_BYTES
  ) {
    throw new RequestBodyTooLargeError();
  }
  if (!req.body) return null;

  const reader = req.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ANALYST_BODY_BYTES) {
      await reader.cancel();
      throw new RequestBodyTooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text);
}
