import {
  AlpacaError,
  closePosition,
  FINAL_ORDER_STATUSES,
  getAccount,
  getAsset,
  getClock,
  getOrder,
  getPositions,
  submitMarketOrder,
  type AlpacaAccount,
  type AlpacaAsset,
  type AlpacaClock,
  type AlpacaOrder,
  type AlpacaPosition,
  type MarketOrder,
} from "../alpaca";
import { mapLimit } from "../concurrency";
import { getCompanyNews } from "../finnhub-news";
import { generateGeminiText, geminiModel, type GeminiResult } from "../gemini";
import { listedName } from "../listed-companies";
import { easternToday } from "../market-events";
import { scoreCandidates, type Candidate, type ScoredCandidate } from "../recommendation-signals";
import { getRecommendationScreen, loadCandidate, type RecommendationResult } from "../recommendations";
import { defaultFilingsDeps, loadRecentFilings, type RecentFiling } from "./filings";
import { getMacroFigures, type MacroFigures } from "./macro";
import { buildPortfolioPrompt, parseProposal, PORTFOLIO_INSTRUCTIONS, PORTFOLIO_SCHEMA, type PortfolioCandidate } from "./prompt";
import { checkMoves, checkProposal, fitBuys, isBuy, planMoves, RULES, weekOf, type Holding, type Move, type Proposal } from "./rules";
import * as store from "./store";
import type { RunStatus } from "./store";

// The weekly rebalance (docs/ai-portfolio.md), run by scripts/ai-portfolio.ts on Mondays while the market is open:
// the candidates and their figures, Gemini's proposal, the checks, then the orders, sales first so the buys
// spend cash that's really there. Its dependencies come in as one object, so tests can run it without Alpaca,
// Gemini or a database.

// The screen's best-scoring stocks offered to Gemini, besides the holdings.
export const SCREEN_CANDIDATES = 30;
const HEADLINES_PER_CANDIDATE = 3;
// How long to wait for market orders to fill before moving on; paper market orders fill within seconds.
const FILL_WAIT_MS = 60_000;
const POLL_MS = 2_000;

export type RebalanceDeps = {
  now: () => Date;
  clock: () => Promise<AlpacaClock>;
  account: () => Promise<AlpacaAccount>;
  positions: () => Promise<AlpacaPosition[]>;
  asset: (symbol: string) => Promise<AlpacaAsset | null>;
  submit: (order: MarketOrder) => Promise<AlpacaOrder>;
  close: (symbol: string) => Promise<AlpacaOrder>;
  order: (id: string) => Promise<AlpacaOrder>;
  screen: () => Promise<RecommendationResult>;
  candidate: (symbol: string) => Promise<Candidate | null>;
  headlines: (symbol: string) => Promise<string[]>;
  // The company's SEC filings of the last 30 days (with stored analyses for holdings); null when EDGAR fails.
  filings: (symbol: string, held: boolean, today: string) => Promise<RecentFiling[] | null>;
  macro: () => Promise<MacroFigures>;
  propose: (prompt: string) => Promise<GeminiResult>;
  model: () => string;
  store: Pick<typeof store, "isWeekDone" | "createRun" | "setRunStatus" | "insertMoves" | "updateMoveOrder" | "listOpenOrders">;
  sleep: (ms: number) => Promise<void>;
};

