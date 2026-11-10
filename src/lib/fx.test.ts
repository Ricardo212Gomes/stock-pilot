import { afterEach, describe, expect, it, vi } from "vitest";
import { fxFrom, getEurPerUsd, parseFrankfurter, SAME_CURRENCY } from "./fx";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseFrankfurter", () => {
  it("reads each business day's rate, oldest first, and drops what isn't a rate", () => {
    const payload = {
      amount: 1,
      base: "USD",
      rates: {
        "2026-11-09": { EUR: 0.88 },
        "2026-11-05": { EUR: 0.86 },
        "2026-11-06": { EUR: "0.87" },
        "2026-11-07": { EUR: 0 },
        later: { EUR: 0.9 },
      },
    };
    expect(parseFrankfurter(payload)).toEqual([
      { date: "2026-11-05", eurPerUsd: 0.86 },
      { date: "2026-11-09", eurPerUsd: 0.88 },
    ]);
    expect(parseFrankfurter(null)).toEqual([]);
    expect(parseFrankfurter({ message: "not found" })).toEqual([]);
  });
});

describe("fxFrom", () => {
  const fx = fxFrom([
    { date: "2026-11-05", eurPerUsd: 0.86 },
    { date: "2026-11-06", eurPerUsd: 0.87 },
    { date: "2026-11-09", eurPerUsd: 0.88 },
  ]);

  it("converts at the rate of the day, or of the business day before it", () => {
    expect(fx.convert(100, "USD", "EUR", "2026-11-06")).toBeCloseTo(87);
    // The weekend takes Friday's rate, and euros go back to dollars at it.
    expect(fx.convert(100, "USD", "EUR", "2026-11-08")).toBeCloseTo(87);
    expect(fx.convert(87, "EUR", "USD", "2026-11-07")).toBeCloseTo(100);
    // After the latest rate, the latest; before the first, the first.
    expect(fx.convert(100, "USD", "EUR", "2026-11-10")).toBeCloseTo(88);
    expect(fx.convert(100, "USD", "EUR", "2026-01-02")).toBeCloseTo(86);
    expect(fx.convert(42, "EUR", "EUR", "2026-11-06")).toBe(42);
  });

  it("refuses to convert without rates", () => {
    expect(SAME_CURRENCY.convert(42, "USD", "USD", "2026-11-06")).toBe(42);
    expect(() => SAME_CURRENCY.convert(42, "USD", "EUR", "2026-11-06")).toThrow(/No exchange rates/);
  });
});

describe("getEurPerUsd", () => {
  it("asks Frankfurter for every day since the start, in euros per dollar", async () => {
    const fetchMock = vi.fn(async () => Response.json({ base: "USD", rates: { "2026-11-06": { EUR: 0.87 } } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(getEurPerUsd("2026-11-01")).resolves.toEqual([{ date: "2026-11-06", eurPerUsd: 0.87 }]);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("https://api.frankfurter.dev/v1/2026-11-01..?base=USD&symbols=EUR");
  });

  it("answers null when Frankfurter fails or has no rates", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
    await expect(getEurPerUsd("2026-11-01")).resolves.toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ base: "USD", rates: {} })));
    await expect(getEurPerUsd("2026-11-01")).resolves.toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));
    await expect(getEurPerUsd("2026-11-01")).resolves.toBeNull();
  });
});
