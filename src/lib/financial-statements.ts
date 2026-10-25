import { fetchFinnhub, finnhubSymbol } from "./finnhub";
import { FMP_BASE_URL, canUseFallback, failureReason, fetchFmp, numeric, type FmpFailureReason, type StatementSource } from "./fmp";
import { getSecStatements } from "./sec";

const STATEMENT_REVALIDATE_SECONDS = 60 * 60 * 24;
// The free FMP plan returns at most 5 rows per request.
const PERIOD_LIMIT = "5";
const TTM_QUARTERS = 4;

export type StatementId = "income" | "balance" | "cash-flow" | "ratios";
export type StatementPeriod = "annual" | "quarterly";
export type ValueFormat = "money" | "perShare" | "percent" | "growth" | "shares" | "ratio";

export const STATEMENTS: { id: StatementId; label: string; title: string }[] = [
  { id: "income", label: "Income Statement", title: "Income Statement" },
  { id: "balance", label: "Balance Sheet", title: "Balance Sheet" },
  { id: "cash-flow", label: "Cash Flow", title: "Cash Flow Statement" },
  { id: "ratios", label: "Ratios", title: "Ratios" },
];

export function isStatementId(value: unknown): value is StatementId {
  return STATEMENTS.some((statement) => statement.id === value);
}

type Row = Record<string, unknown>;

export type StatementColumn = {
  id: string;
  label: string;
  periodEnding: string | null;
  isTtm: boolean;
  // 4 for a single quarter, so ratios of a flow to a balance (ROE, turnover) read as yearly rates.
  annualize: number;
  income: Row | null;
  balance: Row | null;
  cash: Row | null;
  ratios: Row | null;
};

type LineItem = {
  id: string;
  label: string;
  format: ValueFormat;
  value: (column: StatementColumn, yearAgo: StatementColumn | null) => number | null;
  emphasis?: boolean;
  section?: string;
  help?: string;
};

export type StatementRow = {
  id: string;
  label: string;
  format: ValueFormat;
  emphasis: boolean;
  section: string | null;
  help: string | null;
  values: (number | null)[];
};

export type ChartSeries = { id: string; label: string; format: ValueFormat; values: (number | null)[] };

export type StatementTable = {
  statement: StatementId;
  period: StatementPeriod;
  source: StatementSource;
  currency: string;
  fiscalYear: string | null;
  columns: { id: string; label: string; periodEnding: string | null }[];
  rows: StatementRow[];
  // Labels and series values run oldest to newest, with TTM last.
  chart: { title: string; labels: string[]; series: ChartSeries[]; defaults: string[] };
};

export type StatementResult =
  | { ok: true; data: StatementTable }
  | { ok: false; reason: FmpFailureReason };

function num(value: unknown): number | null {
  return numeric(typeof value === "number" ? value : null);
}

