import { describe, expect, it } from "vitest";
import { dataSourceStatuses } from "./data-sources";
import { noteFallback, noteFailure, noteRateLimited } from "./provider-status";

const NOW = Date.parse("2026-11-07T22:00:00Z");

describe("dataSourceStatuses", () => {
  it("shows what's set up, recent limits and failures, and fallbacks, never the keys", () => {
    noteRateLimited("fmp", NOW - 60 * 60 * 1000);
    noteFailure("finnhub", "provider-error", NOW - 2 * 24 * 60 * 60 * 1000);
    noteFallback("tiingo");
    noteFallback("tiingo");
    const statuses = dataSourceStatuses(NOW, { FMP_API_KEY: "secret-fmp", FINNHUB_API_KEY: "secret-finnhub", TIINGO_API_KEY: "secret-tiingo" });
    const byName = Object.fromEntries(statuses.map((source) => [source.name, source]));
    expect(byName["Financial Modeling Prep"]).toMatchObject({ status: "Limit reached at 4:00 PM ET", tone: "warning" });
    // A failure from two days ago is old news.
    expect(byName.Finnhub).toMatchObject({ status: "Working", tone: "ok" });
    expect(byName.Tiingo).toMatchObject({ status: "Working", note: "Stood in for FMP 2 times since the server started." });
    expect(byName["Alpha Vantage"]).toMatchObject({ status: "Not set up", tone: "off" });
    expect(byName["SEC EDGAR"]).toMatchObject({ status: "Working" });
    expect(JSON.stringify(statuses)).not.toContain("secret");
  });
});
