const API_BASE = process.env.BLOCKSCOUT_API_URL ?? "https://robinhoodchain.blockscout.com/api/v2";
const API_KEY = process.env.BLOCKSCOUT_API_KEY ?? "";
const PRO_API_BASE = "https://api.blockscout.com";
const RPC_API_BASE = `${new URL(API_BASE).origin}/api`;
const PRO_RPC_API_BASE = `${PRO_API_BASE}/v2/api`;

interface BlockscoutRequestOptions {
  chainId?: number;
  timeoutMs?: number;
}

export class BlockscoutHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryAfterMs: number | null
  ) {
    super(message);
    this.name = "BlockscoutHttpError";
  }
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

async function httpError(label: string, response: Response): Promise<BlockscoutHttpError> {
  const body = (await response.text()).slice(0, 500);
  return new BlockscoutHttpError(
    `${label} ${response.status}: ${body}`,
    response.status,
    parseRetryAfter(response.headers.get("retry-after"))
  );
}

export async function blockscoutGet<T>(
  path: string,
  params?: Record<string, string>,
  opts?: BlockscoutRequestOptions
): Promise<T> {
  const url = new URL(`${API_BASE}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 15_000);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "HoodDesk/0.1.0",
        Accept: "application/json",
        ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw await httpError("Blockscout", res);
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function blockscoutRpcGet<T>(
  params: Record<string, string>,
  opts?: BlockscoutRequestOptions
): Promise<T> {
  const url = new URL(API_KEY ? PRO_RPC_API_BASE : RPC_API_BASE);
  Object.entries(params).forEach(([key, value]) =>
    url.searchParams.set(key, value)
  );
  if (API_KEY) {
    url.searchParams.set(
      "chain_id",
      String(opts?.chainId ?? process.env.NEXT_PUBLIC_CHAIN_ID ?? 4663)
    );
    url.searchParams.set("apikey", API_KEY);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 20_000);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "HoodDesk/0.1.0",
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw await httpError("Blockscout RPC", res);
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

// Blockscout PRO API (api.blockscout.com) for enriched data
export async function blockscoutProGet<T>(
  chainId: number,
  path: string,
  params?: Record<string, string>,
  opts?: BlockscoutRequestOptions
): Promise<T> {
  const url = new URL(`${PRO_API_BASE}/${chainId}${path}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 15_000);

  try {
    const res = await fetch(url.toString(), {
      headers: {
        "User-Agent": "HoodDesk/0.1.0",
        Accept: "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw await httpError("Blockscout PRO", res);
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}
