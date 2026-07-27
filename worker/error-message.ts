const MAX_ERROR_MESSAGE_LENGTH = 500;

/**
 * Returns a bounded, single-line error summary that is safe to persist or log.
 * Viem transport errors include the full RPC URL, which may contain an API key.
 */
export function safeErrorMessage(error: unknown): string {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Unknown error";
  const firstLine =
    rawMessage
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "Unknown error";

  return firstLine
    .replace(/\bhttps?:\/\/\S+/gi, "[redacted URL]")
    .slice(0, MAX_ERROR_MESSAGE_LENGTH);
}
