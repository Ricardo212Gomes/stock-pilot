import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planImport, tradeId } from "./portfolio-import";
import type { SavedInstrument } from "./portfolio-trades";
import type { Statement, StatementTrade } from "./statements";

// A made-up account in euros. NVIDIA trades on a euro line (NVD) and a dollar line (NVDA); IREN's ISIN is
// Australian; VWCE is a European fund with no US listing; Apple was sold off.
const NVIDIA = "US67066G1040";
const TESLA = "US88160R1014";
const IREN = "AU0000185993";
const VWCE = "IE00BK5BQT80";
const APPLE = "US0378331005";

function trade(time: string, code: string, isin: string, orderId: string, side: "buy" | "sell", shares: number, price: [number, string], total: number | null, orderType = "Market", result: number | null = null): StatementTrade {
  return {
    id: `t212:${orderId}:${time}:${shares}:${price[0]}`,
    time,
    code,
    isin,
    side,
    shares,
    price: { amount: price[0], currency: price[1] },
    accountValue: total === null ? null : { amount: side === "buy" ? -total : total, currency: "EUR" },
    result: result === null ? null : { amount: result, currency: "EUR" },
    orderType,
  };
}

const first = trade("2026-03-02T14:31:05Z", "NVD", NVIDIA, "4011", "buy", 2.5, [151.2, "EUR"], 378.15);

const STATEMENT: Statement = {
  broker: "trading212",
  from: "2026-03-01",
  to: "2026-06-30",
  accountCurrency: "EUR",
  trades: [
    first,
    // Listed before the buy it follows, on the same day.
    trade("2026-03-03T18:00:00Z", "NVD", NVIDIA, "4013", "sell", 0.5, [152, "EUR"], 75.9, "Market", 0.25),
    trade("2026-03-03T15:02:11Z", "NVDA", NVIDIA, "4012", "buy", 1, [176.1, "USD"], 151.8),
    // 3:30 a.m. in UTC is still March 3 in New York.
    trade("2026-03-04T03:30:00Z", "NVDA", NVIDIA, "4014", "buy", 0.5, [177, "USD"], 76),
    trade("2026-03-10T15:00:00Z", "TSLA", TESLA, "5001", "buy", 1, [300, "USD"], 260),
    // A three-for-one split: the old share out, three new ones in, at the same value.
    trade("2026-03-20T12:00:00Z", "TSLA", TESLA, "5002", "sell", 1, [300, "USD"], 270, "Stock split", 0),
    trade("2026-03-20T12:00:00Z", "TSLA", TESLA, "5003", "buy", 3, [100, "USD"], 270, "Stock split"),
    // No total in euros, and a price in dollars: it can't be costed.
    trade("2026-03-25T15:00:00Z", "TSLA", TESLA, "5004", "buy", 1, [105, "USD"], null),
    trade("2026-04-01T14:00:00Z", "IREN", IREN, "6001", "buy", 10, [40, "USD"], 345),
    trade("2026-04-02T09:00:00Z", "VWCE", VWCE, "7001", "buy", 2, [130, "EUR"], 260),
    trade("2026-04-03T15:00:00Z", "AAPL", APPLE, "8001", "buy", 1, [250, "USD"], 215),
    trade("2026-04-06T15:00:00Z", "AAPL", APPLE, "8002", "sell", 1, [255, "USD"], 219, "Market", 4.3),
  ],
  positions: [
    { code: "NVDA", isin: NVIDIA, shares: 3.5, averagePrice: null },
    { code: "TSLA", isin: TESLA, shares: 4, averagePrice: null },
    { code: "IREN", isin: IREN, shares: 10, averagePrice: null },
    { code: "VWCE", isin: VWCE, shares: 2, averagePrice: null },
  ],
  dividends: [
    { id: "t212:dividend:nvidia", code: "NVD", isin: NVIDIA, shares: 3.5, paidOn: "2026-04-02", amount: { amount: 0.03, currency: "EUR" } },
    { id: "t212:dividend:apple", code: "AAPL", isin: APPLE, shares: 1, paidOn: "2026-04-05", amount: { amount: 0.22, currency: "EUR" } },
  ],
  interest: [
    { id: "t212:interest:euros", paidOn: "2026-03-02", kind: "cash", amount: { amount: 0.05, currency: "EUR" } },
    { id: "t212:interest:dollars", paidOn: "2026-03-02", kind: "cash", amount: { amount: 0.05, currency: "EUR" } },
  ],
  otherCash: 3,
};

