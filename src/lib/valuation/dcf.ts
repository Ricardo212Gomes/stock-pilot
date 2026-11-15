import type { AnnualFinancialSummary } from "@/lib/fmp";
import type { Assumptions } from "./assumptions";

// The discounted cash flow model (see docs/valuation.md): ten years of free cash flow per share and a terminal
// value, discounted at the cost of equity. The cash flow is after interest (operating cash flow less capital
// spending), so it's what's left for shareholders and no debt is subtracted: a simplified FCFE model, as Simply
// Wall St's two-stage model is. Growth holds for the high-growth years, then the part above terminal growth fades.

export const PROJECTION_YEARS = 10;
// After the high-growth years, growth above the terminal rate shrinks by this share each year (Simply Wall St's
// growth curve: 14.8%, 11.2%, 8.6%, 6.9%, 5.6% for Amazon, then 2.7% forever).
export const FADE = 0.3;
// A terminal value above this share of the total leans on the years nobody can forecast; 60–75% is ordinary.
export const TERMINAL_SHARE_WARNING = 0.85;

export type TerminalMethod = "growth" | "multiple";

// The DCF's own choices, beside the shared assumptions: an optional forecast for year 1 (guidance or an analyst
// estimate, per share), and how the terminal value is worked out.
export type DcfOptions = { firstYearFcf: number | null; terminalMethod: TerminalMethod };

export const DEFAULT_DCF_OPTIONS: DcfOptions = { firstYearFcf: null, terminalMethod: "growth" };

export type DcfYear = {
  year: number;
  // "forecast" is a year 1 typed in; "growth" the high-growth years; "fade" the years growth slows.
  stage: "forecast" | "growth" | "fade";
  growth: number | null;
  fcf: number;
  discountFactor: number;
  presentValue: number;
};

export type DcfBreakdown = {
  years: DcfYear[];
  presentValueOfYears: number;
  terminalValue: number;
  presentValueOfTerminal: number;
  value: number;
  terminalShare: number;
  // The cross-checks: the free cash flow multiple the terminal value comes to, and the perpetual growth it
  // amounts to (with an exit multiple, the growth that multiple implies; with perpetual growth, the rate itself).
  impliedMultiple: number;
  impliedGrowth: number;
  // The share of earnings that must be reinvested to grow at the terminal rate: g ÷ ROE (after Damodaran).
  reinvestment: number | null;
};

export type DcfResult = { ok: true; dcf: DcfBreakdown } | { ok: false; reason: string };

// Each projected year's growth: `growth` for the high-growth years, then the excess over `terminalGrowth` shrinking
// by FADE a year. A fall in free cash flow fades up towards the terminal rate the same way.
export function growthPath(growth: number, terminalGrowth: number, highGrowthYears: number): number[] {
  const path: number[] = [];
  let current = growth;
  for (let year = 1; year <= PROJECTION_YEARS; year++) {
    if (year > highGrowthYears) current = terminalGrowth + (current - terminalGrowth) * (1 - FADE);
    path.push(current);
  }
  return path;
}

