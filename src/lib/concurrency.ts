// Runs `task` over `items` with at most `limit` running at once, keeping the results in order. For loading
// many companies without tripping a provider's per-second limit.
export async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }));
  return results;
}

// Spaces calls out to at most one every `intervalMs`, however many run at once: `await space()` before each
// request to a provider with a per-second limit (SEC EDGAR allows 10 a second).
export function spacing(intervalMs: number, now: () => number = Date.now, sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))) {
  let next = 0;
  return async function space(): Promise<void> {
    const at = Math.max(now(), next);
    next = at + intervalMs;
    const wait = at - now();
    if (wait > 0) await sleep(wait);
  };
}
