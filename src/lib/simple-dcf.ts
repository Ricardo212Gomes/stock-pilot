import type { StatementTable } from "./financial-statements";

// A hands-on two-stage DCF in the style of investor YouTube and quote-site calculators:
// ten years of free cash flow (years 1–5 and 6–10 grow at their own rates), a terminal value,
// then cash added and debt subtracted before dividing by the share count.

export type TerminalMethod = "growth" | "multiple";

export const STAGE_YEARS = 5;
export const PROJECTION_YEARS = STAGE_YEARS * 2;

export type DcfInputs = {
  price: number | null;
  freeCashFlow: number | null;
  shares: number | null;
  cash: number;
  debt: number;
  growthEarly: number;
  growthLate: number;
  discountRate: number;
  terminalMethod: TerminalMethod;
  terminalGrowth: number;
  terminalMultiple: number;
  marginOfSafety: number;
};

export type DcfYear = { year: number; freeCashFlow: number; discountFactor: number; presentValue: number };

export type DcfResult =
  | {
      ok: true;
      years: DcfYear[];
      presentValueOfCashFlows: number;
      terminalValue: number;
      presentValueOfTerminal: number;
      enterpriseValue: number;
      equityValue: number;
      valuePerShare: number;
      terminalShare: number;
      upside: number | null;
      buyBelow: number;
    }
  | { ok: false; reason: string };

export function calculateDcf(inputs: DcfInputs): DcfResult {
  const { freeCashFlow, shares, discountRate } = inputs;
  if (freeCashFlow === null || freeCashFlow <= 0) {
    return {
      ok: false,
      reason: "Needs positive free cash flow. It can be negative when a business is burning cash, or, for banks and insurers, because lending and deposits run through cash flow. For those, use the residual income model on the Intrinsic value tab.",
    };
  }
  if (shares === null || shares <= 0) return { ok: false, reason: "Needs the number of shares outstanding." };
  if (discountRate <= 0) return { ok: false, reason: "Needs a discount rate above zero." };
  if (inputs.terminalMethod === "growth" && discountRate <= inputs.terminalGrowth) {
    return { ok: false, reason: "The discount rate must be higher than terminal growth, or the value would be infinite." };
  }

  let cashFlow = freeCashFlow;
  const years: DcfYear[] = [];
  for (let year = 1; year <= PROJECTION_YEARS; year++) {
    cashFlow *= 1 + (year <= STAGE_YEARS ? inputs.growthEarly : inputs.growthLate);
    const discountFactor = 1 / (1 + discountRate) ** year;
    years.push({ year, freeCashFlow: cashFlow, discountFactor, presentValue: cashFlow * discountFactor });
  }

  const finalCashFlow = years[years.length - 1].freeCashFlow;
  const terminalValue = inputs.terminalMethod === "growth"
    ? (finalCashFlow * (1 + inputs.terminalGrowth)) / (discountRate - inputs.terminalGrowth)
    : finalCashFlow * inputs.terminalMultiple;
  const presentValueOfTerminal = terminalValue * years[years.length - 1].discountFactor;
  const presentValueOfCashFlows = years.reduce((sum, row) => sum + row.presentValue, 0);
  const enterpriseValue = presentValueOfCashFlows + presentValueOfTerminal;
  const equityValue = enterpriseValue + inputs.cash - inputs.debt;
  const valuePerShare = equityValue / shares;

  return {
    ok: true,
    years,
    presentValueOfCashFlows,
    terminalValue,
    presentValueOfTerminal,
    enterpriseValue,
    equityValue,
    valuePerShare,
    terminalShare: presentValueOfTerminal / enterpriseValue,
    upside: inputs.price ? valuePerShare / inputs.price - 1 : null,
    buyBelow: valuePerShare * (1 - inputs.marginOfSafety),
  };
}

export type DcfSensitivity = { discountRates: number[]; growthRates: number[]; values: (number | null)[][] };

