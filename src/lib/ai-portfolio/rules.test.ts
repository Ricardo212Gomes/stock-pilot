import { describe, expect, it } from "vitest";
import { checkMoves, checkProposal, fitBuys, nextRebalance, planMoves, soldShare, weekOf, type Proposal, type Target } from "./rules";

function targets(count: number, weight: number, prefix = "S"): Target[] {
  return Array.from({ length: count }, (_, index) => ({ symbol: `${prefix}${index}`, weight, reason: `Why ${index}` }));
}

describe("checkProposal", () => {
  const candidates = new Set(targets(25, 0).map((target) => target.symbol));

  it("passes 10–20 positions of at most 10% with 5% in cash", () => {
    expect(checkProposal({ summary: "", targets: targets(12, 0.075), exits: [] }, candidates)).toEqual({ ok: true });
    expect(checkProposal({ summary: "", targets: targets(10, 0.095), exits: [] }, candidates)).toEqual({ ok: true });
  });

  it("names every broken rule", () => {
    const check = checkProposal({ summary: "", targets: [...targets(8, 0.12), { symbol: "ZZZ", weight: 0.05, reason: "" }], exits: [] }, candidates);
    expect(check.ok).toBe(false);
    expect(!check.ok && check.problems).toEqual([
      "9 positions, where 10–20 are allowed.",
      "Not among the candidates: ZZZ.",
      "Over 10% of the portfolio: S0 12%, S1 12%, S2 12%, S3 12%, S4 12%, S5 12%, S6 12%, S7 12%.",
      "101% invested, leaving less than 5% in cash.",
    ]);
  });

  it("counts holdings kept as they are", () => {
    const check = checkProposal({ summary: "", targets: targets(9, 0.09), exits: [] }, candidates, { count: 1, weight: 0.2 });
    expect(!check.ok && check.problems).toEqual(["101% invested, leaving less than 5% in cash."]);
  });
});

describe("planMoves", () => {
  const holdings = [
    { symbol: "AAA", qty: 10, value: 8000, price: 800 },
    { symbol: "BBB", qty: 5, value: 5000, price: 1000 },
    { symbol: "CCC", qty: 1, value: 3000, price: 3000 },
  ];
  const proposal: Proposal = {
    summary: "",
    targets: [
      { symbol: "AAA", weight: 0.085, reason: "Still cheap" },
      { symbol: "BBB", weight: 0.02, reason: "Taking profits" },
      { symbol: "DDD", weight: 0.06, reason: "New idea" },
    ],
    exits: [],
  };

  it("holds small changes, trims, sells what's left out and buys the new, sales first", () => {
    const moves = planMoves(proposal, holdings, 100_000);
    expect(moves.map((move) => [move.action, move.symbol, Math.round(move.amount)])).toEqual([
      ["sell", "CCC", 3000],
      ["trim", "BBB", 3000],
      ["buy", "DDD", 6000],
      ["hold", "AAA", 0],
    ]);
    expect(moves[0].reason).toBe("Left out of this week's portfolio.");
    expect(moves[3]).toMatchObject({ weightBefore: 0.08, weightAfter: 0.08 });
    expect(soldShare(moves, 100_000)).toBeCloseTo(0.06);
  });

  it("uses an exit's reason, and refuses selling over 30% in a week", () => {
    const moves = planMoves({ ...proposal, exits: [{ symbol: "CCC", reason: "Guidance cut" }] }, holdings, 100_000);
    expect(moves[0].reason).toBe("Guidance cut");
    expect(checkMoves(moves, 100_000)).toEqual({ ok: true });
    expect(checkMoves(moves, 15_000).ok).toBe(false);
  });
});

describe("fitBuys", () => {
  it("cuts every buy by the same factor when the cash falls short", () => {
    const moves = planMoves({ summary: "", targets: [{ symbol: "A", weight: 0.06, reason: "" }, { symbol: "B", weight: 0.04, reason: "" }], exits: [] }, [], 100_000);
    expect(fitBuys(moves, 5000).map((move) => move.amount)).toEqual([3000, 2000]);
    expect(fitBuys(moves, 20_000)).toBe(moves);
  });
});

describe("weeks", () => {
  it("finds the Monday of the week and the next one", () => {
    expect(weekOf("2026-11-18")).toBe("2026-11-16");
    expect(weekOf("2026-11-16")).toBe("2026-11-16");
    expect(weekOf("2026-11-22")).toBe("2026-11-16");
    expect(nextRebalance("2026-11-16")).toBe("2026-11-23");
    expect(nextRebalance("2026-12-31")).toBe("2027-01-04");
  });
});
