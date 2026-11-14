// Alpaca's Trading API for the AI portfolio's paper account (see docs/ai-portfolio.md). Paper only: the base URL
// is fixed, so a live key can't place real orders from StockPilot. Alpaca sends every number as a string; these
// functions return numbers. Reads are cached briefly for the page; orders and their status never are.

export const ALPACA_PAPER_URL = "https://paper-api.alpaca.markets";

export function isAlpacaConfigured(): boolean {
  return Boolean(process.env.ALPACA_API_KEY && process.env.ALPACA_SECRET_KEY);
}

export type AlpacaFailureReason = "not-configured" | "unauthorized" | "rejected" | "not-found" | "rate-limited" | "unavailable";

export class AlpacaError extends Error {
  constructor(readonly reason: AlpacaFailureReason, message: string, readonly status = 0) {
    super(message);
  }
}

function reasonForStatus(status: number): AlpacaFailureReason {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not-found";
  if (status === 422 || status === 400) return "rejected";
  if (status === 429) return "rate-limited";
  return "unavailable";
}

export function alpacaFailureMessage(reason: AlpacaFailureReason): string {
  switch (reason) {
    case "not-configured":
      return "The paper account isn't connected: set ALPACA_API_KEY and ALPACA_SECRET_KEY (see docs/ai-portfolio.md).";
    case "unauthorized":
      return "Alpaca rejected the keys. Check that they are the paper account's keys.";
    case "rate-limited":
      return "Alpaca's request limit was reached. Try again in a minute.";
    case "not-found":
    case "rejected":
    case "unavailable":
      return "Alpaca didn't answer. Try again in a moment.";
  }
}

// StockPilot writes share classes with a dash (BRK-B), as FMP and Tiingo do; Alpaca with a dot (BRK.B).
export function toAlpacaSymbol(symbol: string): string {
  return symbol.replace("-", ".");
}

export function fromAlpacaSymbol(symbol: string): string {
  return symbol.replace(".", "-");
}

type RequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  query?: Record<string, string>;
  body?: Record<string, unknown>;
  // Seconds Next may cache a read; orders and positions to act on pass nothing.
  revalidate?: number;
};

async function alpacaRequest(path: string, { method = "GET", query, body, revalidate }: RequestOptions = {}): Promise<unknown> {
  const keyId = process.env.ALPACA_API_KEY;
  const secret = process.env.ALPACA_SECRET_KEY;
  if (!keyId || !secret) throw new AlpacaError("not-configured", "ALPACA_API_KEY and ALPACA_SECRET_KEY are not set.");

  const url = new URL(path, ALPACA_PAPER_URL);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        "APCA-API-KEY-ID": keyId,
        "APCA-API-SECRET-KEY": secret,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      ...(method === "GET" && revalidate ? { next: { revalidate } } : { cache: "no-store" as const }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AlpacaError("unavailable", `Alpaca could not be reached (${method} ${path}).`);
  }
  if (!response.ok) {
    // Alpaca explains a refused order in the body, e.g. {"code":40310000,"message":"insufficient buying power"}.
    const detail = await response.text().catch(() => "");
    let message = detail;
    try {
      message = String((JSON.parse(detail) as { message?: unknown }).message ?? detail);
    } catch {
      // Not JSON: keep the text.
    }
    throw new AlpacaError(reasonForStatus(response.status), `Alpaca ${method} ${path} failed with ${response.status}: ${message.slice(0, 300)}`, response.status);
  }
  return response.status === 204 ? null : response.json();
}

type Row = Record<string, unknown>;

