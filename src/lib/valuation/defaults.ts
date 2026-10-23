import type { AnnualFinancialSummary, CompanyProfile } from "@/lib/fmp";
import { clampAssumption, type AssumptionKey, type Assumptions } from "./assumptions";
import { compoundGrowth, type StockType } from "./classify";

// Damodaran's mature-market implied equity risk premium, January 2026 (4.23%).
export const EQUITY_RISK_PREMIUM = 0.0425;
export const FALLBACK_RISK_FREE_RATE = 0.0425;
// Typical spread of AAA corporate bonds over 10-year Treasuries.
const AAA_SPREAD = 0.0075;

export type AssumptionNotes = Partial<Record<AssumptionKey, string>>;

export type DefaultAssumptions = {
  assumptions: Assumptions;
  notes: AssumptionNotes;
};

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function average(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null;
}

function perShare(value: number | null, shares: number | null): number | null {
  return value !== null && shares !== null && shares > 0 ? value / shares : null;
}

export function sharesOutstanding(
  latest: AnnualFinancialSummary | undefined,
  profile: CompanyProfile | null,
): number | null {
  if (latest?.sharesDiluted && latest.sharesDiluted > 0) return latest.sharesDiluted;
  if (profile?.marketCap && profile.price && profile.price > 0) return profile.marketCap / profile.price;
  return null;
}