export function computeDcf(assumptions: Assumptions, options: DcfOptions = DEFAULT_DCF_OPTIONS): DcfResult {
  const base = assumptions.fcfPerShare;
  const { firstYearFcf, terminalMethod } = options;
  if (firstYearFcf !== null && firstYearFcf <= 0) {
    return { ok: false, reason: "The year 1 forecast must be above zero, or left blank to grow today's free cash flow." };
  }
  if (firstYearFcf === null && (base === null || base <= 0)) {
    return { ok: false, reason: "Needs positive free cash flow per share." };
  }
  const r = assumptions.discountRate ?? 0;
  const g = assumptions.terminalGrowth ?? 0;
  const multiple = assumptions.terminalMultiple ?? 0;
  if (r <= 0) return { ok: false, reason: "Needs a discount rate above zero." };
  if (terminalMethod === "growth" && r <= g) {
    return { ok: false, reason: "The discount rate must be higher than terminal growth, or the value would be infinite." };
  }
  if (terminalMethod === "multiple" && multiple <= 0) return { ok: false, reason: "Needs an exit multiple above zero." };

  const path = growthPath(assumptions.growthRate ?? 0, g, assumptions.growthYears ?? 5);
  const highGrowthYears = assumptions.growthYears ?? 5;
  const years: DcfYear[] = [];
  let fcf = base ?? 0;
  for (let year = 1; year <= PROJECTION_YEARS; year++) {
    const forecast = year === 1 && firstYearFcf !== null;
    fcf = forecast ? firstYearFcf : fcf * (1 + path[year - 1]);
    const discountFactor = 1 / (1 + r) ** year;
    years.push({
      year,
      stage: forecast ? "forecast" : year > highGrowthYears ? "fade" : "growth",
      growth: forecast ? null : path[year - 1],
      fcf,
      discountFactor,
      presentValue: fcf * discountFactor,
    });
  }

  const last = years[years.length - 1];
  const terminalValue = terminalMethod === "growth" ? (last.fcf * (1 + g)) / (r - g) : last.fcf * multiple;
  const presentValueOfTerminal = terminalValue * last.discountFactor;
  const presentValueOfYears = years.reduce((total, row) => total + row.presentValue, 0);
  const value = presentValueOfYears + presentValueOfTerminal;
  const impliedMultiple = terminalValue / last.fcf;
  // TV = FCF × M = FCF × (1 + g) ÷ (r − g), so g = (M × r − 1) ÷ (M + 1).
  const impliedGrowth = terminalMethod === "growth" ? g : (impliedMultiple * r - 1) / (impliedMultiple + 1);
  const roe = assumptions.returnOnEquity;
  return {
    ok: true,
    dcf: {
      years,
      presentValueOfYears,
      terminalValue,
      presentValueOfTerminal,
      value,
      terminalShare: presentValueOfTerminal / value,
      impliedMultiple,
      impliedGrowth,
      reinvestment: roe !== null && roe > 0 ? impliedGrowth / roe : null,
    },
  };
}

// --- The starting free cash flow ------------------------------------------------------------------------

// Reported: operating cash flow less capital spending, as filed. Smoothed: less the three-year average capital
// spending instead, so one heavy investment year doesn't move the value (Simply Wall St's adjusted FCF).
export type FcfBasis = "reported" | "smoothed";

export type FcfHistoryRow = {
  fiscalYear: string;
  reported: number | null;
  smoothed: number | null;
  // Stock-based compensation, per share; 0 when the filings show none.
  stockComp: number | null;
};

export type FcfBase = {
  history: FcfHistoryRow[];
  // Cyclical companies use the average across the years shown, to smooth the cycle.
  averageYears: boolean;
};

const SMOOTHING_YEARS = 3;

function perShare(value: number | null, shares: number | null): number | null {
  return value !== null && shares !== null && shares > 0 ? value / shares : null;
}

// Each fiscal year's free cash flow per share both ways, and its stock-based compensation, newest first.
export function fcfHistory(financials: AnnualFinancialSummary[], fallbackShares: number | null): FcfHistoryRow[] {
  return financials.map((row, index) => {
    const shares = row.sharesDiluted ?? fallbackShares;
    const capex = financials.slice(index, index + SMOOTHING_YEARS).map((year) => year.capitalExpenditure).filter((value): value is number => value !== null);
    const averageCapex = capex.length > 0 ? capex.reduce((total, value) => total + Math.abs(value), 0) / capex.length : null;
    return {
      fiscalYear: row.fiscalYear,
      reported: perShare(row.freeCashFlow, shares),
      smoothed: row.operatingCashFlow !== null && averageCapex !== null ? perShare(row.operatingCashFlow - averageCapex, shares) : null,
      stockComp: perShare(row.stockBasedCompensation ?? 0, shares),
    };
  });
}

// The starting free cash flow per share for a basis, with stock-based compensation as a cost or not: the latest
// year's, or the average across the years for cyclicals. Null when there's none.
export function startingFcf(base: FcfBase, basis: FcfBasis, stockCompAsCost: boolean): number | null {
  const values = base.history.flatMap((row) => {
    const fcf = row[basis];
    return fcf === null ? [] : [fcf - (stockCompAsCost ? row.stockComp ?? 0 : 0)];
  });
  if (values.length === 0) return null;
  return base.averageYears && values.length > 1 ? values.reduce((total, value) => total + value, 0) / values.length : values[0];
}

// The latest year's stock-based compensation as a share of its reported free cash flow, for the note beside the
// switch; null without both.
export function stockCompShare(base: FcfBase): number | null {
  const latest = base.history[0];
  return latest && latest.reported !== null && latest.reported > 0 && latest.stockComp !== null ? latest.stockComp / latest.reported : null;
}