// Value per share for discount rates ±2 points against early growth ±4 points.
export function dcfSensitivityGrid(inputs: DcfInputs): DcfSensitivity {
  const discountRates = [-0.02, -0.01, 0, 0.01, 0.02].map((step) => inputs.discountRate + step);
  const growthRates = [-0.04, -0.02, 0, 0.02, 0.04].map((step) => inputs.growthEarly + step);
  return {
    discountRates,
    growthRates,
    values: discountRates.map((discountRate) => growthRates.map((growthEarly) => {
      const result = calculateDcf({ ...inputs, discountRate, growthEarly });
      return result.ok ? result.valuePerShare : null;
    })),
  };
}

export type DcfNoteKey = keyof Omit<DcfInputs, "terminalMethod">;
export type DcfDefaults = { inputs: DcfInputs; notes: Partial<Record<DcfNoteKey, string>>; currency: string };

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function firstValue(table: StatementTable | null, id: string): number | null {
  return table?.rows.find((row) => row.id === id)?.values[0] ?? null;
}

function fiscalCagr(table: StatementTable, id: string): number | null {
  const values = (table.rows.find((row) => row.id === id)?.values ?? [])
    .slice(table.columns[0]?.id === "ttm" ? 1 : 0)
    .filter((value): value is number => value !== null && value > 0);
  if (values.length < 2) return null;
  return (values[0] / values[values.length - 1]) ** (1 / (values.length - 1)) - 1;
}

export function buildDcfDefaults({
  income,
  cashFlow,
  balance,
  price,
}: {
  income: StatementTable;
  cashFlow: StatementTable | null;
  balance: StatementTable | null;
  price: number | null;
}): DcfDefaults {
  const notes: DcfDefaults["notes"] = {};
  const flowLabel = cashFlow?.columns[0]?.label ?? "the latest year";
  const balanceLabel = balance?.columns[0]?.label === "Current" ? "the latest quarter" : balance?.columns[0]?.label ?? "the latest year";

  const freeCashFlow = firstValue(cashFlow, "freeCashFlow");
  notes.freeCashFlow = freeCashFlow !== null
    ? `${flowLabel} free cash flow: operating cash flow minus capital expenditures.`
    : "Free cash flow unavailable. Type it to run the model.";
  const shares = firstValue(income, "shares");
  notes.shares = "Latest diluted share count.";
  const cash = firstValue(balance, "cashAndShortTerm") ?? 0;
  const debt = firstValue(balance, "totalDebt") ?? 0;
  notes.cash = `Cash and short-term investments in ${balanceLabel}.`;
  notes.debt = `Total debt in ${balanceLabel}.`;
  notes.price = price !== null ? "Latest quote." : "No quote available. Type the current price.";

  // Revenue growth is steadier than free cash flow, which swings with investment cycles.
  const revenueGrowth = fiscalCagr(income, "revenue");
  const growthEarly = clamp(revenueGrowth ?? 0.05, 0, 0.25);
  notes.growthEarly = revenueGrowth !== null
    ? `Historical revenue growth (${pct(revenueGrowth)} a year), between 0% and 25%. Revenue is steadier than free cash flow.`
    : "5% placeholder: not enough history.";
  const growthLate = clamp(growthEarly / 2, 0.02, 0.15);
  notes.growthLate = "Half of the first five years' growth (at least 2%): growth slows as companies mature.";

  notes.discountRate = "10%: a common required return for stocks, close to the market's long-run average.";
  notes.terminalGrowth = "2.5%: about long-run inflation plus real economic growth.";
  notes.terminalMultiple = "15× free cash flow: a typical multiple for a mature, steadily growing company.";
  notes.marginOfSafety = "25%: a common cushion against estimates being wrong.";

  return {
    currency: income.currency,
    notes,
    inputs: {
      price,
      freeCashFlow,
      shares,
      cash,
      debt,
      growthEarly,
      growthLate,
      discountRate: 0.1,
      terminalMethod: "growth",
      terminalGrowth: 0.025,
      terminalMultiple: 15,
      marginOfSafety: 0.25,
    },
  };
}