function field(row: Row | null, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = num(row?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function divide(numerator: number | null, denominator: number | null): number | null {
  return numerator === null || denominator === null || denominator === 0 ? null : numerator / denominator;
}

// A quarter's flow at a yearly rate, for comparing it with a balance-sheet level.
function yearly(value: number | null, column: StatementColumn): number | null {
  return value === null ? null : value * column.annualize;
}

// 1 / x for a positive ratio, such as earnings yield from P/E.
function inverse(value: number | null): number | null {
  return value === null || value <= 0 ? null : 1 / value;
}

function addUp(...values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((total, value) => total + value, 0) : null;
}

// Growth is only meaningful from a positive base.
function growth(current: number | null, previous: number | null): number | null {
  return current === null || previous === null || previous <= 0 ? null : current / previous - 1;
}

const inc = (key: string, ...fallbacks: string[]) => (column: StatementColumn) => field(column.income, key, ...fallbacks);
const bal = (key: string, ...fallbacks: string[]) => (column: StatementColumn) => field(column.balance, key, ...fallbacks);
const cf = (key: string, ...fallbacks: string[]) => (column: StatementColumn) => field(column.cash, key, ...fallbacks);
const ratio = (key: string) => (column: StatementColumn) => field(column.ratios, key);
const yoy = (get: (column: StatementColumn) => number | null) =>
  (column: StatementColumn, yearAgo: StatementColumn | null) => (yearAgo ? growth(get(column), get(yearAgo)) : null);

const revenue = inc("revenue");
const netIncome = inc("netIncome");
const eps = inc("epsDiluted", "eps");
const shares = inc("weightedAverageShsOutDil", "weightedAverageShsOut");
const operatingCashFlow = cf("operatingCashFlow", "netCashProvidedByOperatingActivities");
const freeCashFlow = cf("freeCashFlow");
const equity = bal("totalStockholdersEquity", "totalEquity");
const cashAndShortTerm = bal("cashAndShortTermInvestments", "cashAndCashEquivalents");
const totalDebt = bal("totalDebt");

const LINE_ITEMS: Record<StatementId, LineItem[]> = {
  income: [
    { id: "revenue", label: "Revenue", format: "money", value: revenue, emphasis: true },
    { id: "revenueGrowth", label: "Revenue Growth (YoY)", format: "growth", value: yoy(revenue) },
    { id: "costOfRevenue", label: "Cost of Revenue", format: "money", value: inc("costOfRevenue") },
    { id: "grossProfit", label: "Gross Profit", format: "money", value: inc("grossProfit"), emphasis: true },
    { id: "research", label: "Research & Development", format: "money", value: inc("researchAndDevelopmentExpenses") },
    { id: "sga", label: "Selling, General & Admin", format: "money", value: inc("sellingGeneralAndAdministrativeExpenses") },
    { id: "operatingExpenses", label: "Operating Expenses", format: "money", value: inc("operatingExpenses") },
    { id: "operatingIncome", label: "Operating Income", format: "money", value: inc("operatingIncome"), emphasis: true },
    { id: "interestExpense", label: "Interest Expense", format: "money", value: inc("interestExpense") },
    { id: "pretaxIncome", label: "Pretax Income", format: "money", value: inc("incomeBeforeTax") },
    { id: "incomeTax", label: "Income Tax", format: "money", value: inc("incomeTaxExpense") },
    { id: "netIncome", label: "Net Income", format: "money", value: netIncome, emphasis: true },
    { id: "netIncomeGrowth", label: "Net Income Growth", format: "growth", value: yoy(netIncome) },
    { id: "shares", label: "Shares Outstanding (Diluted)", format: "shares", value: shares },
    { id: "eps", label: "EPS (Diluted)", format: "perShare", value: eps, emphasis: true },
    { id: "epsGrowth", label: "EPS Growth", format: "growth", value: yoy(eps) },
    { id: "grossMargin", label: "Gross Margin", format: "percent", value: (c) => divide(inc("grossProfit")(c), revenue(c)) },
    { id: "operatingMargin", label: "Operating Margin", format: "percent", value: (c) => divide(inc("operatingIncome")(c), revenue(c)) },
    { id: "profitMargin", label: "Profit Margin", format: "percent", value: (c) => divide(netIncome(c), revenue(c)) },
    { id: "ebitda", label: "EBITDA", format: "money", value: inc("ebitda"), help: "Earnings before interest, taxes, depreciation and amortization." },
    { id: "ebit", label: "EBIT", format: "money", value: inc("ebit"), help: "Earnings before interest and taxes." },
  ],
  balance: [
    { id: "cash", label: "Cash & Equivalents", format: "money", value: bal("cashAndCashEquivalents") },
    { id: "shortTermInvestments", label: "Short-Term Investments", format: "money", value: bal("shortTermInvestments") },
    { id: "cashAndShortTerm", label: "Cash & Short-Term Investments", format: "money", value: cashAndShortTerm, emphasis: true },
    { id: "receivables", label: "Receivables", format: "money", value: bal("netReceivables") },
    { id: "inventory", label: "Inventory", format: "money", value: bal("inventory") },
    { id: "currentAssets", label: "Total Current Assets", format: "money", value: bal("totalCurrentAssets"), emphasis: true },
    { id: "ppe", label: "Property, Plant & Equipment", format: "money", value: bal("propertyPlantEquipmentNet") },
    { id: "goodwill", label: "Goodwill & Intangibles", format: "money", value: bal("goodwillAndIntangibleAssets") },
    { id: "longTermInvestments", label: "Long-Term Investments", format: "money", value: bal("longTermInvestments") },
    { id: "totalAssets", label: "Total Assets", format: "money", value: bal("totalAssets"), emphasis: true },
    { id: "payables", label: "Accounts Payable", format: "money", value: bal("accountPayables") },
    { id: "shortTermDebt", label: "Short-Term Debt", format: "money", value: bal("shortTermDebt") },
    { id: "currentLiabilities", label: "Total Current Liabilities", format: "money", value: bal("totalCurrentLiabilities"), emphasis: true },
    { id: "longTermDebt", label: "Long-Term Debt", format: "money", value: bal("longTermDebt") },
    { id: "totalLiabilities", label: "Total Liabilities", format: "money", value: bal("totalLiabilities"), emphasis: true },
    { id: "totalDebt", label: "Total Debt", format: "money", value: totalDebt },
    { id: "equity", label: "Shareholders' Equity", format: "money", value: equity, emphasis: true },
    {
      id: "netCash", label: "Net Cash (Debt)", format: "money",
      value: (c) => (cashAndShortTerm(c) !== null && totalDebt(c) !== null ? cashAndShortTerm(c)! - totalDebt(c)! : null),
      help: "Cash and short-term investments minus total debt. Negative means more debt than cash.",
    },
    { id: "bookValuePerShare", label: "Book Value Per Share", format: "perShare", value: (c) => divide(equity(c), shares(c)) },
  ],
  "cash-flow": [
    { id: "netIncome", label: "Net Income", format: "money", value: cf("netIncome") },
    { id: "depreciation", label: "Depreciation & Amortization", format: "money", value: cf("depreciationAndAmortization") },
    { id: "stockComp", label: "Stock-Based Compensation", format: "money", value: cf("stockBasedCompensation") },
    { id: "workingCapital", label: "Change in Working Capital", format: "money", value: cf("changeInWorkingCapital") },
    { id: "operatingCashFlow", label: "Operating Cash Flow", format: "money", value: operatingCashFlow, emphasis: true },
    { id: "operatingCashFlowGrowth", label: "Operating Cash Flow Growth", format: "growth", value: yoy(operatingCashFlow) },
    { id: "capex", label: "Capital Expenditures", format: "money", value: cf("capitalExpenditure", "investmentsInPropertyPlantAndEquipment") },
    { id: "acquisitions", label: "Acquisitions", format: "money", value: cf("acquisitionsNet") },
    { id: "investingCashFlow", label: "Investing Cash Flow", format: "money", value: cf("netCashProvidedByInvestingActivities"), emphasis: true },
    { id: "dividends", label: "Dividends Paid", format: "money", value: cf("commonDividendsPaid", "netDividendsPaid") },
    { id: "buybacks", label: "Share Repurchases", format: "money", value: cf("commonStockRepurchased") },
    { id: "debtIssued", label: "Net Debt Issued (Repaid)", format: "money", value: cf("netDebtIssuance") },
    { id: "financingCashFlow", label: "Financing Cash Flow", format: "money", value: cf("netCashProvidedByFinancingActivities"), emphasis: true },
    {
      id: "freeCashFlow", label: "Free Cash Flow", format: "money", value: freeCashFlow, emphasis: true,
      help: "Operating cash flow minus capital expenditures: cash the business could return to shareholders.",
    },
    { id: "freeCashFlowGrowth", label: "Free Cash Flow Growth", format: "growth", value: yoy(freeCashFlow) },
    { id: "freeCashFlowMargin", label: "Free Cash Flow Margin", format: "percent", value: (c) => divide(freeCashFlow(c), revenue(c)) },
    { id: "freeCashFlowPerShare", label: "Free Cash Flow Per Share", format: "perShare", value: (c) => divide(freeCashFlow(c), shares(c)) },
  ],
  // FMP's ratios and key metrics when it has them; otherwise worked out from the statements, so
  // quarterly views and companies whose statements come from the SEC still get most rows.
  ratios: [
    { id: "marketCap", label: "Market Capitalization", format: "money", value: ratio("marketCap"), section: "Valuation", help: "Share price times shares outstanding, at the end of the period." },
    { id: "enterpriseValue", label: "Enterprise Value", format: "money", value: ratio("enterpriseValue"), help: "Market cap plus debt minus cash: what buying the whole business would cost." },
    { id: "pe", label: "PE Ratio", format: "ratio", value: ratio("priceToEarningsRatio"), help: "Price divided by earnings per share." },
    { id: "peg", label: "PEG Ratio", format: "ratio", value: ratio("priceToEarningsGrowthRatio"), help: "P/E divided by earnings growth. Around 1 or below can mean the growth is fairly priced." },
    { id: "ps", label: "PS Ratio", format: "ratio", value: ratio("priceToSalesRatio"), help: "Price divided by revenue per share." },
    { id: "pb", label: "PB Ratio", format: "ratio", value: ratio("priceToBookRatio"), help: "Price divided by book value per share." },
    { id: "pfcf", label: "P/FCF Ratio", format: "ratio", value: ratio("priceToFreeCashFlowRatio"), help: "Price divided by free cash flow per share." },
    { id: "pocf", label: "P/OCF Ratio", format: "ratio", value: ratio("priceToOperatingCashFlowRatio"), help: "Price divided by operating cash flow per share." },
    { id: "evSales", label: "EV / Sales", format: "ratio", value: ratio("evToSales"), help: "Enterprise value divided by revenue." },
    { id: "evEbitda", label: "EV / EBITDA", format: "ratio", value: (c) => field(c.ratios, "evToEBITDA", "enterpriseValueMultiple"), help: "Enterprise value divided by EBITDA. Unlike P/E, it isn't affected by how the company is financed." },
    { id: "evFcf", label: "EV / FCF", format: "ratio", value: ratio("evToFreeCashFlow"), help: "Enterprise value divided by free cash flow." },
    {
      id: "earningsYield", label: "Earnings Yield", format: "percent", section: "Yields",
      value: (c) => field(c.ratios, "earningsYield") ?? inverse(ratio("priceToEarningsRatio")(c)),
      help: "Earnings per share divided by price: the inverse of P/E.",
    },
    {
      id: "fcfYield", label: "FCF Yield", format: "percent",
      value: (c) => field(c.ratios, "freeCashFlowYield") ?? inverse(ratio("priceToFreeCashFlowRatio")(c)),
      help: "Free cash flow per share divided by price.",
    },
    { id: "dividendYield", label: "Dividend Yield", format: "percent", value: ratio("dividendYield") },
    { id: "payoutRatio", label: "Payout Ratio", format: "percent", value: (c) => {
      const reported = field(c.ratios, "dividendPayoutRatio");
      if (reported !== null) return reported;
      const paid = cf("commonDividendsPaid", "netDividendsPaid")(c);
      return paid === null ? null : divide(Math.abs(paid), netIncome(c));
    }, help: "Dividends paid as a share of net income." },
    {
      id: "roe", label: "Return on Equity (ROE)", format: "percent", section: "Returns",
      value: (c) => field(c.ratios, "returnOnEquity") ?? divide(yearly(netIncome(c), c), equity(c)),
      help: "Net income divided by shareholders' equity.",
    },
    {
      id: "roa", label: "Return on Assets (ROA)", format: "percent",
      value: (c) => field(c.ratios, "returnOnAssets") ?? divide(yearly(netIncome(c), c), bal("totalAssets")(c)),
      help: "Net income divided by total assets.",
    },
    {
      id: "roic", label: "Return on Invested Capital (ROIC)", format: "percent", value: ratio("returnOnInvestedCapital"),
      help: "After-tax operating profit divided by the debt and equity invested in the business.",
    },
    {
      id: "currentRatio", label: "Current Ratio", format: "ratio", section: "Financial health",
      value: (c) => field(c.ratios, "currentRatio") ?? divide(bal("totalCurrentAssets")(c), bal("totalCurrentLiabilities")(c)),
      help: "Current assets divided by current liabilities. Above 1 means short-term bills are covered.",
    },
    {
      id: "quickRatio", label: "Quick Ratio", format: "ratio",
      value: (c) => field(c.ratios, "quickRatio") ?? divide(addUp(cashAndShortTerm(c), bal("netReceivables")(c)), bal("totalCurrentLiabilities")(c)),
      help: "Cash, short-term investments and receivables divided by current liabilities: the current ratio without inventory.",
    },
    {
      id: "debtToEquity", label: "Debt / Equity", format: "ratio",
      value: (c) => field(c.ratios, "debtToEquityRatio") ?? divide(totalDebt(c), equity(c)),
    },
    {
      id: "netDebtEbitda", label: "Net Debt / EBITDA", format: "ratio",
      value: (c) => field(c.ratios, "netDebtToEBITDA") ?? divide(
        totalDebt(c) !== null && cashAndShortTerm(c) !== null ? totalDebt(c)! - cashAndShortTerm(c)! : null,
        (() => {
          const ebitda = yearly(inc("ebitda")(c), c);
          return ebitda !== null && ebitda > 0 ? ebitda : null;
        })(),
      ),
      help: "Years of EBITDA it would take to pay off debt net of cash. Negative means more cash than debt.",
    },
    { id: "interestCoverage", label: "Interest Coverage", format: "ratio", value: (c) => {
      const reported = field(c.ratios, "interestCoverageRatio");
      if (reported !== null) return reported;
      const interest = inc("interestExpense")(c);
      return interest !== null && interest > 0 ? divide(inc("operatingIncome")(c), interest) : null;
    }, help: "Operating income divided by interest expense." },
    {
      id: "assetTurnover", label: "Asset Turnover", format: "ratio", section: "Efficiency",
      value: (c) => field(c.ratios, "assetTurnover") ?? divide(yearly(revenue(c), c), bal("totalAssets")(c)),
      help: "Revenue divided by total assets: how much the business sells for each dollar it owns.",
    },
    {
      id: "inventoryTurnover", label: "Inventory Turnover", format: "ratio",
      value: (c) => field(c.ratios, "inventoryTurnover") ?? divide(yearly(inc("costOfRevenue")(c), c), bal("inventory")(c)),
      help: "Cost of revenue divided by inventory: how many times a year inventory is sold through.",
    },
  ],
};

type ChartConfig = { title: string; series: string[]; defaults: string[] };

// Without yearly prices (quarterly views, or statements from SEC filings) the valuation chart would
// have a single TTM point, so the Ratios tab charts returns instead.
const RATIOS_FALLBACK_CHART: ChartConfig = { title: "Returns", series: ["roe", "roa", "roic"], defaults: ["roe", "roa", "roic"] };

const CHARTS: Record<StatementId, ChartConfig> = {
  income: { title: "Revenue & Profits", series: ["revenue", "grossProfit", "operatingIncome", "netIncome", "eps"], defaults: ["revenue", "netIncome"] },
  balance: { title: "Cash & Debt", series: ["cashAndShortTerm", "totalDebt", "equity", "totalAssets"], defaults: ["cashAndShortTerm", "totalDebt"] },
  "cash-flow": { title: "Cash Flow", series: ["operatingCashFlow", "capex", "freeCashFlow", "dividends", "buybacks"], defaults: ["operatingCashFlow", "freeCashFlow"] },
  ratios: { title: "Valuation Ratios", series: ["pe", "ps", "pb", "pfcf", "evEbitda"], defaults: ["pe", "ps", "pfcf"] },
};

// Share counts are a level, not a flow, so a trailing-twelve-month figure uses the latest quarter.
const NOT_SUMMED = new Set(["weightedAverageShsOut", "weightedAverageShsOutDil"]);

function newestFirst(rows: Row[]): Row[] {
  return rows
    .filter((row) => typeof row.date === "string")
    .sort((left, right) => String(right.date).localeCompare(String(left.date)));
}

export function sumTrailingQuarters(quarters: Row[]): Row | null {
  const recent = newestFirst(quarters).slice(0, TTM_QUARTERS);
  if (recent.length < TTM_QUARTERS) return null;

  const total: Row = { ...recent[0] };
  for (const key of Object.keys(recent[0])) {
    if (NOT_SUMMED.has(key) || typeof recent[0][key] !== "number") continue;
    const values = recent.map((row) => num(row[key]));
    total[key] = values.every((value) => value !== null) ? values.reduce((sum, value) => sum! + value!, 0) : null;
  }
  return total;
}

// "priceToEarningsRatioTTM" → "priceToEarningsRatio", so TTM and annual rows share line items.
export function stripTtmSuffix(row: Row | undefined): Row | null {
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/TTM$/, ""), value]));
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// "Fiscal year is October - September" from the month the fiscal year ends.
export function fiscalYearLabel(rows: Row[]): string | null {
  const yearEnd = rows.find((row) => row.period === "FY" || row.period === "Q4");
  const month = typeof yearEnd?.date === "string" ? Number(yearEnd.date.slice(5, 7)) : NaN;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return `${MONTHS[month % 12]} - ${MONTHS[month - 1]}`;
}

