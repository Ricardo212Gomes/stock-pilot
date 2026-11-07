// What the data providers have said lately, kept in memory by the server process, for the Data sources card
// in Settings: when each last hit its rate limit or failed, and how often a fallback stood in. It restarts
// empty with the server, so it describes recent behaviour, not a full history.

export type ProviderId = "fmp" | "finnhub" | "tiingo" | "sec";

export type ProviderEvents = {
  // When the provider last answered that its request limit was reached.
  limitedAt: number | null;
  // When a request last failed for another reason, and why.
  failedAt: number | null;
  failure: string | null;
  // How many times this provider's data stood in for another's.
  fallbacks: number;
};

const events = new Map<ProviderId, ProviderEvents>();

function entry(provider: ProviderId): ProviderEvents {
  let current = events.get(provider);
  if (!current) {
    current = { limitedAt: null, failedAt: null, failure: null, fallbacks: 0 };
    events.set(provider, current);
  }
  return current;
}

export function noteRateLimited(provider: ProviderId, at = Date.now()): void {
  entry(provider).limitedAt = at;
}

export function noteFailure(provider: ProviderId, failure: string, at = Date.now()): void {
  const current = entry(provider);
  current.failedAt = at;
  current.failure = failure;
}

export function noteFallback(provider: ProviderId): void {
  entry(provider).fallbacks++;
}

export function providerEvents(provider: ProviderId): ProviderEvents {
  return { ...entry(provider) };
}

export function resetProviderEvents(): void {
  events.clear();
}
