import { getSql } from "../db";
import type { Move, MoveAction } from "./rules";

// The AI portfolio's runs and moves in Postgres (db/schema.sql). The page reads them; only the weekly job writes.

export type RunStatus = "placing" | "placed" | "recorded" | "rejected" | "failed";

export type StoredMove = Move & {
  id: number;
  orderId: string | null;
  orderStatus: string | null;
  filledQty: number | null;
  filledPrice: number | null;
  filledAt: string | null;
  error: string | null;
};

export type StoredRun = {
  id: number;
  week: string;
  status: RunStatus;
  summary: string | null;
  model: string | null;
  problems: string[];
  equity: number | null;
  cash: number | null;
  candidates: number | null;
  createdAt: string;
  moves: StoredMove[];
};

export type OrderUpdate = {
  // A buy cut to fit the cash after the sales.
  amount?: number;
  orderId: string | null;
  orderStatus: string | null;
  filledQty?: number | null;
  filledPrice?: number | null;
  filledAt?: string | null;
  error?: string | null;
};

const number = (value: string | number | null): number | null => (value === null ? null : Number(value));

// Whether this week's rebalance has happened: placed, or recorded with trading off.
export async function isWeekDone(week: string): Promise<boolean> {
  const rows = await getSql()`select 1 from ai_portfolio_runs where week = ${week} and status in ('placed', 'recorded') limit 1`;
  return rows.length > 0;
}

export async function createRun(run: {
  week: string;
  status: RunStatus;
  summary: string | null;
  model: string | null;
  problems: string[];
  equity: number | null;
  cash: number | null;
  candidates: number | null;
}): Promise<number> {
  const sql = getSql();
  const [row] = await sql<{ id: string }[]>`
    insert into ai_portfolio_runs (week, status, summary, model, problems, equity, cash, candidates)
    values (${run.week}, ${run.status}, ${run.summary}, ${run.model}, ${sql.json(run.problems)}, ${run.equity}, ${run.cash}, ${run.candidates})
    returning id
  `;
  return Number(row.id);
}

export async function setRunStatus(id: number, status: RunStatus, problems?: string[]): Promise<void> {
  const sql = getSql();
  if (problems) await sql`update ai_portfolio_runs set status = ${status}, problems = ${sql.json(problems)} where id = ${id}`;
  else await sql`update ai_portfolio_runs set status = ${status} where id = ${id}`;
}

// The moves in the order given, each with its id for the order updates.
export async function insertMoves(runId: number, moves: Move[]): Promise<number[]> {
  const sql = getSql();
  const ids: number[] = [];
  for (const move of moves) {
    const [row] = await sql<{ id: string }[]>`
      insert into ai_portfolio_moves (run_id, symbol, action, weight_before, weight_after, amount, reason)
      values (${runId}, ${move.symbol}, ${move.action}, ${move.weightBefore}, ${move.weightAfter}, ${move.amount}, ${move.reason})
      returning id
    `;
    ids.push(Number(row.id));
  }
  return ids;
}

export async function updateMoveOrder(id: number, update: OrderUpdate): Promise<void> {
  await getSql()`
    update ai_portfolio_moves set
      amount = coalesce(${update.amount ?? null}, amount),
      order_id = ${update.orderId},
      order_status = ${update.orderStatus},
      filled_qty = ${update.filledQty ?? null},
      filled_price = ${update.filledPrice ?? null},
      filled_at = ${update.filledAt ?? null},
      error = ${update.error ?? null}
    where id = ${id}
  `;
}

// Orders whose fill wasn't known when they were recorded.
export async function listOpenOrders(finalStatuses: string[]): Promise<{ id: number; orderId: string }[]> {
  const rows = await getSql()<{ id: string; order_id: string }[]>`
    select id, order_id from ai_portfolio_moves
    where order_id is not null and (order_status is null or not (order_status = any(${finalStatuses}::text[])))
  `;
  return rows.map((row) => ({ id: Number(row.id), orderId: row.order_id }));
}

type RunRow = {
  id: string;
  week: Date;
  status: RunStatus;
  summary: string | null;
  model: string | null;
  problems: string[] | null;
  equity: string | null;
  cash: string | null;
  candidates: number | null;
  created_at: Date;
};

type MoveRow = {
  id: string;
  run_id: string;
  symbol: string;
  action: MoveAction;
  weight_before: string;
  weight_after: string;
  amount: string;
  reason: string;
  order_id: string | null;
  order_status: string | null;
  filled_qty: string | null;
  filled_price: string | null;
  filled_at: Date | null;
  error: string | null;
};

// The latest runs, newest first, each with its moves in the order they were planned.
export async function listRuns(limit = 12): Promise<StoredRun[]> {
  const sql = getSql();
  const runs = await sql<RunRow[]>`select * from ai_portfolio_runs order by created_at desc limit ${limit}`;
  if (runs.length === 0) return [];
  const moves = await sql<MoveRow[]>`
    select * from ai_portfolio_moves where run_id = any(${runs.map((run) => run.id)}::bigint[]) order by id
  `;
  return runs.map((run) => ({
    id: Number(run.id),
    week: run.week.toISOString().slice(0, 10),
    status: run.status,
    summary: run.summary,
    model: run.model,
    problems: run.problems ?? [],
    equity: number(run.equity),
    cash: number(run.cash),
    candidates: run.candidates,
    createdAt: run.created_at.toISOString(),
    moves: moves.filter((move) => move.run_id === run.id).map((move) => ({
      id: Number(move.id),
      symbol: move.symbol,
      action: move.action,
      weightBefore: Number(move.weight_before),
      weightAfter: Number(move.weight_after),
      amount: Number(move.amount),
      reason: move.reason,
      orderId: move.order_id,
      orderStatus: move.order_status,
      filledQty: number(move.filled_qty),
      filledPrice: number(move.filled_price),
      filledAt: move.filled_at?.toISOString() ?? null,
      error: move.error,
    })),
  }));
}