function columnLabel(row: Row, period: StatementPeriod): string {
  const year = String(row.fiscalYear ?? String(row.date).slice(0, 4));
  return period === "annual" ? `FY ${year}` : `${String(row.period ?? "Q")} ${year}`;
}

function byDate(rows: Row[]): Map<string, Row> {
  return new Map(rows.map((row) => [String(row.date), row]));
}

export function buildStatementTable({
  statement,
  period,
  income,
  balance,
  cash,
  ratios,
  quarterlyIncome,
  quarterlyBalance,
  quarterlyCash,
  ratiosTtm,
  source = "fmp",
}: {
  statement: StatementId;
  period: StatementPeriod;
  source?: StatementSource;
  income: Row[];
  balance: Row[];
  cash: Row[];
  ratios: Row[];
  quarterlyIncome: Row[];
  quarterlyBalance: Row[];
  quarterlyCash: Row[];
  ratiosTtm: Row | null;
}): StatementTable {
  const balanceByDate = byDate(balance);
  const cashByDate = byDate(cash);
  const ratiosByDate = byDate(ratios);
  const spine = statement === "balance" && balance.length > 0 ? newestFirst(balance) : newestFirst(income);
  const incomeByDate = byDate(income);

  const periodColumns: StatementColumn[] = spine.map((row) => {
    const date = String(row.date);
    return {
      id: date,
      label: columnLabel(row, period),
      periodEnding: date,
      isTtm: false,
      annualize: period === "quarterly" ? 4 : 1,
      income: incomeByDate.get(date) ?? null,
      balance: balanceByDate.get(date) ?? null,
      cash: cashByDate.get(date) ?? null,
      ratios: ratiosByDate.get(date) ?? null,
    };
  });

  const latestQuarterBalance = newestFirst(quarterlyBalance)[0] ?? null;
  const ttmIncome = sumTrailingQuarters(quarterlyIncome);
  const ttmCash = sumTrailingQuarters(quarterlyCash);
  const ttm: StatementColumn = {
    id: "ttm",
    // A balance sheet is a snapshot, so its first column is the latest quarter rather than a sum.
    label: statement === "balance" ? "Current" : "TTM",
    periodEnding: typeof latestQuarterBalance?.date === "string"
      ? latestQuarterBalance.date
      : typeof ttmIncome?.date === "string" ? ttmIncome.date : null,
    isTtm: true,
    annualize: 1,
    income: ttmIncome,
    balance: latestQuarterBalance,
    cash: ttmCash,
    ratios: ratiosTtm,
  };
  // In the quarterly balance sheet, "Current" would just repeat the newest quarter.
  const hasTtm = statement === "balance"
    ? period === "annual" && latestQuarterBalance !== null
    : ttmIncome !== null || ttmCash !== null;
  const columns = hasTtm ? [ttm, ...periodColumns] : periodColumns;

  // Same period one year earlier: the next annual column, or four quarters back.
  const yearAgo = (index: number): StatementColumn | null => {
    const column = columns[index];
    if (column.isTtm) return null;
    const step = period === "annual" ? 1 : 4;
    return columns[index + step] ?? null;
  };

  // Rows a company never reports (e.g. inventory for a bank) are dropped instead of showing dashes;
  // a dropped row's section heading moves to the next row that is kept.
  const rows: StatementRow[] = [];
  let pendingSection: string | null = null;
  for (const item of LINE_ITEMS[statement]) {
    pendingSection = item.section ?? pendingSection;
    const values = columns.map((column, index) => item.value(column, yearAgo(index)));
    // FMP sends 0 for items a company doesn't break out, so all-zero rows are dropped too.
    if (values.every((value) => value === null || value === 0)) continue;
    rows.push({
      id: item.id,
      label: item.label,
      format: item.format,
      emphasis: item.emphasis ?? false,
      section: pendingSection,
      help: item.help ?? null,
      values,
    });
    pendingSection = null;
  }

  const pointsIn = (id: string) => rows.find((row) => row.id === id)?.values.filter((value) => value !== null).length ?? 0;
  const chartConfig = statement === "ratios" && !CHARTS.ratios.series.some((id) => pointsIn(id) >= 2)
    ? RATIOS_FALLBACK_CHART
    : CHARTS[statement];
  // Charts read oldest to newest, with TTM last. A quarterly chart leaves TTM out: a year's total
  // next to single quarters would dwarf them.
  const order = columns.map((_, index) => index).reverse();
  const periodsOnly = order.filter((index) => !(hasTtm && index === 0));
  const chronological = hasTtm && period === "annual" ? [...periodsOnly, 0] : periodsOnly;
  const series = chartConfig.series.flatMap((id): ChartSeries[] => {
    const row = rows.find((candidate) => candidate.id === id);
    return row ? [{ id, label: row.label, format: row.format, values: chronological.map((index) => row.values[index]) }] : [];
  });

  const currencySource = income[0] ?? balance[0] ?? cash[0] ?? quarterlyIncome[0];
  return {
    statement,
    period,
    source,
    currency: typeof currencySource?.reportedCurrency === "string" ? currencySource.reportedCurrency : "USD",
    fiscalYear: fiscalYearLabel(period === "annual" ? income : quarterlyIncome),
    columns: columns.map(({ id, label, periodEnding }) => ({ id, label, periodEnding })),
    rows,
    chart: {
      title: chartConfig.title,
      labels: chronological.map((index) => columns[index].label),
      series,
      defaults: chartConfig.defaults.filter((id) => series.some((item) => item.id === id)),
    },
  };
}

