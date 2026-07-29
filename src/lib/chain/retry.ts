const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 200;
const MAX_ERROR_CAUSE_DEPTH = 8;

/**
 * Retry a read-only RPC operation that can safely be repeated.
 *
 * This is intentionally not used for wallet writes or transaction
 * submission: those operations need idempotency handling, not blind retry.
 */
export async function retryRpcRead<T>(
  operation: () => Promise<T>,
  options: { attempts?: number; delayMs?: number } = {}
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || !isTransientRpcError(error)) break;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }

  throw lastError;
}

export function isTransientRpcError(error: unknown): boolean {
  const seen = new Set<object>();
  let current: unknown = error;

  for (let depth = 0; current != null && depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    if (isTransientErrorNode(current)) return true;
    if (typeof current !== "object" || seen.has(current)) break;

    seen.add(current);
    current = "cause" in current ? current.cause : undefined;
  }

  return false;
}

function isTransientErrorNode(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (typeof error !== "object" || error === null) return false;

  const message =
    "message" in error && typeof error.message === "string" ? error.message : "";
  const code =
    "code" in error && (typeof error.code === "string" || typeof error.code === "number")
      ? String(error.code)
      : "";
  return (
    /\b(?:408|425|429|5\d\d)\b/.test(message) ||
    /fetch failed|network|socket|econnreset|econnrefused|etimedout|timeout|took too long to respond|temporar(?:y|ily)/i.test(
      message
    ) ||
    /metadata is not found|missing trie node|state .* is not available/i.test(message) ||
    /^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR_)/i.test(code)
  );
}
