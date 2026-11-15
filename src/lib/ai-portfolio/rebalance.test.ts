import { describe, expect, it, vi } from "vitest";
import type { AlpacaAccount, AlpacaOrder, AlpacaPosition, MarketOrder } from "../alpaca";
import { runRebalance, type RebalanceDeps } from "./rebalance";
import type { Move } from "./rules";
import { candidate } from "./test-helpers";

const UNIVERSE = Array.from({ length: 14 }, (_, index) => `S${String(index).padStart(2, "0")}`);

function account(cash: number, equity = 100_000): AlpacaAccount {
  return { status: "ACTIVE", currency: "USD", cash, equity, lastEquity: equity, nonMarginableBuyingPower: cash, tradingBlocked: false };
}

function position(symbol: string, value: number): AlpacaPosition {
  return { symbol, qty: value / 100, avgEntryPrice: 90, marketValue: value, costBasis: value * 0.9, currentPrice: 100, changeToday: 0, unrealizedPl: value * 0.1, unrealizedPlpc: 0.11 };
}

function reply(positions: { symbol: string; weight: number }[], exits: { symbol: string; reason: string }[] = []) {
  return { ok: true as const, text: JSON.stringify({ summary: "This week's changes.", positions: positions.map((item) => ({ ...item, reason: `Why ${item.symbol}` })), exits }) };
}

// Fakes for everything outside the module, recording what the run asked for.
function setup(overrides: Partial<RebalanceDeps> = {}) {
  const runs: { id: number; status: string; problems: string[] }[] = [];
  const moves: { id: number; runId: number; move: Move; update?: Record<string, unknown> }[] = [];
  const orders: MarketOrder[] = [];
  const closed: string[] = [];
  let nextOrder = 1;
  const order = (symbol: string, side: "buy" | "sell", status = "filled"): AlpacaOrder => ({
    id: `o${nextOrder++}`, clientOrderId: null, symbol, side, status, filledQty: 1, filledAvgPrice: 100, filledAt: "2026-11-16T15:01:00Z",
  });
  const deps: RebalanceDeps = {
    now: () => new Date("2026-11-16T15:00:00Z"),
    clock: async () => ({ isOpen: true, nextOpen: null, nextClose: "2026-11-16T21:00:00Z" }),
    account: vi.fn(async () => account(100_000)),
    positions: async () => [],
    asset: async (symbol) => ({ symbol, tradable: true, fractionable: true }),
    submit: async (request) => {
      orders.push(request);
      return order(request.symbol, request.side);
    },
    close: async (symbol) => {
      closed.push(symbol);
      return order(symbol, "sell");
    },
    order: async (id) => ({ ...order("X", "buy"), id }),
    screen: async () => ({ ok: true, data: { candidates: UNIVERSE.map((symbol) => candidate(symbol)), universe: 100, covered: 100, asOf: "2026-11-13" } }),
    candidate: async (symbol) => candidate(symbol),
    headlines: async () => [],
    filings: async () => [],
    macro: async () => ({ fedFunds: { lower: 3.75, upper: 4, since: "2026-10-29" }, tenYear: null, cpi: null, vix: null, missing: [] }),
    propose: async () => reply(UNIVERSE.slice(0, 12).map((symbol) => ({ symbol, weight: 7.5 }))),
    model: () => "gemini-test",
    store: {
      isWeekDone: async () => false,
      createRun: async (run) => {
        runs.push({ id: runs.length + 1, status: run.status, problems: run.problems });
        return runs.length;
      },
      setRunStatus: async (id, status, problems) => {
        runs[id - 1] = { ...runs[id - 1], status, problems: problems ?? runs[id - 1].problems };
      },
      insertMoves: async (runId, list) => list.map((move) => {
        moves.push({ id: moves.length + 1, runId, move });
        return moves.length;
      }),
      updateMoveOrder: async (id, update) => {
        const row = moves.find((item) => item.id === id);
        if (row) row.update = { ...row.update, ...update };
      },
      listOpenOrders: async () => [],
    },
    sleep: async () => {},
    ...overrides,
  };
  return { deps, runs, moves, orders, closed };
}