export const defaultDeps: RebalanceDeps = {
  now: () => new Date(),
  clock: getClock,
  account: () => getAccount(),
  positions: () => getPositions(),
  asset: getAsset,
  submit: submitMarketOrder,
  close: closePosition,
  order: getOrder,
  screen: () => getRecommendationScreen(),
  candidate: (symbol) => loadCandidate({ symbol, name: listedName(symbol) ?? symbol, marketCap: null }),
  headlines: async (symbol) => {
    const news = await getCompanyNews(symbol);
    return news.ok ? news.items.slice(0, HEADLINES_PER_CANDIDATE).map((item) => item.title) : [];
  },
  filings: (() => {
    // One spacing for the whole run, so the parallel loads share SEC's per-second limit.
    let filingsDeps: ReturnType<typeof defaultFilingsDeps> | null = null;
    return (symbol: string, held: boolean, today: string) => {
      filingsDeps ??= defaultFilingsDeps();
      return loadRecentFilings(symbol, held, today, filingsDeps);
    };
  })(),
  macro: () => getMacroFigures(),
  propose: (prompt) =>
    generateGeminiText({
      instructions: PORTFOLIO_INSTRUCTIONS,
      prompt,
      generationConfig: { temperature: 0.2, maxOutputTokens: 8000, responseMimeType: "application/json", responseSchema: PORTFOLIO_SCHEMA },
      subject: "portfolio review",
      timeoutMs: 120_000,
    }),
  model: geminiModel,
  store,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

export type RebalanceOptions = {
  // Work out and print the moves; store and place nothing.
  dryRun?: boolean;
  // Place the orders; otherwise the moves are recorded for the page, unplaced (AI_PORTFOLIO_TRADING_ENABLED).
  tradingEnabled?: boolean;
  // Run again in a week that's already done.
  force?: boolean;
};

export type RebalanceReport = { status: RunStatus | "skipped" | "printed"; lines: string[] };

function money(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function share(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function describe(move: Move): string {
  const size = move.action === "hold" ? share(move.weightAfter) : `${money(move.amount)}, ${share(move.weightBefore)} → ${share(move.weightAfter)}`;
  return `${move.action.toUpperCase()} ${move.symbol} (${size}): ${move.reason}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Records the fills of orders still open from earlier runs.
async function syncOpenOrders(deps: RebalanceDeps): Promise<void> {
  const open = await deps.store.listOpenOrders([...FINAL_ORDER_STATUSES]);
  for (const { id, orderId } of open) {
    const order = await deps.order(orderId).catch(() => null);
    if (order) await deps.store.updateMoveOrder(id, fillOf(order));
  }
}

function fillOf(order: AlpacaOrder): store.OrderUpdate {
  return {
    orderId: order.id,
    orderStatus: order.status,
    filledQty: order.filledQty || null,
    filledPrice: order.filledAvgPrice,
    filledAt: order.filledAt,
  };
}

// Waits until every order has a final status, or the time runs out, and returns the latest of each.
async function waitForFills(deps: RebalanceDeps, orders: AlpacaOrder[]): Promise<AlpacaOrder[]> {
  let latest = orders;
  for (let waited = 0; waited < FILL_WAIT_MS && latest.some((order) => !FINAL_ORDER_STATUSES.has(order.status)); waited += POLL_MS) {
    await deps.sleep(POLL_MS);
    latest = await Promise.all(latest.map((order) => (FINAL_ORDER_STATUSES.has(order.status) ? order : deps.order(order.id).catch(() => order))));
  }
  return latest;
}

// The candidates: the screen's best and every holding, with their headlines and recent filings. Holdings whose
// figures can't load are left as they are this week.
async function gatherCandidates(deps: RebalanceDeps, screen: ScoredCandidate[], holdings: Holding[], equity: number, today: string) {
  const scored = new Map(screen.map((candidate) => [candidate.symbol, candidate]));
  const pool = new Map(screen.slice(0, SCREEN_CANDIDATES).map((candidate) => [candidate.symbol, candidate]));
  const kept: Holding[] = [];
  for (const holding of holdings) {
    if (pool.has(holding.symbol)) continue;
    const known = scored.get(holding.symbol);
    const loaded = known ?? (await deps.candidate(holding.symbol).catch(() => null));
    if (loaded) pool.set(holding.symbol, known ?? scoreCandidates([loaded])[0]);
    else kept.push(holding);
  }
  const bySymbol = new Map(holdings.map((holding) => [holding.symbol, holding]));
  const candidates = await mapLimit([...pool.values()], 4, async (candidate): Promise<PortfolioCandidate> => {
    const holding = bySymbol.get(candidate.symbol);
    const [headlines, filings] = await Promise.all([
      deps.headlines(candidate.symbol).catch(() => []),
      deps.filings(candidate.symbol, Boolean(holding), today).catch(() => null),
    ]);
    return {
      ...candidate,
      held: holding ? { weight: holding.value / equity, gain: holding.gain ?? null } : null,
      headlines,
      filings,
    };
  });
  return { candidates, kept };
}

export async function runRebalance(options: RebalanceOptions = {}, deps: RebalanceDeps = defaultDeps): Promise<RebalanceReport> {
  const { dryRun = false, tradingEnabled = false, force = false } = options;
  const lines: string[] = [];
  const today = easternToday(deps.now());
  const week = weekOf(today);

  if (!dryRun) {
    await syncOpenOrders(deps);
    if (!force && (await deps.store.isWeekDone(week))) return { status: "skipped", lines: [`The week of ${week} is already rebalanced.`] };
  }
  if (tradingEnabled && !dryRun) {
    const clock = await deps.clock();
    if (!clock.isOpen) return { status: "skipped", lines: [`The market is closed; it opens next at ${clock.nextOpen ?? "an unknown time"}. Nothing was done.`] };
  }

  const account = await deps.account();
  if (account.tradingBlocked) return { status: "skipped", lines: ["Alpaca has blocked trading on the account. Nothing was done."] };
  const positions = await deps.positions();
  const holdings: Holding[] = positions.map((position) => ({
    symbol: position.symbol,
    qty: position.qty,
    value: position.marketValue,
    price: position.currentPrice,
    gain: position.unrealizedPlpc,
  }));
  const equity = account.equity;

  const record = async (status: RunStatus, summary: string | null, problems: string[], candidates: number | null, moves: Move[] = []) => {
    if (dryRun) return { runId: null, moveIds: [] as number[] };
    const runId = await deps.store.createRun({ week, status, summary, model: deps.model(), problems, equity, cash: account.cash, candidates });
    return { runId, moveIds: moves.length > 0 ? await deps.store.insertMoves(runId, moves) : [] };
  };

  const screen = await deps.screen();
  if (!screen.ok) {
    const problem = `The Recommendations screen couldn't load (${screen.reason}).`;
    await record("failed", null, [problem], null);
    return { status: dryRun ? "printed" : "failed", lines: [problem] };
  }

  const [{ candidates, kept }, macro] = await Promise.all([
    gatherCandidates(deps, scoreCandidates(screen.data.candidates), holdings, equity, today),
    deps.macro().catch((): MacroFigures => ({ fedFunds: null, tenYear: null, cpi: null, vix: null, missing: ["every macro figure"] })),
  ]);
  const keptWeight = kept.reduce((total, holding) => total + holding.value, 0) / equity;
  for (const holding of kept) lines.push(`${holding.symbol}: no figures this week, so it's kept as it is.`);
  // Sources that failed are left out of the prompt, and the run says so.
  const noFilings = candidates.filter((candidate) => candidate.filings === null).map((candidate) => candidate.symbol);
  if (noFilings.length > 0) lines.push(`SEC filings couldn't load for ${noFilings.length} of ${candidates.length} candidates (${noFilings.join(", ")}); they go without.`);
  if (macro.missing.length > 0) lines.push(`Macro figures missing this week: ${macro.missing.join(", ")}.`);
  const allowed = new Set(candidates.map((candidate) => candidate.symbol));

  const prompt = buildPortfolioPrompt({ date: week, equity, cash: account.cash, candidates, macro });
  let proposal: Proposal | null = null;
  let lastError: string | null = null;
  // One retry: a long reply occasionally times out or comes back cut short.
  for (let attempt = 0; attempt < 2 && !proposal; attempt++) {
    const reply = await deps.propose(prompt);
    proposal = reply.ok ? parseProposal(reply.text) : null;
    lastError = reply.ok ? "Gemini's reply wasn't a portfolio." : reply.error;
  }
  if (!proposal) {
    await record("failed", null, [lastError ?? "No reply from Gemini."], candidates.length);
    return { status: dryRun ? "printed" : "failed", lines: [...lines, lastError ?? "No reply from Gemini."] };
  }

  const traded = holdings.filter((holding) => !kept.includes(holding));
  const moves = planMoves(proposal, traded, equity);
  const proposalCheck = checkProposal(proposal, allowed, { count: kept.length, weight: keptWeight });
  const moveCheck = checkMoves(moves, equity);
  const problems = [...(proposalCheck.ok ? [] : proposalCheck.problems), ...(moveCheck.ok ? [] : moveCheck.problems)];
  lines.push(proposal.summary, ...moves.map(describe));
  if (problems.length > 0) {
    await record("rejected", proposal.summary, problems, candidates.length, moves);
    return { status: dryRun ? "printed" : "rejected", lines: [...lines, ...problems.map((problem) => `Rejected: ${problem}`)] };
  }
  if (dryRun) return { status: "printed", lines: [...lines, "Dry run: nothing stored or placed."] };

  const { runId, moveIds } = await record(tradingEnabled ? "placing" : "recorded", proposal.summary, [], candidates.length, moves);
  if (!tradingEnabled || runId === null) return { status: "recorded", lines: [...lines, "Trading is off: the moves are recorded, not placed."] };

  const moveId = new Map(moves.map((move, index) => [move, moveIds[index]]));
  const orderErrors: string[] = [];
  const prices = new Map([
    ...candidates.map((candidate) => [candidate.symbol, candidate.trend.close] as const),
    ...holdings.map((holding) => [holding.symbol, holding.price] as const),
  ]);

  const place = async (move: Move, side: "buy" | "sell", amount: number): Promise<AlpacaOrder | null> => {
    const id = moveId.get(move)!;
    try {
      if (move.action === "sell") return await deps.close(move.symbol);
      const asset = await deps.asset(move.symbol);
      if (!asset?.tradable) throw new Error("Alpaca can't trade it.");
      const clientOrderId = `aip-${runId}-${move.symbol}`;
      if (asset.fractionable) {
        if (amount < 1) throw new Error("Under Alpaca's $1 minimum.");
        return await deps.submit({ symbol: move.symbol, side, notional: amount, clientOrderId });
      }
      const price = prices.get(move.symbol);
      const held = holdings.find((holding) => holding.symbol === move.symbol)?.qty ?? Infinity;
      const qty = price ? Math.min(Math.floor(amount / price), side === "sell" ? Math.floor(held) : Infinity) : 0;
      if (qty < 1) throw new Error("Under one share, and Alpaca doesn't trade it in fractions.");
      return await deps.submit({ symbol: move.symbol, side, qty, clientOrderId });
    } catch (error) {
      const message = error instanceof AlpacaError ? error.message : errorText(error);
      orderErrors.push(`${move.symbol}: ${message}`);
      await deps.store.updateMoveOrder(id, { amount, orderId: null, orderStatus: null, error: message.slice(0, 500) });
      return null;
    }
  };

  // Sales first, then wait for them to fill, so the buys spend the cash they free.
  const sales = moves.filter((move) => move.action === "sell" || move.action === "trim");
  const saleOrders: { move: Move; order: AlpacaOrder }[] = [];
  for (const move of sales) {
    const order = await place(move, "sell", move.amount);
    if (order) saleOrders.push({ move, order });
  }
  const filledSales = await waitForFills(deps, saleOrders.map(({ order }) => order));
  for (const [index, { move }] of saleOrders.entries()) await deps.store.updateMoveOrder(moveId.get(move)!, fillOf(filledSales[index]));

  const after = await deps.account();
  const spendable = Math.max(after.nonMarginableBuyingPower - RULES.minCash * after.equity, 0);
  const fitted = fitBuys(moves, spendable);
  if (fitted.some((move, index) => isBuy(move) && move.amount < moves[index].amount - 0.01)) {
    lines.push(`Buys cut to the ${money(spendable)} available after the sales and the cash floor.`);
  }
  const buyOrders: { move: Move; order: AlpacaOrder; amount: number }[] = [];
  for (const [index, move] of moves.entries()) {
    if (!isBuy(move)) continue;
    const amount = fitted[index].amount;
    const order = await place(move, "buy", amount);
    if (order) buyOrders.push({ move, order, amount });
  }
  const filledBuys = await waitForFills(deps, buyOrders.map(({ order }) => order));
  for (const [index, { move, amount }] of buyOrders.entries()) {
    await deps.store.updateMoveOrder(moveId.get(move)!, { amount, ...fillOf(filledBuys[index]) });
  }

  await deps.store.setRunStatus(runId, "placed", orderErrors);
  const placed = saleOrders.length + buyOrders.length;
  lines.push(`Placed ${placed} order${placed === 1 ? "" : "s"}${orderErrors.length > 0 ? `; ${orderErrors.length} refused` : ""}.`, ...orderErrors);
  return { status: "placed", lines };
}
