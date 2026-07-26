const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 200;

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

function isTransientRpcError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") return true;
  if (!(error instanceof Error)) return false;

  return (
    /\b(?:408|425|429|5\d\d)\b/.test(error.message) ||
    /fetch failed|network|socket|econnreset|econnrefused|etimedout|timeout|temporar(?:y|ily)/i.test(
      error.message
    )
  );
}