const NOW = new Date("2026-11-10T20:00:00Z");
const EMPTY = { ids: new Set<string>(), instruments: new Map<string, SavedInstrument>() };

function saved(symbol: string, priced: boolean, shares: [string, number][] = []): SavedInstrument {
  return { symbol, priced, shares: new Map(shares) as SavedInstrument["shares"] };
}

type Prices = Record<string, { date: string; close: number }[]>;

// Finnhub's profiles by ISIN and Tiingo's closes by ticker.
function serve(profiles: Record<string, unknown>, prices: Prices) {
  return vi.fn(async (input: URL | string) => {
    const url = new URL(String(input));
    if (url.hostname === "finnhub.io") return Response.json(profiles[url.searchParams.get("isin") ?? ""] ?? {});
    const ticker = /\/tiingo\/daily\/([^/]+)\/prices$/.exec(url.pathname)?.[1]?.toUpperCase() ?? "";
    const rows = prices[ticker];
    if (!rows) return Response.json({ detail: "Not found." }, { status: 404 });
    return Response.json(rows.map((row) => ({ date: `${row.date}T00:00:00.000Z`, close: row.close, adjClose: row.close, splitFactor: 1, divCash: 0 })));
  });
}

const PROFILES = { [NVIDIA]: { ticker: "NVDA", name: "NVIDIA Corp" }, [TESLA]: { ticker: "TSLA", name: "Tesla Inc" } };
const PRICES: Prices = { IREN: [{ date: "2026-03-31", close: 39.5 }, { date: "2026-04-01", close: 41 }] };

async function plan(statement: Statement, state = EMPTY) {
  const result = await planImport(statement, state, NOW);
  if (!result.ok) throw new Error(result.error);
  return result.plan;
}

