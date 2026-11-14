import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AlpacaError,
  fromAlpacaSymbol,
  getAccount,
  parsePortfolioHistory,
  parsePositions,
  submitMarketOrder,
  toAlpacaSymbol,
} from "./alpaca";

beforeEach(() => {
  vi.stubEnv("ALPACA_API_KEY", "key-id");
  vi.stubEnv("ALPACA_SECRET_KEY", "secret");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("parsing", () => {
  it("reads numbers sent as strings, and only long stock positions", () => {
    const positions = parsePositions([
      { symbol: "BRK.B", qty: "2.5", avg_entry_price: "400", market_value: "1100", cost_basis: "1000", current_price: "440", change_today: "0.01", unrealized_pl: "100", unrealized_plpc: "0.1", asset_class: "us_equity" },
      { symbol: "BTCUSD", qty: "1", market_value: "90000", asset_class: "crypto" },
      { symbol: "XYZ", qty: "-3", market_value: "-30" },
    ]);
    expect(positions).toEqual([
      { symbol: "BRK-B", qty: 2.5, avgEntryPrice: 400, marketValue: 1100, costBasis: 1000, currentPrice: 440, changeToday: 0.01, unrealizedPl: 100, unrealizedPlpc: 0.1 },
    ]);
  });

  it("dates daily equity in New York and drops the days before the first deposit", () => {
    // The 9:30 opens of November 9, 10 and 11, 2026 in New York.
    const history = parsePortfolioHistory({ timestamp: [1794234600, 1794321000, 1794407400], equity: [0, 100000, 101250.5] });
    expect(history).toEqual([
      { date: "2026-11-10", equity: 100000 },
      { date: "2026-11-11", equity: 101250.5 },
    ]);
  });

  it("writes share classes Alpaca's way and back", () => {
    expect(toAlpacaSymbol("BRK-B")).toBe("BRK.B");
    expect(fromAlpacaSymbol("BRK.B")).toBe("BRK-B");
    expect(toAlpacaSymbol("NVDA")).toBe("NVDA");
  });
});

describe("requests", () => {
  it("signs requests to the paper endpoint and parses the account", async () => {
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      void input;
      void init;
      return Response.json({ status: "ACTIVE", currency: "USD", cash: "5000.5", equity: "100000", last_equity: "99000", non_marginable_buying_power: "5000.5" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(getAccount()).resolves.toMatchObject({ cash: 5000.5, equity: 100000, lastEquity: 99000, nonMarginableBuyingPower: 5000.5, tradingBlocked: false });
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://paper-api.alpaca.markets/v2/account");
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ "APCA-API-KEY-ID": "key-id", "APCA-API-SECRET-KEY": "secret" });
  });

  it("sends a dollar amount as a market day order, and explains a refusal", async () => {
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      void input;
      void init;
      return Response.json({ id: "o1", client_order_id: "aip-1-BRK-B", symbol: "BRK.B", side: "buy", status: "accepted", filled_qty: "0" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const order = await submitMarketOrder({ symbol: "BRK-B", side: "buy", notional: 1234.567, clientOrderId: "aip-1-BRK-B" });
    expect(order).toMatchObject({ id: "o1", symbol: "BRK-B", status: "accepted", filledQty: 0 });
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({
      symbol: "BRK.B", side: "buy", type: "market", time_in_force: "day", client_order_id: "aip-1-BRK-B", notional: "1234.57",
    });

    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: 40310000, message: "insufficient buying power" }, { status: 403 })));
    const refused = submitMarketOrder({ symbol: "NVDA", side: "buy", qty: 3, clientOrderId: "x" });
    await expect(refused).rejects.toBeInstanceOf(AlpacaError);
    await expect(refused).rejects.toThrow("insufficient buying power");
  });

  it("refuses without keys", async () => {
    vi.stubEnv("ALPACA_SECRET_KEY", "");
    await expect(getAccount()).rejects.toMatchObject({ reason: "not-configured" });
  });
});