describe("runRebalance", () => {
  it("skips a week that's done, and a closed market when trading", async () => {
    const done = setup({ store: { ...setup().deps.store, isWeekDone: async () => true } });
    expect((await runRebalance({ tradingEnabled: true }, done.deps)).status).toBe("skipped");

    const closed = setup({ clock: async () => ({ isOpen: false, nextOpen: "2026-11-17T14:30:00Z", nextClose: null }) });
    const report = await runRebalance({ tradingEnabled: true }, closed.deps);
    expect(report).toEqual({ status: "skipped", lines: ["The market is closed; it opens next at 2026-11-17T14:30:00Z. Nothing was done."] });
    expect(closed.runs).toEqual([]);
  });

  it("records the moves without placing them while trading is off", async () => {
    const { deps, runs, moves, orders } = setup();
    const report = await runRebalance({ tradingEnabled: false }, deps);
    expect(report.status).toBe("recorded");
    expect(runs).toEqual([{ id: 1, status: "recorded", problems: [] }]);
    expect(moves).toHaveLength(12);
    expect(moves.every(({ move }) => move.action === "buy" && move.amount === 7500)).toBe(true);
    expect(orders).toEqual([]);
  });

  // $8,000 in S00 and $20,000 in S13, the rest in cash. The proposal keeps S00 at 7.5% (within 1%: a hold), drops
  // S13 and buys S01–S11 at 7.5% each: $82,500.
  const holdings = async () => [position("S00", 8_000), position("S13", 20_000)];
  const proposal = async () => reply(UNIVERSE.slice(0, 12).map((symbol) => ({ symbol, weight: 7.5 })), [{ symbol: "S13", reason: "Ratings cut." }]);

  it("sells first, waits for the fill, then buys", async () => {
    const calls: string[] = [];
    const { deps, runs, moves, orders, closed } = setup({
      account: vi.fn(async () => account(92_000)).mockResolvedValueOnce(account(72_000)),
      positions: holdings,
      propose: proposal,
    });
    const close = deps.close;
    const submit = deps.submit;
    deps.close = async (symbol) => (calls.push(`close ${symbol}`), close(symbol));
    deps.submit = async (request) => (calls.push(`${request.side} ${request.symbol}`), submit(request));

    const report = await runRebalance({ tradingEnabled: true }, deps);
    expect(report.status).toBe("placed");
    expect(calls[0]).toBe("close S13");
    expect(closed).toEqual(["S13"]);
    expect(orders).toHaveLength(11);
    expect(orders.every((order) => order.side === "buy" && "notional" in order && order.notional === 7500)).toBe(true);
    expect(orders[0].clientOrderId).toBe(`aip-1-${orders[0].symbol}`);
    expect(moves.find(({ move }) => move.symbol === "S00")?.move.action).toBe("hold");
    expect(moves.find(({ move }) => move.symbol === "S13")).toMatchObject({ move: { action: "sell", reason: "Ratings cut." }, update: { orderStatus: "filled" } });
    expect(runs[0]).toEqual({ id: 1, status: "placed", problems: [] });
    expect(report.lines.at(-1)).toBe("Placed 12 orders.");
  });

  it("cuts the buys to the cash after the sales, above the 5% floor", async () => {
    // $60,000 after the sale: $55,000 to spend, so each $7,500 buy becomes $5,000.
    const { deps, orders, moves } = setup({
      account: vi.fn(async () => account(60_000)).mockResolvedValueOnce(account(72_000)),
      positions: holdings,
      propose: proposal,
    });
    const report = await runRebalance({ tradingEnabled: true }, deps);
    expect(orders.map((order) => ("notional" in order ? Math.round(order.notional) : 0))).toEqual(Array(11).fill(5000));
    expect(report.lines).toContain("Buys cut to the $55,000 available after the sales and the cash floor.");
    expect(Math.round(Number(moves.find(({ move }) => move.symbol === "S01")?.update?.amount))).toBe(5000);
  });

  it("rejects a proposal that breaks the rules, and places nothing", async () => {
    const { deps, runs, orders, closed } = setup({
      account: async () => account(50_000),
      positions: async () => [position("S12", 25_000), position("S13", 25_000)],
      // Both holdings dropped: 50% sold in one week.
      propose: async () => reply(UNIVERSE.slice(0, 12).map((symbol) => ({ symbol, weight: 7.5 }))),
    });
    const report = await runRebalance({ tradingEnabled: true }, deps);
    expect(report.status).toBe("rejected");
    expect(runs[0]).toEqual({ id: 1, status: "rejected", problems: ["Sells 50% of the portfolio, where at most 30% a week is allowed."] });
    expect(orders).toEqual([]);
    expect(closed).toEqual([]);
  });

  it("records a failure when Gemini has no usable answer, after one retry", async () => {
    const propose = vi.fn(async () => ({ ok: false as const, error: "Gemini is busy right now. Please try again in a moment." }));
    const { deps, runs } = setup({ propose });
    const report = await runRebalance({}, deps);
    expect(propose).toHaveBeenCalledTimes(2);
    expect(report.status).toBe("failed");
    expect(runs).toEqual([{ id: 1, status: "failed", problems: ["Gemini is busy right now. Please try again in a moment."] }]);
  });

  it("gives Gemini the filings and the market block, with a stored analysis only for holdings", async () => {
    const prompts: string[] = [];
    const filings = vi.fn(async (symbol: string, held: boolean) => [{ form: "8-K", filed: "2026-11-10", description: "Earnings results", ...(held ? { analysis: `${symbol} raised guidance.` } : {}) }]);
    const { deps } = setup({
      positions: async () => [position("S00", 8_000)],
      filings,
      propose: async (prompt) => (prompts.push(prompt), reply(UNIVERSE.slice(0, 12).map((symbol) => ({ symbol, weight: 7.5 })))),
    });
    await runRebalance({ dryRun: true }, deps);
    expect(filings).toHaveBeenCalledWith("S00", true, "2026-11-16");
    expect(filings).toHaveBeenCalledWith("S01", false, "2026-11-16");
    expect(prompts[0]).toMatch(/^Market this week:/);
    expect(prompts[0]).toContain('"analysis":"S00 raised guidance."');
    expect(prompts[0]).not.toContain("S01 raised guidance.");
  });

  it("goes on without filings or macro figures that fail, and says so", async () => {
    const prompts: string[] = [];
    const { deps } = setup({
      filings: async (symbol) => {
        if (symbol === "S02") throw new Error("SEC is down");
        return symbol === "S03" ? null : [];
      },
      macro: async () => { throw new Error("FRED is down"); },
      propose: async (prompt) => (prompts.push(prompt), reply(UNIVERSE.slice(0, 12).map((symbol) => ({ symbol, weight: 7.5 })))),
    });
    const report = await runRebalance({ dryRun: true }, deps);
    expect(report.status).toBe("printed");
    expect(report.lines).toContain("SEC filings couldn't load for 2 of 14 candidates (S02, S03); they go without.");
    expect(report.lines).toContain("Macro figures missing this week: every macro figure.");
    expect(prompts[0]).not.toContain("Market this week");
  });

  it("prints a dry run without storing anything", async () => {
    const { deps, runs } = setup();
    const report = await runRebalance({ dryRun: true, tradingEnabled: true }, deps);
    expect(report.status).toBe("printed");
    expect(report.lines[0]).toBe("This week's changes.");
    expect(report.lines.at(-1)).toBe("Dry run: nothing stored or placed.");
    expect(runs).toEqual([]);
  });
});
