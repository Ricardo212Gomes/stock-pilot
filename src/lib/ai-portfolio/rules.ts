// The AI portfolio's rules (see docs/ai-portfolio.md): what a weekly proposal from Gemini must respect, and how
// its target weights become moves. Everything here is pure, so the checks run the same in tests, in the job and
// on the page. Weights are fractions of the portfolio's value (0.07 is 7%).

export const RULES = {
  minPositions: 10,
  maxPositions: 20,
  maxWeight: 0.1,
  // Kept in cash, so a week's buys never need to borrow.
  minCash: 0.05,
  // At most this share of the portfolio sold or trimmed in a week: buying with cash that was idle isn't churn.
  maxSold: 0.3,
  // Smaller changes to a holding are left alone rather than traded.
  minMove: 0.01,
} as const;

// Within this of a limit still passes: weights come back from the model rounded.
const TOLERANCE = 1e-6;

export type Target = { symbol: string; weight: number; reason: string };
export type Exit = { symbol: string; reason: string };
export type Proposal = { summary: string; targets: Target[]; exits: Exit[] };

// `gain` is since it was bought, as a fraction, when known.
export type Holding = { symbol: string; qty: number; value: number; price: number; gain?: number | null };

export type MoveAction = "buy" | "add" | "hold" | "trim" | "sell";

export type Move = {
  symbol: string;
  action: MoveAction;
  weightBefore: number;
  weightAfter: number;
  // Dollars to buy or sell; 0 for a hold.
  amount: number;
  reason: string;
};

export type Check = { ok: true } | { ok: false; problems: string[] };

function percent(value: number): string {
  return `${(value * 100).toFixed(1).replace(/\.0$/, "")}%`;
}

// What's wrong with a proposal, before any order: the positions, the weights, and tickers outside the candidates.
// `kept` are holdings left as they are because their figures couldn't load: they count towards the positions and
// the invested share.
export function checkProposal(proposal: Proposal, candidates: Set<string>, kept: { count: number; weight: number } = { count: 0, weight: 0 }): Check {
  const problems: string[] = [];
  const { targets } = proposal;
  const positions = targets.length + kept.count;
  if (positions < RULES.minPositions || positions > RULES.maxPositions) {
    problems.push(`${positions} positions, where ${RULES.minPositions}–${RULES.maxPositions} are allowed.`);
  }
  const outside = targets.filter((target) => !candidates.has(target.symbol)).map((target) => target.symbol);
  if (outside.length > 0) problems.push(`Not among the candidates: ${outside.join(", ")}.`);
  const tooLarge = targets.filter((target) => target.weight > RULES.maxWeight + TOLERANCE);
  if (tooLarge.length > 0) {
    problems.push(`Over ${percent(RULES.maxWeight)} of the portfolio: ${tooLarge.map((target) => `${target.symbol} ${percent(target.weight)}`).join(", ")}.`);
  }
  if (targets.some((target) => !(target.weight > 0))) problems.push("Every position needs a weight above zero.");
  const invested = targets.reduce((total, target) => total + target.weight, kept.weight);
  if (invested > 1 - RULES.minCash + TOLERANCE) {
    problems.push(`${percent(invested)} invested, leaving less than ${percent(RULES.minCash)} in cash.`);
  }
  return problems.length === 0 ? { ok: true } : { ok: false, problems };
}

// Every holding becomes a hold, add, trim or sale, and every new target a buy. A holding the proposal leaves out
// is sold, with the exit's reason when it gave one.
export function planMoves(proposal: Proposal, holdings: Holding[], equity: number): Move[] {
  const targets = new Map(proposal.targets.map((target) => [target.symbol, target]));
  const exits = new Map(proposal.exits.map((exit) => [exit.symbol, exit.reason]));
  const moves: Move[] = [];

  for (const holding of holdings) {
    const weightBefore = holding.value / equity;
    const target = targets.get(holding.symbol);
    if (!target) {
      moves.push({
        symbol: holding.symbol,
        action: "sell",
        weightBefore,
        weightAfter: 0,
        amount: holding.value,
        reason: exits.get(holding.symbol) || "Left out of this week's portfolio.",
      });
      continue;
    }
    const change = target.weight * equity - holding.value;
    const action: MoveAction = Math.abs(change) < RULES.minMove * equity ? "hold" : change > 0 ? "add" : "trim";
    moves.push({
      symbol: holding.symbol,
      action,
      weightBefore,
      weightAfter: action === "hold" ? weightBefore : target.weight,
      amount: action === "hold" ? 0 : Math.abs(change),
      reason: target.reason,
    });
  }

  const held = new Set(holdings.map((holding) => holding.symbol));
  for (const target of proposal.targets) {
    if (held.has(target.symbol)) continue;
    moves.push({ symbol: target.symbol, action: "buy", weightBefore: 0, weightAfter: target.weight, amount: target.weight * equity, reason: target.reason });
  }

  // Sales first, as they're placed, then buys from the largest.
  const order: Record<MoveAction, number> = { sell: 0, trim: 1, buy: 2, add: 3, hold: 4 };
  return moves.sort((left, right) => order[left.action] - order[right.action] || right.amount - left.amount);
}

export function soldShare(moves: Move[], equity: number): number {
  return moves.filter((move) => move.action === "sell" || move.action === "trim").reduce((total, move) => total + move.amount, 0) / equity;
}

// The limit on selling, checked on the moves themselves.
export function checkMoves(moves: Move[], equity: number): Check {
  const sold = soldShare(moves, equity);
  return sold > RULES.maxSold + TOLERANCE
    ? { ok: false, problems: [`Sells ${percent(sold)} of the portfolio, where at most ${percent(RULES.maxSold)} a week is allowed.`] }
    : { ok: true };
}

export function isBuy(move: Move): boolean {
  return move.action === "buy" || move.action === "add";
}

// After the sales, buys share what can be spent without borrowing or going under the cash floor: each is cut by
// the same factor when they come to more.
export function fitBuys(moves: Move[], spendable: number): Move[] {
  const wanted = moves.filter(isBuy).reduce((total, move) => total + move.amount, 0);
  if (wanted <= spendable || wanted <= 0) return moves;
  const factor = Math.max(spendable, 0) / wanted;
  return moves.map((move) => (isBuy(move) ? { ...move, amount: move.amount * factor } : move));
}

// The Monday of a New York date's week ("2026-11-18" → "2026-11-16"): one rebalance per week.
export function weekOf(date: string): string {
  const day = new Date(`${date}T12:00:00Z`);
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - sinceMonday);
  return day.toISOString().slice(0, 10);
}

// The next weekly run after a New York date: the following Monday.
export function nextRebalance(date: string): string {
  const monday = new Date(`${weekOf(date)}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() + 7);
  return monday.toISOString().slice(0, 10);
}