// Parameter order matches the overview and fundamentals requests, so the cached responses are shared.
async function rows(endpoint: string, params: [string, string][]): Promise<Row[]> {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error("FMP is not configured.");
  const url = new URL(`${FMP_BASE_URL}/${endpoint}`);
  for (const [key, value] of params) url.searchParams.set(key, value);
  url.searchParams.set("apikey", apiKey);
  const payload = await fetchFmp(url, STATEMENT_REVALIDATE_SECONDS);
  if (!Array.isArray(payload)) throw new Error("FMP returned an unexpected response.");
  return payload.filter((row): row is Row => !!row && typeof row === "object");
}

async function optional(request: Promise<Row[]>): Promise<Row[]> {
  try {
    return await request;
  } catch {
    return [];
  }
}

const annualParams = (symbol: string): [string, string][] => [["symbol", symbol], ["limit", PERIOD_LIMIT], ["period", "annual"]];
const quarterParams = (symbol: string): [string, string][] => [["symbol", symbol], ["period", "quarter"], ["limit", PERIOD_LIMIT]];

export async function getStatementTable(
  symbol: string,
  statement: StatementId,
  period: StatementPeriod,
): Promise<StatementResult> {
  if (!process.env.FMP_API_KEY) return { ok: false, reason: "not-configured" };
  const params = period === "annual" ? annualParams(symbol) : quarterParams(symbol);

  // The income statement anchors the table; everything else may be missing.
  let income: Row[];
  try {
    income = await rows("income-statement", params);
  } catch (error) {
    const reason = failureReason(error);
    // Companies FMP's plan doesn't cover, or any company once its daily limit is reached, still
    // have SEC filings.
    return canUseFallback(reason) ? (await secStatementTable(symbol, statement, period)) ?? { ok: false, reason } : { ok: false, reason };
  }
  if (income.length === 0) return { ok: false, reason: "no-data" };

  const quarterly = quarterParams(symbol);
  // Key metrics (market cap, enterprise value, EV multiples, yields, ROIC) only feed the Ratios tab.
  const wantsMetrics = statement === "ratios";
  const [balance, cash, ratios, quarterlyIncome, quarterlyBalance, quarterlyCash, ratiosTtm, metrics, metricsTtm] = await Promise.all([
    optional(rows("balance-sheet-statement", params)),
    optional(rows("cash-flow-statement", params)),
    // Quarterly ratios need a paid plan; quarterly views compute what they can from the statements.
    period === "annual" ? optional(rows("ratios", params)) : Promise.resolve([]),
    period === "quarterly" ? Promise.resolve(income) : optional(rows("income-statement", quarterly)),
    optional(rows("balance-sheet-statement", quarterly)),
    optional(rows("cash-flow-statement", quarterly)),
    optional(rows("ratios-ttm", [["symbol", symbol]])),
    wantsMetrics && period === "annual" ? optional(rows("key-metrics", params)) : Promise.resolve([]),
    wantsMetrics ? optional(rows("key-metrics-ttm", [["symbol", symbol]])) : Promise.resolve([]),
  ]);
  const metricsByDate = byDate(metrics);
  // Each year's ratios and key metrics share a date, so they merge into one row.
  const mergedRatios = ratios.length
    ? ratios.map((row) => ({ ...metricsByDate.get(String(row.date)), ...row }))
    : metrics;
  const ttmRatios = stripTtmSuffix(ratiosTtm[0]);
  const ttmMetrics = stripTtmSuffix(metricsTtm[0]);

  return {
    ok: true,
    data: buildStatementTable({
      statement,
      period,
      income,
      balance,
      cash,
      ratios: mergedRatios,
      quarterlyIncome,
      quarterlyBalance,
      quarterlyCash,
      ratiosTtm: ttmRatios || ttmMetrics ? { ...ttmMetrics, ...ttmRatios } : null,
    }),
  };
}