export function buildDefaults({
  financials,
  profile,
  riskFreeRate,
  type,
}: {
  financials: AnnualFinancialSummary[];
  profile: CompanyProfile | null;
  riskFreeRate: number | null;
  type: StockType;
}): DefaultAssumptions {
  const latest = financials[0];
  const notes: AssumptionNotes = {};
  const shares = sharesOutstanding(latest, profile);
  const year = latest ? `fiscal ${latest.fiscalYear}` : "the latest year";
  const sharesNote = shares ? "diluted shares" : "shares (unavailable)";

  // Starting values
  const currentPrice = profile?.price ?? null;
  notes.currentPrice = currentPrice !== null
    ? "Latest quote from FMP."
    : "No quote available. Type a price to compare estimates with it.";

  const fcfRows = financials.map((row) => perShare(row.freeCashFlow, row.sharesDiluted ?? shares));
  const normalizeFcf = type === "cyclical" && fcfRows.filter((value) => value !== null).length > 1;
  const fcfPerShare = normalizeFcf ? average(fcfRows) : fcfRows[0] ?? null;
  notes.fcfPerShare = normalizeFcf
    ? `Average free cash flow across ${financials.length} years ÷ ${sharesNote}, to smooth the cycle.`
    : `Free cash flow in ${year} ÷ ${sharesNote}.`;

  const epsPerShare = latest?.eps ?? perShare(latest?.netIncome ?? null, shares);
  notes.epsPerShare = latest?.eps !== null && latest?.eps !== undefined
    ? `Diluted EPS reported for ${year}.`
    : `Net income in ${year} ÷ ${sharesNote}.`;

  const dividendPerShare = latest?.dividendPerShare ?? 0;
  notes.dividendPerShare = latest?.dividendPerShare
    ? `Dividends per share in ${year}.`
    : "No dividend reported.";

  const bookValuePerShare = perShare(latest?.equity ?? null, shares);
  notes.bookValuePerShare = `Shareholders' equity in ${year} ÷ ${sharesNote}.`;

  const revenuePerShare = perShare(latest?.revenue ?? null, shares);
  notes.revenuePerShare = `Revenue in ${year} ÷ ${sharesNote}.`;

  // Risk
  const rf = riskFreeRate ?? FALLBACK_RISK_FREE_RATE;
  const rfNote = riskFreeRate !== null
    ? `${pct(rf)} 10-year Treasury yield`
    : `${pct(rf)} assumed risk-free rate (Treasury yield unavailable)`;
  const beta = profile?.beta !== null && profile?.beta !== undefined
    ? Math.min(Math.max(profile.beta, 0.6), 2.5)
    : 1;
  const discountRate = clampAssumption("discountRate", Math.min(Math.max(rf + beta * EQUITY_RISK_PREMIUM, 0.06), 0.16));
  notes.discountRate = `CAPM: ${rfNote} + beta ${beta.toFixed(2)} × ${pct(EQUITY_RISK_PREMIUM)} equity risk premium.`;

  const bondYield = clampAssumption("bondYield", rf + AAA_SPREAD);
  notes.bondYield = `${rfNote} + ${pct(AAA_SPREAD)} typical AAA spread.`;

  const marginOfSafety = type === "unprofitable" || type === "cyclical" ? 0.35 : 0.25;
  notes.marginOfSafety = type === "unprofitable" || type === "cyclical"
    ? "35%: a wider cushion for less predictable businesses."
    : "25%: a common cushion for established businesses.";

  // Growth
  const years = financials.length;
  const revenueCagr = compoundGrowth(financials.map((row) => row.revenue));
  // Early-stage histories start from tiny revenue, so their growth rate is capped hard.
  const revenueGrowth = clampAssumption("revenueGrowth", Math.min(Math.max(revenueCagr ?? 0.05, -0.1), 0.25));
  notes.revenueGrowth = revenueCagr !== null
    ? `Historical revenue growth over ${years} years (${pct(revenueCagr)}), capped at 25% because high growth rarely lasts.`
    : "5% placeholder: not enough revenue history.";

  // Revenue growth is steadier; EPS growth also captures margin gains and buybacks.
  const epsCagr = compoundGrowth(financials.map((row) => row.eps));
  const growthCap = type === "highGrowth" ? 0.25 : 0.15;
  const blendedGrowth = revenueCagr !== null && epsCagr !== null
    ? (revenueCagr + epsCagr) / 2
    : revenueCagr ?? epsCagr ?? 0.05;
  const growthRate = Math.min(Math.max(blendedGrowth, 0), growthCap);
  notes.growthRate = revenueCagr !== null && epsCagr !== null
    ? `Average of revenue growth (${pct(revenueCagr)}) and EPS growth (${pct(epsCagr)}), capped at ${pct(growthCap)}.`
    : revenueCagr !== null || epsCagr !== null
      ? `Historical ${revenueCagr !== null ? "revenue" : "EPS"} growth (${pct((revenueCagr ?? epsCagr)!)}), capped at ${pct(growthCap)}.`
      : "5% placeholder: not enough history.";

  const dividendCagr = compoundGrowth(financials.map((row) => row.dividendPerShare));
  const dividendGrowth = clampAssumption("dividendGrowth", Math.min(Math.max(dividendCagr ?? growthRate, 0), 0.1));
  notes.dividendGrowth = dividendCagr !== null
    ? `Historical dividend growth (${pct(dividendCagr)}), capped at 10%.`
    : "Matches earnings growth, capped at 10%.";

  const growthYears = type === "highGrowth" || type === "unprofitable" ? 10 : 5;
  notes.growthYears = growthYears === 10
    ? "10 years: growth companies need longer to reach maturity."
    : "5 years: a standard projection length.";

  const terminalGrowth = clampAssumption("terminalGrowth", Math.min(0.025, rf));
  notes.terminalGrowth = "2.5%: about long-run inflation plus real growth, capped at the risk-free rate.";

  // Profitability and exit
  const currentPe = latest?.peRatio ?? null;
  const exitPe = clampAssumption("exitPe", currentPe !== null && currentPe > 0 ? Math.min(Math.max(currentPe, 8), 25) : 15);
  notes.exitPe = currentPe !== null && currentPe > 0
    ? `Last year's P/E (${currentPe.toFixed(1)}×), kept between 8× and 25× because multiples shrink as growth slows.`
    : "15×: about the long-run market average.";

  const payout = epsPerShare && epsPerShare > 0 ? dividendPerShare / epsPerShare : 0;
  const payoutRatio = clampAssumption("payoutRatio", payout);
  notes.payoutRatio = `Dividend per share ÷ EPS in ${year}.`;

  const roeHistory = average(financials.map((row) =>
    row.netIncome !== null && row.equity !== null && row.equity > 0 ? row.netIncome / row.equity : null,
  ));
  const returnOnEquity = clampAssumption("returnOnEquity", roeHistory ?? 0.1);
  notes.returnOnEquity = roeHistory !== null
    ? `Average net income ÷ equity across ${years} years.`
    : "10% placeholder: equity unavailable.";

  const latestMargin = latest?.netMargin ?? null;
  const targetNetMargin = clampAssumption(
    "targetNetMargin",
    latestMargin !== null && latestMargin > 0 ? latestMargin : 0.1,
  );
  notes.targetNetMargin = latestMargin !== null && latestMargin > 0
    ? `Net margin in ${year}.`
    : "10% placeholder: compare with profitable peers in the industry.";

  return {
    assumptions: {
      currentPrice,
      fcfPerShare,
      epsPerShare,
      dividendPerShare,
      bookValuePerShare,
      revenuePerShare,
      discountRate,
      growthRate: clampAssumption("growthRate", growthRate),
      growthYears,
      terminalGrowth,
      revenueGrowth,
      dividendGrowth,
      exitPe,
      payoutRatio,
      returnOnEquity,
      targetNetMargin,
      bondYield,
      marginOfSafety,
    },
    notes,
  };
}