describe("planImport", () => {
  beforeEach(() => {
    vi.stubEnv("FINNHUB_API_KEY", "finnhub-key");
    vi.stubEnv("TIINGO_API_KEY", "tiingo-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("imports every trade, the companies sold off too, at what they cost in the account's currency", async () => {
    vi.stubGlobal("fetch", serve(PROFILES, PRICES));
    const result = await plan(STATEMENT, { ...EMPTY, ids: new Set([tradeId(first)]) });
    expect(result).toMatchObject({ broker: "trading212", from: "2026-03-01", to: "2026-06-30", currency: "EUR", splits: 1, duplicates: 1, withoutTotal: 1, otherCash: 3, sold: { instruments: 1, trades: 2 }, incomplete: [], relabels: [] });
    expect(result.holdings).toEqual([
      { symbol: "IREN", name: "IREN", isin: IREN, codes: ["IREN"], trades: 1, shares: 10, tradedShares: 10, priced: true },
      { symbol: "NVDA", name: "NVIDIA Corp", isin: NVIDIA, codes: ["NVD", "NVDA"], trades: 3, shares: 3.5, tradedShares: 3.5, priced: true },
      // The split's entries count towards the shares, not as trades.
      { symbol: "TSLA", name: "Tesla Inc", isin: TESLA, codes: ["TSLA"], trades: 1, shares: 4, tradedShares: 4, priced: true },
      // No US listing: imported without prices.
      { symbol: "VWCE", name: VWCE, isin: VWCE, codes: ["VWCE"], trades: 1, shares: 2, tradedShares: 2, priced: false },
    ]);
    expect(result.unresolved).toEqual([{ code: "VWCE", isin: VWCE }]);
    expect(result.unchecked).toEqual([]);
    // Oldest first, the sale after the buy, each at its total per share; Tesla's buy before the split in the new
    // shares.
    expect(result.trades.map((entry) => [entry.symbol, entry.side, entry.shares, entry.price, entry.date, entry.priced])).toEqual([
      ["NVDA", "buy", 1, 151.8, "2026-03-03", true],
      ["NVDA", "sell", 0.5, 151.8, "2026-03-03", true],
      ["NVDA", "buy", 0.5, 152, "2026-03-03", true],
      ["TSLA", "buy", 3, 260 / 3, "2026-03-10", true],
      ["IREN", "buy", 10, 34.5, "2026-04-01", true],
      [VWCE, "buy", 2, 130, "2026-04-02", false],
      [APPLE, "buy", 1, 215, "2026-04-03", false],
      [APPLE, "sell", 1, 219, "2026-04-06", false],
    ]);
    expect(result.trades[0]).toEqual({
      symbol: "NVDA",
      side: "buy",
      shares: 1,
      price: 151.8,
      currency: "EUR",
      date: "2026-03-03",
      externalId: "t212:4012:2026-03-03T15:02:11Z:1:176.1",
      isin: NVIDIA,
      priced: true,
      label: null,
      name: null,
    });
    // Apple, sold off, goes by its dollar line's code and the stock list's name.
    expect(result.trades.at(-1)).toMatchObject({ isin: APPLE, label: "AAPL", name: expect.stringMatching(/^Apple/) });
  });

  it("imports the dividends on each position and the interest, and checks the gains against Trading 212's", async () => {
    vi.stubGlobal("fetch", serve(PROFILES, PRICES));
    const result = await plan(STATEMENT);
    expect(result).toMatchObject({ dividends: 2, interest: 2 });
    expect(result.income).toEqual([
      { kind: "dividend", symbol: "NVDA", isin: NVIDIA, amount: 0.03, currency: "EUR", date: "2026-04-02", externalId: "t212:dividend:nvidia" },
      // A company sold off keeps its dividends under its ISIN.
      { kind: "dividend", symbol: APPLE, isin: APPLE, amount: 0.22, currency: "EUR", date: "2026-04-05", externalId: "t212:dividend:apple" },
      { kind: "interest", symbol: null, isin: null, amount: 0.05, currency: "EUR", date: "2026-03-02", externalId: "t212:interest:euros" },
      { kind: "interest", symbol: null, isin: null, amount: 0.05, currency: "EUR", date: "2026-03-02", externalId: "t212:interest:dollars" },
    ]);
    // NVIDIA's sale at its average cost of 529.95 / 3.5, and Apple's round trip; Trading 212's leaves out fees.
    expect(result.realized.afterFees).toBeCloseTo(75.9 - 0.5 * (529.95 / 3.5) + 4, 10);
    expect(result.realized.broker).toBeCloseTo(4.55, 10);

    // Imported before: nothing new.
    const saved = new Set([...result.trades.map((entry) => entry.externalId!), ...result.income.map((item) => item.externalId)]);
    const again = await plan(STATEMENT, { ...EMPTY, ids: saved });
    expect(again).toMatchObject({ trades: [], income: [], dividends: 0, interest: 0, duplicates: saved.size });
  });

  it("moves what an earlier import saved, and doesn't look up a ticker it already found", async () => {
    const fetchMock = serve(PROFILES, PRICES);
    vi.stubGlobal("fetch", fetchMock);
    const instruments = new Map([
      [NVIDIA, saved("NVDA", true, [["trading212", 3]])],
      // Held then, sold off now.
      [APPLE, saved("AAPL", true, [["trading212", 1]])],
      // Couldn't be looked up then.
      [IREN, saved(IREN, false, [["trading212", 10]])],
      [VWCE, saved(VWCE, false, [["trading212", 2]])],
    ]);
    const result = await plan(STATEMENT, { ids: new Set(), instruments });
    expect(result.relabels).toEqual([
      { isin: IREN, symbol: "IREN", priced: true, label: null, name: null },
      { isin: APPLE, symbol: APPLE, priced: false, label: "AAPL", name: expect.stringMatching(/^Apple/) },
    ]);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes(NVIDIA))).toBe(false);
  });

  it("keeps a company sold here at its ticker while another broker still holds it", async () => {
    vi.stubGlobal("fetch", serve(PROFILES, PRICES));
    const result = await plan(STATEMENT, { ...EMPTY, instruments: new Map([[APPLE, saved("AAPL", true, [["traderepublic", 2]])]]) });
    expect(result.trades.filter((entry) => entry.isin === APPLE).map((entry) => [entry.symbol, entry.priced])).toEqual([["AAPL", true], ["AAPL", true]]);
    expect(result.relabels).toEqual([]);
  });

  it("finds a listing by a dollar line's code only when it traded near the statement's price", async () => {
    // Finnhub doesn't know NVIDIA's ISIN here, and IREN closed far from the statement's price.
    vi.stubGlobal("fetch", serve({ [TESLA]: PROFILES[TESLA] }, { NVDA: [{ date: "2026-03-03", close: 178 }], IREN: [{ date: "2026-04-01", close: 80 }] }));
    const result = await plan(STATEMENT);
    expect(result.holdings.map((holding) => [holding.symbol, holding.name, holding.priced])).toEqual([
      ["IREN", IREN, false],
      ["NVDA", "NVDA", true],
      ["TSLA", "Tesla Inc", true],
      ["VWCE", VWCE, false],
    ]);
    expect(result.unresolved).toEqual([{ code: "IREN", isin: IREN }, { code: "VWCE", isin: VWCE }]);
  });

  it("tells a holding that couldn't be looked up from one with no US listing", async () => {
    // Tiingo at its hourly limit, and Finnhub at its own for Tesla's ISIN.
    const limited = serve(PROFILES, PRICES);
    vi.stubGlobal("fetch", vi.fn(async (input: URL | string) => {
      const url = new URL(String(input));
      if (url.hostname === "api.tiingo.com") return Response.json({ detail: "Error: You have run over your hourly request allocation." }, { status: 429 });
      if (url.searchParams.get("isin") === TESLA) return Response.json({ error: "API limit reached." }, { status: 429 });
      return limited(input);
    }));
    const result = await plan(STATEMENT);
    expect(result.holdings.filter((holding) => holding.priced).map((holding) => holding.symbol)).toEqual(["NVDA"]);
    expect(result.unchecked).toEqual([{ code: "TSLA", isin: TESLA }, { code: "IREN", isin: IREN }]);
    // A euro fund isn't looked up anywhere, so it's still known to have no US listing.
    expect(result.unresolved).toEqual([{ code: "VWCE", isin: VWCE }]);
  });

  it("takes what the trades add up to when the statement lists no positions", async () => {
    vi.stubGlobal("fetch", serve(PROFILES, PRICES));
    const result = await plan({ ...STATEMENT, positions: [] });
    // Apple was sold off; the rest are held.
    expect(result.holdings.map((holding) => [holding.symbol, holding.shares])).toEqual([["IREN", 10], ["NVDA", 3.5], ["TSLA", 4], ["VWCE", 2]]);
    expect(result.sold).toEqual({ instruments: 1, trades: 2 });
  });

  it("keeps accounts in dollars or euros only", async () => {
    await expect(planImport({ ...STATEMENT, accountCurrency: "GBP" }, EMPTY, NOW)).resolves.toEqual({
      ok: false,
      error: "The Portfolio keeps accounts in dollars or euros, and this one is in GBP.",
    });
  });

  it("works out what's held from the trades when the statement lists no positions, as Trade Republic's", async () => {
    const CSPX = "IE00B5BMR087";
    const QUALCOMM = "US7475251036";
    const trTrade = (date: string, isin: string, name: string, side: "buy" | "sell", shares: number, total: number, orderType = "Market"): StatementTrade => ({
      id: `tr:${date}:${isin}:${side}:${shares}:${total}`,
      time: `${date}T12:00:00Z`,
      code: name,
      isin,
      side,
      shares,
      price: { amount: total / shares, currency: "EUR" },
      accountValue: { amount: side === "buy" ? -total : total, currency: "EUR" },
      result: null,
      orderType,
    });
    const statement: Statement = {
      broker: "traderepublic",
      from: "2026-11-01",
      to: "2026-11-30",
      accountCurrency: "EUR",
      trades: [
        trTrade("2026-11-02", NVIDIA, "NVIDIA CORP.", "buy", 10, 1561.44),
        trTrade("2026-11-03", CSPX, "iShares Core S&P 500 UCITS ETF USD (Acc)", "buy", 0.067899, 50, "Savings plan execution"),
        // Bought before the statement starts.
        trTrade("2026-11-09", QUALCOMM, "QUALCOMM INC.", "sell", 7, 1024.88),
      ],
      positions: [],
      dividends: [],
      interest: [{ id: "tr:interest:2026-11-01:8.17", paidOn: "2026-11-01", kind: "cash", amount: { amount: 8.17, currency: "EUR" } }],
      otherCash: 2,
    };
    vi.stubGlobal("fetch", serve(PROFILES, PRICES));
    const result = await plan(statement);
    expect(result).toMatchObject({ broker: "traderepublic", interest: 1, otherCash: 2, sold: { instruments: 1, trades: 1 } });
    expect(result.holdings.map((holding) => [holding.symbol, holding.shares, holding.priced])).toEqual([
      ["iShares Core S&P 500 UCITS ETF USD (Acc)", 0.067899, false],
      ["NVDA", 10, true],
    ]);
    expect(result.unresolved).toEqual([{ code: "iShares Core S&P 500 UCITS ETF USD (Acc)", isin: CSPX }]);
    expect(result.incomplete).toEqual([{ code: "QUALCOMM INC.", isin: QUALCOMM }]);
    // Trade Republic gives no return of its own.
    expect(result.realized.broker).toBeNull();

    // An earlier Trade Republic statement had the buy: nothing's missing.
    const earlier = await plan(statement, { ...EMPTY, instruments: new Map([[QUALCOMM, saved(QUALCOMM, false, [["traderepublic", 7]])]]) });
    expect(earlier.incomplete).toEqual([]);
  });
});