function num(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export type AlpacaAccount = {
  status: string;
  currency: string;
  cash: number;
  equity: number;
  // Yesterday's closing equity, for today's change.
  lastEquity: number;
  // What can be bought without borrowing: paper accounts allow margin by default, and the AI portfolio never uses it.
  nonMarginableBuyingPower: number;
  tradingBlocked: boolean;
};

export function parseAccount(payload: unknown): AlpacaAccount {
  const row = (payload ?? {}) as Row;
  const equity = num(row.equity) ?? 0;
  return {
    status: text(row.status) ?? "UNKNOWN",
    currency: text(row.currency) ?? "USD",
    cash: num(row.cash) ?? 0,
    equity,
    lastEquity: num(row.last_equity) ?? equity,
    nonMarginableBuyingPower: num(row.non_marginable_buying_power) ?? num(row.cash) ?? 0,
    tradingBlocked: row.trading_blocked === true || row.account_blocked === true,
  };
}

export async function getAccount(revalidate?: number): Promise<AlpacaAccount> {
  return parseAccount(await alpacaRequest("/v2/account", { revalidate }));
}

export type AlpacaPosition = {
  symbol: string;
  qty: number;
  avgEntryPrice: number;
  marketValue: number;
  costBasis: number;
  currentPrice: number;
  // The day's change as a fraction, from the last close.
  changeToday: number | null;
  unrealizedPl: number;
  unrealizedPlpc: number | null;
};

export function parsePositions(payload: unknown): AlpacaPosition[] {
  return (Array.isArray(payload) ? (payload as Row[]) : []).flatMap((row): AlpacaPosition[] => {
    const alpacaSymbol = text(row.symbol);
    const symbol = alpacaSymbol ? fromAlpacaSymbol(alpacaSymbol) : null;
    const qty = num(row.qty);
    const marketValue = num(row.market_value);
    // Only long stock positions: the AI portfolio never shorts, and this account trades nothing else.
    if (!symbol || qty === null || qty <= 0 || marketValue === null || row.asset_class === "crypto") return [];
    return [{
      symbol,
      qty,
      avgEntryPrice: num(row.avg_entry_price) ?? 0,
      marketValue,
      costBasis: num(row.cost_basis) ?? 0,
      currentPrice: num(row.current_price) ?? marketValue / qty,
      changeToday: num(row.change_today),
      unrealizedPl: num(row.unrealized_pl) ?? 0,
      unrealizedPlpc: num(row.unrealized_plpc),
    }];
  });
}

export async function getPositions(revalidate?: number): Promise<AlpacaPosition[]> {
  return parsePositions(await alpacaRequest("/v2/positions", { revalidate }));
}

export type EquityPoint = { date: string; equity: number };

// Daily closing equity, oldest first, from the first day the account held anything. Days before the first
// deposit come back as 0 and are dropped.
export function parsePortfolioHistory(payload: unknown): EquityPoint[] {
  const row = (payload ?? {}) as Row;
  const timestamps = Array.isArray(row.timestamp) ? row.timestamp : [];
  const equity = Array.isArray(row.equity) ? row.equity : [];
  return timestamps.flatMap((timestamp, index): EquityPoint[] => {
    const seconds = num(timestamp);
    const value = num(equity[index]);
    if (seconds === null || value === null || value <= 0) return [];
    // Daily bars are labelled with the session's start; the New York date is the trading day.
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(seconds * 1000));
    return [{ date, equity: value }];
  });
}

export async function getPortfolioHistory(revalidate?: number): Promise<EquityPoint[]> {
  return parsePortfolioHistory(await alpacaRequest("/v2/account/portfolio/history", { query: { period: "1A", timeframe: "1D" }, revalidate }));
}

export type AlpacaAsset = { symbol: string; tradable: boolean; fractionable: boolean };

export async function getAsset(symbol: string): Promise<AlpacaAsset | null> {
  try {
    const row = (await alpacaRequest(`/v2/assets/${encodeURIComponent(toAlpacaSymbol(symbol))}`, { revalidate: 60 * 60 * 24 })) as Row;
    return { symbol, tradable: row.tradable === true && row.status === "active", fractionable: row.fractionable === true };
  } catch (error) {
    if (error instanceof AlpacaError && error.reason === "not-found") return null;
    throw error;
  }
}

export type AlpacaClock = { isOpen: boolean; nextOpen: string | null; nextClose: string | null };

export async function getClock(): Promise<AlpacaClock> {
  const row = ((await alpacaRequest("/v2/clock")) ?? {}) as Row;
  return { isOpen: row.is_open === true, nextOpen: text(row.next_open), nextClose: text(row.next_close) };
}

export type OrderStatus = string;

export type AlpacaOrder = {
  id: string;
  clientOrderId: string | null;
  symbol: string;
  side: "buy" | "sell";
  status: OrderStatus;
  filledQty: number;
  filledAvgPrice: number | null;
  filledAt: string | null;
};

// Statuses after which an order won't change any more.
export const FINAL_ORDER_STATUSES = new Set(["filled", "canceled", "expired", "rejected", "replaced", "done_for_day", "stopped", "suspended"]);

export function parseOrder(payload: unknown): AlpacaOrder {
  const row = (payload ?? {}) as Row;
  return {
    id: text(row.id) ?? "",
    clientOrderId: text(row.client_order_id),
    symbol: fromAlpacaSymbol(text(row.symbol) ?? ""),
    side: row.side === "sell" ? "sell" : "buy",
    status: text(row.status) ?? "new",
    filledQty: num(row.filled_qty) ?? 0,
    filledAvgPrice: num(row.filled_avg_price),
    filledAt: text(row.filled_at),
  };
}

export type MarketOrder = {
  symbol: string;
  side: "buy" | "sell";
  clientOrderId: string;
} & ({ notional: number } | { qty: number });

// A market order for the day: by dollar amount (fractional shares) or by shares. Alpaca only takes a dollar
// amount on market day orders.
export async function submitMarketOrder(order: MarketOrder): Promise<AlpacaOrder> {
  const size = "notional" in order ? { notional: order.notional.toFixed(2) } : { qty: String(order.qty) };
  return parseOrder(await alpacaRequest("/v2/orders", {
    method: "POST",
    body: { symbol: toAlpacaSymbol(order.symbol), side: order.side, type: "market", time_in_force: "day", client_order_id: order.clientOrderId, ...size },
  }));
}

// Sells the whole position at market.
export async function closePosition(symbol: string): Promise<AlpacaOrder> {
  return parseOrder(await alpacaRequest(`/v2/positions/${encodeURIComponent(toAlpacaSymbol(symbol))}`, { method: "DELETE" }));
}

export async function getOrder(id: string): Promise<AlpacaOrder> {
  return parseOrder(await alpacaRequest(`/v2/orders/${encodeURIComponent(id)}`));
}
