const FINNHUB_BASE_URL = "https://finnhub.io/api/v1";

export type FinnhubFailureReason =
  | "not-configured"
  | "rate-limited"
  | "invalid-key"
  | "plan-restricted"
  | "provider-error";

export type FinnhubResult =
  | { ok: true; payload: unknown }
  | { ok: false; reason: FinnhubFailureReason };

function reasonForStatus(status: number): FinnhubFailureReason {
  if (status === 429) return "rate-limited";
  if (status === 401) return "invalid-key";
  if (status === 402 || status === 403) return "plan-restricted";
  return "provider-error";
}

export async function fetchFinnhub(
  endpoint: string,
  params: Record<string, string>,
  revalidate: number,
): Promise<FinnhubResult> {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) return { ok: false, reason: "not-configured" };

  const url = new URL(`${FINNHUB_BASE_URL}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  try {
    // The key travels in a header, so it never appears in URLs or logs.
    const response = await fetch(url, {
      headers: { "X-Finnhub-Token": apiKey },
      next: { revalidate },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) return { ok: false, reason: reasonForStatus(response.status) };
    return { ok: true, payload: await response.json() };
  } catch {
    return { ok: false, reason: "provider-error" };
  }
}

// Finnhub writes share classes with a dot (BRK.B); StockPilot accepts BRK-B too.
export function finnhubSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/-/g, ".");
}
