// Financial statements from SEC EDGAR's XBRL "company facts", free for every US filer and used
// when FMP's plan doesn't cover a company. The facts are converted into rows shaped like FMP's
// statements, so the Financials tables and valuation tools work on them unchanged.

type Row = Record<string, unknown>;

type Fact = {
  start?: string;
  end: string;
  val: number;
  fy?: number | null;
  fp?: string | null;
  form?: string;
  filed: string;
  accn?: string;
};

type Concepts = Record<string, { units?: Record<string, Fact[]> }>;

export type SecStatements = {
  name: string;
  annual: { income: Row[]; balance: Row[]; cash: Row[] };
  quarterly: { income: Row[]; balance: Row[]; cash: Row[] };
};

export type SecResult = { ok: true; data: SecStatements } | { ok: false; reason: "not-found" | "no-data" | "provider-error" };

const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts";
const ANNUAL_PERIODS = 5;
const QUARTER_PERIODS = 5;
const CACHE_MS = 12 * 60 * 60 * 1000;
const CACHE_ENTRIES = 30;
const FORMS = new Set(["10-K", "10-K/A", "10-Q", "10-Q/A"]);

// The SEC asks automated clients to identify themselves.
export function secHeaders(): HeadersInit {
  return { "User-Agent": process.env.SEC_USER_AGENT || "StockPilot/1.0 (personal stock research app)" };
}

type FieldKind = "flow" | "instant";
type FieldSpec = { key: string; kind: FieldKind; unit?: string; concepts: string[]; negate?: boolean };

