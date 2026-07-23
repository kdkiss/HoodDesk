const API_BASE = process.env.BLOCKSCOUT_API_URL ?? "https://robinhoodchain.blockscout.com/api/v2";
const API_KEY = process.env.BLOCKSCOUT_API_KEY ?? "";
const PRO_API_BASE = "https://api.blockscout.com";

interface BlockscoutRequestOptions {
  chainId?: number;
  timeoutMs?: number;
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
      throw new Error(`Blockscout ${res.status}: ${await res.text()}`);
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
      throw new Error(`Blockscout PRO ${res.status}: ${await res.text()}`);
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}