// Trailing ratios from Finnhub's free metrics, for companies whose statements come from the SEC
// (which has no prices). Named like FMP's ratios so the same line items read them.
async function finnhubRatiosTtm(symbol: string): Promise<Row | null> {
  const result = await fetchFinnhub("stock/metric", { symbol: finnhubSymbol(symbol), metric: "all" }, STATEMENT_REVALIDATE_SECONDS);
  const metric = result.ok ? (result.payload as { metric?: Row } | null)?.metric : null;
  if (!metric) return null;
  const yieldPercent = num(metric.currentDividendYieldTTM);
  return {
    priceToEarningsRatio: num(metric.peTTM),
    priceToSalesRatio: num(metric.psTTM),
    priceToBookRatio: num(metric.pbQuarterly) ?? num(metric.pbAnnual),
    priceToFreeCashFlowRatio: num(metric.pfcfShareTTM),
    dividendYield: yieldPercent !== null ? yieldPercent / 100 : null,
  };
}

async function secStatementTable(symbol: string, statement: StatementId, period: StatementPeriod): Promise<StatementResult | null> {
  const [sec, ratiosTtm] = await Promise.all([getSecStatements(symbol), finnhubRatiosTtm(symbol)]);
  if (!sec.ok) return null;
  const rowsFor = period === "annual" ? sec.data.annual : sec.data.quarterly;
  return {
    ok: true,
    data: buildStatementTable({
      statement,
      period,
      income: rowsFor.income,
      balance: rowsFor.balance,
      cash: rowsFor.cash,
      ratios: [],
      quarterlyIncome: sec.data.quarterly.income,
      quarterlyBalance: sec.data.quarterly.balance,
      quarterlyCash: sec.data.quarterly.cash,
      ratiosTtm,
      source: "sec",
    }),
  };
}
