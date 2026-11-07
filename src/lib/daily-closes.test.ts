import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDailyCloses } from "./daily-closes";

const NOW = new Date("2026-11-07T12:00:00Z");

function tiingoRows() {
  // Two closes before the 400-day window and two inside it.
  return [
    { date: "2025-01-02T00:00:00.000Z", adjClose: 90 },
    { date: "2025-10-02T00:00:00.000Z", adjClose: 95 },
    { date: "2025-10-03T00:00:00.000Z", adjClose: 100 },
    { date: "2026-11-06T00:00:00.000Z", adjClose: 120 },
  ];
}

function mock(fmp: () => Response) {
  const fetchMock = vi.fn(async (input: URL | string) => (new URL(String(input)).hostname === "api.tiingo.com" ? Response.json(tiingoRows()) : fmp()));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.stubEnv("FMP_API_KEY", "fmp-key");
  vi.stubEnv("TIINGO_API_KEY", "tiingo-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("getDailyCloses", () => {
  it("uses FMP's closes when it has them", async () => {
    const fetchMock = mock(() => Response.json([{ date: "2026-11-06", price: 342.37 }]));
    await expect(getDailyCloses("AAPL", NOW)).resolves.toEqual([{ date: "2026-11-06", close: 342.37 }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new URL(String(fetchMock.mock.calls[0][0])).searchParams.get("from")).toBe("2025-10-03");
  });

  it("falls back to Tiingo's last 400 days when FMP's plan or limit says no", async () => {
    mock(() => new Response("Premium Query Parameter", { status: 402 }));
    await expect(getDailyCloses("MU", NOW)).resolves.toEqual([{ date: "2025-10-03", close: 100 }, { date: "2026-11-06", close: 120 }]);
    mock(() => new Response("Limit Reach", { status: 429 }));
    await expect(getDailyCloses("MU", NOW)).resolves.toHaveLength(2);
    mock(() => Response.json([]));
    await expect(getDailyCloses("MU", NOW)).resolves.toHaveLength(2);
  });

  it("passes on FMP's failure when Tiingo can't stand in, and doesn't hide a bad key", async () => {
    vi.stubEnv("TIINGO_API_KEY", "");
    mock(() => new Response("Limit Reach", { status: 429 }));
    await expect(getDailyCloses("MU", NOW)).rejects.toMatchObject({ reason: "rate-limited" });

    vi.stubEnv("TIINGO_API_KEY", "tiingo-key");
    const fetchMock = mock(() => new Response("Invalid API KEY", { status: 401 }));
    await expect(getDailyCloses("MU", NOW)).rejects.toMatchObject({ reason: "invalid-key" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