// FMP field names and the us-gaap concepts that carry them, most common first. Companies switch
// concepts over the years, so each period takes the first concept that has a value for it.
const INCOME_FIELDS: FieldSpec[] = [
  { key: "revenue", kind: "flow", concepts: ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet", "RevenuesNetOfInterestExpense"] },
  { key: "costOfRevenue", kind: "flow", concepts: ["CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfGoodsSold", "CostOfServices"] },
  { key: "grossProfit", kind: "flow", concepts: ["GrossProfit"] },
  { key: "researchAndDevelopmentExpenses", kind: "flow", concepts: ["ResearchAndDevelopmentExpense", "ResearchAndDevelopmentExpenseExcludingAcquiredInProcessCost"] },
  { key: "sellingGeneralAndAdministrativeExpenses", kind: "flow", concepts: ["SellingGeneralAndAdministrativeExpense"] },
  { key: "sellingAndMarketingExpenses", kind: "flow", concepts: ["SellingAndMarketingExpense"] },
  { key: "generalAndAdministrativeExpenses", kind: "flow", concepts: ["GeneralAndAdministrativeExpense"] },
  { key: "operatingExpenses", kind: "flow", concepts: ["OperatingExpenses", "CostsAndExpenses"] },
  { key: "operatingIncome", kind: "flow", concepts: ["OperatingIncomeLoss"] },
  { key: "interestExpense", kind: "flow", concepts: ["InterestExpense", "InterestExpenseNonoperating", "InterestExpenseDebt"] },
  { key: "incomeBeforeTax", kind: "flow", concepts: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesDomestic"] },
  { key: "incomeTaxExpense", kind: "flow", concepts: ["IncomeTaxExpenseBenefit"] },
  { key: "netIncome", kind: "flow", concepts: ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"] },
  { key: "epsDiluted", kind: "flow", unit: "USD/shares", concepts: ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"] },
  { key: "eps", kind: "flow", unit: "USD/shares", concepts: ["EarningsPerShareBasic", "EarningsPerShareBasicAndDiluted"] },
  { key: "weightedAverageShsOutDil", kind: "flow", unit: "shares", concepts: ["WeightedAverageNumberOfDilutedSharesOutstanding"] },
  { key: "weightedAverageShsOut", kind: "flow", unit: "shares", concepts: ["WeightedAverageNumberOfSharesOutstandingBasic"] },
];

const BALANCE_FIELDS: FieldSpec[] = [
  { key: "cashAndCashEquivalents", kind: "instant", concepts: ["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents", "Cash"] },
  { key: "shortTermInvestments", kind: "instant", concepts: ["ShortTermInvestments", "MarketableSecuritiesCurrent", "AvailableForSaleSecuritiesDebtSecuritiesCurrent"] },
  { key: "cashAndShortTermInvestments", kind: "instant", concepts: ["CashCashEquivalentsAndShortTermInvestments"] },
  { key: "accountsReceivable", kind: "instant", concepts: ["AccountsReceivableNetCurrent", "ReceivablesNetCurrent"] },
  { key: "otherReceivables", kind: "instant", concepts: ["NontradeReceivablesCurrent"] },
  { key: "inventory", kind: "instant", concepts: ["InventoryNet"] },
  { key: "totalCurrentAssets", kind: "instant", concepts: ["AssetsCurrent"] },
  { key: "propertyPlantEquipmentNet", kind: "instant", concepts: ["PropertyPlantAndEquipmentNet", "PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization"] },
  { key: "goodwill", kind: "instant", concepts: ["Goodwill"] },
  { key: "intangibleAssets", kind: "instant", concepts: ["IntangibleAssetsNetExcludingGoodwill", "FiniteLivedIntangibleAssetsNet"] },
  { key: "longTermInvestments", kind: "instant", concepts: ["LongTermInvestments", "MarketableSecuritiesNoncurrent", "AvailableForSaleSecuritiesDebtSecuritiesNoncurrent"] },
  { key: "totalAssets", kind: "instant", concepts: ["Assets"] },
  { key: "accountPayables", kind: "instant", concepts: ["AccountsPayableCurrent"] },
  { key: "debtCurrent", kind: "instant", concepts: ["DebtCurrent"] },
  { key: "longTermDebtCurrent", kind: "instant", concepts: ["LongTermDebtCurrent"] },
  { key: "commercialPaper", kind: "instant", concepts: ["CommercialPaper"] },
  { key: "shortTermBorrowings", kind: "instant", concepts: ["ShortTermBorrowings"] },
  { key: "totalCurrentLiabilities", kind: "instant", concepts: ["LiabilitiesCurrent"] },
  { key: "longTermDebt", kind: "instant", concepts: ["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebt"] },
  { key: "totalLiabilities", kind: "instant", concepts: ["Liabilities"] },
  { key: "totalStockholdersEquity", kind: "instant", concepts: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"] },
  { key: "totalEquityWithMinority", kind: "instant", concepts: ["StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest", "StockholdersEquity"] },
];

const CASH_FIELDS: FieldSpec[] = [
  { key: "netIncome", kind: "flow", concepts: ["NetIncomeLoss", "ProfitLoss"] },
  { key: "depreciationAndAmortization", kind: "flow", concepts: ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization", "Depreciation"] },
  { key: "stockBasedCompensation", kind: "flow", concepts: ["ShareBasedCompensation", "AllocatedShareBasedCompensationExpense"] },
  { key: "operatingCashFlow", kind: "flow", concepts: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"] },
  // FMP shows money going out as negative numbers; the SEC reports these payments as positive.
  { key: "capitalExpenditure", kind: "flow", negate: true, concepts: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"] },
  { key: "acquisitionsNet", kind: "flow", negate: true, concepts: ["PaymentsToAcquireBusinessesNetOfCashAcquired"] },
  { key: "netCashProvidedByInvestingActivities", kind: "flow", concepts: ["NetCashProvidedByUsedInInvestingActivities", "NetCashProvidedByUsedInInvestingActivitiesContinuingOperations"] },
  { key: "commonDividendsPaid", kind: "flow", negate: true, concepts: ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"] },
  { key: "commonStockRepurchased", kind: "flow", negate: true, concepts: ["PaymentsForRepurchaseOfCommonStock"] },
  { key: "debtProceeds", kind: "flow", concepts: ["ProceedsFromIssuanceOfLongTermDebt", "ProceedsFromIssuanceOfDebt"] },
  { key: "debtRepayments", kind: "flow", concepts: ["RepaymentsOfLongTermDebt", "RepaymentsOfDebt"] },
  { key: "commercialPaperNet", kind: "flow", concepts: ["ProceedsFromRepaymentsOfCommercialPaper"] },
  { key: "netCashProvidedByFinancingActivities", kind: "flow", concepts: ["NetCashProvidedByUsedInFinancingActivities", "NetCashProvidedByUsedInFinancingActivitiesContinuingOperations"] },
];

function days(start: string, end: string): number {
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000;
}

const isAnnual = (fact: Fact) => !!fact.start && days(fact.start, fact.end) >= 350 && days(fact.start, fact.end) <= 380;
const isQuarter = (fact: Fact) => !!fact.start && days(fact.start, fact.end) >= 80 && days(fact.start, fact.end) <= 100;

// basis: the first filing date on the new share basis, the earliest filing that reports a period
// ending after the split. Filings before it, even ones sent a day after the split, use the old basis.
type Split = { date: string; ratio: number; basis: string };

// Stock splits the company reported, e.g. CrowdStrike's 4-for-1 in June 2026.
export function stockSplits(concepts: Concepts): Split[] {
  const splits = new Map<string, number>();
  for (const fact of concepts.StockholdersEquityNoteStockSplitConversionRatio1?.units?.pure ?? []) {
    if (fact.end && typeof fact.val === "number" && fact.val > 0 && fact.val !== 1) splits.set(fact.end, fact.val);
  }
  const reports = (concepts.NetIncomeLoss?.units?.USD ?? []).filter((fact) => FORMS.has(fact.form ?? ""));
  return [...splits].map(([date, ratio]) => {
    const later = reports.filter((fact) => fact.end > date).map((fact) => fact.filed).sort()[0];
    return { date, ratio, basis: later ?? date };
  });
}

// One concept's facts in the forms we use, keeping the latest filing (with any restatement) for
// each period. Share counts and per-share figures filed before a split are restated to today's
// share basis, as filings after the split do for the periods they repeat.
function factsFor(concepts: Concepts, concept: string, unit: string, splits: Split[]): Fact[] {
  const latest = new Map<string, Fact>();
  for (const fact of concepts[concept]?.units?.[unit] ?? []) {
    if (!FORMS.has(fact.form ?? "") || typeof fact.val !== "number" || !fact.end) continue;
    const key = `${fact.start ?? ""}|${fact.end}`;
    const seen = latest.get(key);
    if (!seen || fact.filed > seen.filed) latest.set(key, fact);
  }
  const facts = [...latest.values()];
  if (unit !== "shares" && unit !== "USD/shares") return facts;
  return facts.map((fact) => {
    const factor = splits.filter((split) => fact.filed < split.basis).reduce((product, split) => product * split.ratio, 1);
    return factor === 1 ? fact : { ...fact, val: unit === "shares" ? fact.val * factor : fact.val / factor };
  });
}

// Reads one field for one period, trying the field's concepts in order.
class FieldReader {
  private cache = new Map<string, Fact[]>();
  private concepts: Concepts;
  private splits: Split[];

  constructor(concepts: Concepts) {
    this.concepts = concepts;
    this.splits = stockSplits(concepts);
  }

  private facts(spec: FieldSpec, concept: string): Fact[] {
    const unit = spec.unit ?? "USD";
    const key = `${concept}|${unit}`;
    if (!this.cache.has(key)) this.cache.set(key, factsFor(this.concepts, concept, unit, this.splits));
    return this.cache.get(key)!;
  }

  private sign(spec: FieldSpec, value: number | null): number | null {
    return value === null ? null : spec.negate ? -value : value;
  }

  annual(spec: FieldSpec, end: string): number | null {
    for (const concept of spec.concepts) {
      const facts = this.facts(spec, concept);
      const fact = spec.kind === "instant"
        ? facts.find((item) => !item.start && item.end === end)
        : facts.find((item) => item.end === end && isAnnual(item));
      if (fact) return this.sign(spec, fact.val);
    }
    return null;
  }

  // A three-month value. Filings often give only the year to date (cash flows in 10-Qs, and the
  // fourth quarter, which only the 10-K covers), so a quarter is then the year to date minus the
  // year to date at the previous quarter's end.
  quarter(spec: FieldSpec, end: string): number | null {
    for (const concept of spec.concepts) {
      const facts = this.facts(spec, concept);
      if (spec.kind === "instant") {
        const fact = facts.find((item) => !item.start && item.end === end);
        if (fact) return this.sign(spec, fact.val);
        continue;
      }
      const direct = facts.find((item) => item.end === end && isQuarter(item));
      if (direct) return this.sign(spec, direct.val);
      const toDate = facts
        .filter((item) => item.end === end && item.start && days(item.start, item.end) > 100 && days(item.start, item.end) <= 380)
        .sort((left, right) => days(left.start!, left.end) - days(right.start!, right.end))[0];
      if (!toDate) continue;
      // Per-share and share-count figures can't be subtracted; EPS is recomputed below instead.
      if (spec.unit === "shares") return toDate.val;
      if (spec.unit === "USD/shares") continue;
      const before = facts
        .filter((item) => item.start === toDate.start && item.end < end && days(item.end, end) >= 80 && days(item.end, end) <= 100)
        .sort((left, right) => right.end.localeCompare(left.end))[0];
      if (before) return this.sign(spec, toDate.val - before.val);
    }
    return null;
  }
}

type PeriodInfo = { end: string; fiscalYear: number; period: string };

// The periods a company reported, newest first. The SEC's own fiscal-year field is inconsistent
// between filings, so only the newest 10-K's is trusted: earlier years are counted back from it,
// and each quarter takes the fiscal year that ends next and its position within that year.
function periods(concepts: Concepts, spine: FieldSpec): { annual: PeriodInfo[]; quarterly: PeriodInfo[] } {
  const all = spine.concepts.flatMap((concept) => (concepts[concept]?.units?.USD ?? []).filter((fact) => FORMS.has(fact.form ?? "")));
  const annualEnds = [...new Set(all.filter(isAnnual).map((fact) => fact.end))].sort().reverse();
  if (annualEnds.length === 0) return { annual: [], quarterly: [] };

  // The newest 10-K's own period is the latest annual end it reports.
  const newestTenK = all
    .filter((fact) => fact.form?.startsWith("10-K") && isAnnual(fact) && fact.end === annualEnds[0] && typeof fact.fy === "number")
    .sort((left, right) => right.filed.localeCompare(left.filed))[0];
  const newestYear = typeof newestTenK?.fy === "number" ? newestTenK.fy : Number(annualEnds[0].slice(0, 4));
  const yearOf = (end: string) => newestYear - Math.round(days(end, annualEnds[0]) / 365.25);
  const annual = annualEnds.slice(0, ANNUAL_PERIODS).map((end) => ({ end, fiscalYear: yearOf(end), period: "FY" }));

  // Quarters after the newest 10-K belong to the next fiscal year, ending about a year later.
  const nextYearEnd = new Date(Date.parse(`${annualEnds[0]}T00:00:00Z`) + 365 * 86_400_000).toISOString().slice(0, 10);
  const yearEnds = [nextYearEnd, ...annualEnds].sort();
  const quarterEnds = [...new Set([...all.filter(isQuarter).map((fact) => fact.end), ...annualEnds])].sort().reverse();
  const quarterly = quarterEnds.flatMap((end): PeriodInfo[] => {
    const yearEnd = yearEnds.find((candidate) => candidate >= end && days(end, candidate) < 380);
    if (!yearEnd) return [];
    const number = 4 - Math.round(days(end, yearEnd) / 91.3);
    if (number < 1 || number > 4) return [];
    const fiscalYear = yearEnd === nextYearEnd ? newestYear + 1 : yearOf(yearEnd);
    return [{ end, fiscalYear, period: `Q${number}` }];
  }).slice(0, QUARTER_PERIODS);
  return { annual, quarterly };
}

function sum(...values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  return present.length ? present.reduce((total, value) => total + value, 0) : null;
}

type SecRow = Record<string, string | number | null>;

function buildRows(reader: FieldReader, period: PeriodInfo, quarterly: boolean): { income: SecRow; balance: SecRow; cash: SecRow } {
  const read = (spec: FieldSpec) => (quarterly ? reader.quarter(spec, period.end) : reader.annual(spec, period.end));
  const values = (specs: FieldSpec[]) => Object.fromEntries(specs.map((spec) => [spec.key, read(spec)])) as Record<string, number | null>;
  const base = { date: period.end, fiscalYear: String(period.fiscalYear), period: period.period, reportedCurrency: "USD" };

  const income = values(INCOME_FIELDS);
  const cash = values(CASH_FIELDS);
  const balance = values(BALANCE_FIELDS);

  income.grossProfit ??= income.revenue !== null && income.costOfRevenue !== null ? income.revenue - income.costOfRevenue : null;
  income.sellingGeneralAndAdministrativeExpenses ??= sum(income.sellingAndMarketingExpenses, income.generalAndAdministrativeExpenses);
  income.ebit = income.operatingIncome;
  income.ebitda = income.operatingIncome !== null && cash.depreciationAndAmortization !== null ? income.operatingIncome + cash.depreciationAndAmortization : null;
  // A derived fourth quarter has no reported EPS: net income over the year's diluted shares.
  if (quarterly && income.epsDiluted === null && income.netIncome !== null && income.weightedAverageShsOutDil) {
    income.epsDiluted = income.netIncome / income.weightedAverageShsOutDil;
  }

  balance.cashAndShortTermInvestments ??= sum(balance.cashAndCashEquivalents, balance.shortTermInvestments);
  balance.netReceivables = sum(balance.accountsReceivable, balance.otherReceivables);
  balance.goodwillAndIntangibleAssets = sum(balance.goodwill, balance.intangibleAssets);
  // DebtCurrent already includes its parts; otherwise add them up. Leases are left out.
  balance.shortTermDebt = balance.debtCurrent ?? sum(balance.longTermDebtCurrent, balance.commercialPaper, balance.shortTermBorrowings);
  balance.totalDebt = sum(balance.shortTermDebt, balance.longTermDebt);
  balance.totalLiabilities ??= balance.totalAssets !== null && balance.totalEquityWithMinority !== null ? balance.totalAssets - balance.totalEquityWithMinority : null;
  balance.netDebt = balance.totalDebt !== null && balance.cashAndShortTermInvestments !== null ? balance.totalDebt - balance.cashAndShortTermInvestments : null;

  cash.freeCashFlow = cash.operatingCashFlow !== null && cash.capitalExpenditure !== null ? cash.operatingCashFlow + cash.capitalExpenditure : cash.operatingCashFlow;
  cash.netDebtIssuance = cash.debtProceeds !== null || cash.debtRepayments !== null || cash.commercialPaperNet !== null
    ? (cash.debtProceeds ?? 0) - (cash.debtRepayments ?? 0) + (cash.commercialPaperNet ?? 0)
    : null;

  return { income: { ...base, ...income }, balance: { ...base, ...balance }, cash: { ...base, ...cash } };
}

// Converts a company-facts document into FMP-shaped statement rows, newest first.
export function statementsFromFacts(document: unknown): SecStatements | null {
  const record = document as { entityName?: unknown; facts?: { "us-gaap"?: Concepts } } | null;
  const concepts = record?.facts?.["us-gaap"];
  if (!concepts) return null;
  const spine = INCOME_FIELDS.find((spec) => spec.key === "netIncome")!;
  const { annual, quarterly } = periods(concepts, spine);
  if (annual.length === 0) return null;

  const reader = new FieldReader(concepts);
  const annualRows = annual.map((period) => buildRows(reader, period, false));
  const quarterRows = quarterly.map((period) => buildRows(reader, period, true)).filter((row) => row.income.netIncome !== null);
  return {
    name: typeof record?.entityName === "string" ? record.entityName : "",
    annual: { income: annualRows.map((row) => row.income), balance: annualRows.map((row) => row.balance), cash: annualRows.map((row) => row.cash) },
    quarterly: { income: quarterRows.map((row) => row.income), balance: quarterRows.map((row) => row.balance), cash: quarterRows.map((row) => row.cash) },
  };
}

// Ticker to CIK (10 digits), from the SEC's list of about 10,000 companies (~800 KB, cached for a day).
export async function lookupCik(symbol: string): Promise<string | null> {
  const response = await fetch(TICKERS_URL, { headers: secHeaders(), next: { revalidate: 60 * 60 * 24 } });
  if (!response.ok) throw new Error(`SEC ticker list returned ${response.status}`);
  const list = Object.values((await response.json()) as Record<string, { cik_str: number; ticker: string }>);
  const match = list.find((item) => item.ticker.toUpperCase() === symbol.toUpperCase());
  return match ? String(match.cik_str).padStart(10, "0") : null;
}

// Company-facts files run 2–10 MB, over the Next.js data cache's 2 MB limit, so the converted
// rows (a few KB) are kept in memory instead.
const statementsCache = new Map<string, { at: number; data: SecStatements | null }>();

export async function getSecStatements(symbol: string, now = Date.now()): Promise<SecResult> {
  const cached = statementsCache.get(symbol);
  if (cached && now - cached.at < CACHE_MS) return cached.data ? { ok: true, data: cached.data } : { ok: false, reason: "no-data" };

  try {
    const cik = await lookupCik(symbol);
    if (!cik) return { ok: false, reason: "not-found" };
    const response = await fetch(`${FACTS_URL}/CIK${cik}.json`, { headers: secHeaders(), cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (response.status === 404) return { ok: false, reason: "no-data" };
    if (!response.ok) return { ok: false, reason: "provider-error" };
    const data = statementsFromFacts(await response.json());
    if (statementsCache.size >= CACHE_ENTRIES) statementsCache.delete(statementsCache.keys().next().value!);
    statementsCache.set(symbol, { at: now, data });
    return data ? { ok: true, data } : { ok: false, reason: "no-data" };
  } catch {
    return { ok: false, reason: "provider-error" };
  }
}

// For tests: forget the cached statements.
export function resetSecCache(): void {
  statementsCache.clear();
}
