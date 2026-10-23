export type AssumptionKey =
  | "currentPrice"
  | "fcfPerShare"
  | "epsPerShare"
  | "dividendPerShare"
  | "bookValuePerShare"
  | "revenuePerShare"
  | "discountRate"
  | "growthRate"
  | "growthYears"
  | "terminalGrowth"
  | "revenueGrowth"
  | "dividendGrowth"
  | "exitPe"
  | "payoutRatio"
  | "returnOnEquity"
  | "targetNetMargin"
  | "bondYield"
  | "marginOfSafety";

// Starting values may be missing from the data; every other assumption always has a number.
export type Assumptions = Record<AssumptionKey, number | null>;

export type AssumptionUnit = "currency" | "percent" | "years" | "multiple";
export type AssumptionGroup = "start" | "growth" | "risk" | "exit";

export type AssumptionSpec = {
  key: AssumptionKey;
  label: string;
  group: AssumptionGroup;
  unit: AssumptionUnit;
  min: number;
  max: number;
  step: number;
  // Starting values come from the filings; only the forward-looking assumptions are AI-filled.
  aiFillable: boolean;
  short: string;
  help: string;
};

export const ASSUMPTION_GROUPS: { id: AssumptionGroup; title: string; description: string }[] = [
  {
    id: "start",
    title: "Starting point",
    description: "Per-share figures from the latest annual report. Every projection grows from these.",
  },
  {
    id: "growth",
    title: "Growth",
    description: "How fast the business grows during the projection, and how fast it grows forever after.",
  },
  {
    id: "risk",
    title: "Risk and required return",
    description: "The return you need to be paid for owning the stock, and the safety cushion you want.",
  },
  {
    id: "exit",
    title: "Profitability and exit",
    description: "What the business earns, pays out and is worth at the end of the projection.",
  },
];

export const ASSUMPTION_SPECS: AssumptionSpec[] = [
  {
    key: "currentPrice",
    label: "Current share price",
    group: "start",
    unit: "currency",
    min: 0,
    max: 1_000_000,
    step: 0.01,
    aiFillable: false,
    short: "What one share costs today.",
    help: "Loaded from the latest quote. Every estimate is compared with it to show upside or downside. You can type a price if the quote is unavailable.",
  },
  {
    key: "fcfPerShare",
    label: "Free cash flow per share",
    group: "start",
    unit: "currency",
    min: -100_000,
    max: 100_000,
    step: 0.01,
    aiFillable: false,
    short: "Cash left after running and reinvesting in the business.",
    help: "Operating cash flow minus capital expenditure, divided by diluted shares. It is the cash that could be returned to shareholders, so it drives the DCF model. For cyclical companies this uses the multi-year average to avoid valuing a peak or a trough.",
  },
  {
    key: "epsPerShare",
    label: "Earnings per share (EPS)",
    group: "start",
    unit: "currency",
    min: -100_000,
    max: 100_000,
    step: 0.01,
    aiFillable: false,
    short: "Net income for each share.",
    help: "Diluted earnings per share from the latest income statement. Used by the earnings, Graham and residual income models.",
  },
  {
    key: "dividendPerShare",
    label: "Dividend per share",
    group: "start",
    unit: "currency",
    min: 0,
    max: 100_000,
    step: 0.01,
    aiFillable: false,
    short: "Cash paid to each share over the last year.",
    help: "The annual dividend per share. The dividend discount model values the stock as the sum of all future dividends, so it only applies when this is above zero.",
  },
  {
    key: "bookValuePerShare",
    label: "Book value per share",
    group: "start",
    unit: "currency",
    min: -100_000,
    max: 100_000,
    step: 0.01,
    aiFillable: false,
    short: "Shareholders' equity for each share.",
    help: "Assets minus liabilities, divided by diluted shares. For banks and insurers, whose balance sheets are mostly financial assets, this is the foundation of the residual income model.",
  },
  {
    key: "revenuePerShare",
    label: "Revenue per share",
    group: "start",
    unit: "currency",
    min: 0,
    max: 100_000,
    step: 0.01,
    aiFillable: false,
    short: "Sales for each share.",
    help: "Total revenue divided by diluted shares. The revenue model uses it for companies that are not yet profitable: it grows sales, then applies a future profit margin.",
  },
  {
    key: "growthRate",
    label: "Earnings and cash flow growth",
    group: "growth",
    unit: "percent",
    min: -0.2,
    max: 0.5,
    step: 0.005,
    aiFillable: true,
    short: "Yearly growth of EPS and free cash flow during the projection.",
    help: "How fast earnings and free cash flow grow each year of the projection. Historical growth is a starting point, but high rates rarely last: very few companies sustain more than 15–20% a year for a decade.",
  },
  {
    key: "growthYears",
    label: "Projection length",
    group: "growth",
    unit: "years",
    min: 1,
    max: 15,
    step: 1,
    aiFillable: true,
    short: "How many years of above-normal growth to model.",
    help: "The number of years the growth rates above apply before the business settles into terminal growth. Use 5 years for most companies and up to 10 for businesses with long, visible growth runways.",
  },
  {
    key: "terminalGrowth",
    label: "Terminal growth",
    group: "growth",
    unit: "percent",
    min: -0.02,
    max: 0.05,
    step: 0.0025,
    aiFillable: true,
    short: "Growth forever after the projection ends.",
    help: "No company can outgrow the economy forever, so this should sit at or below long-run inflation plus real GDP growth, typically 2–3%. It must be lower than the discount rate. Small changes here move the DCF value a lot.",
  },
  {
    key: "revenueGrowth",
    label: "Revenue growth",
    group: "growth",
    unit: "percent",
    min: -0.3,
    max: 1,
    step: 0.005,
    aiFillable: true,
    short: "Yearly sales growth, used by the revenue model.",
    help: "How fast sales grow each year of the projection. For young, unprofitable companies this matters more than current earnings, because the value depends on how big the business becomes.",
  },
  {
    key: "dividendGrowth",
    label: "Dividend growth",
    group: "growth",
    unit: "percent",
    min: -0.2,
    max: 0.3,
    step: 0.005,
    aiFillable: true,
    short: "Yearly growth of the dividend during the projection.",
    help: "How fast the dividend per share rises each year. Mature dividend payers typically raise dividends 3–8% a year; dividends rarely grow faster than earnings for long.",
  },
  {
    key: "discountRate",
    label: "Discount rate",
    group: "risk",
    unit: "percent",
    min: 0.03,
    max: 0.25,
    step: 0.0025,
    aiFillable: true,
    short: "The yearly return you require for the risk you take.",
    help: "Future cash is worth less than cash today. The default uses CAPM: the 10-year Treasury yield plus the stock's beta times an equity risk premium. Riskier companies deserve a higher rate, which lowers their value. Most large companies land between 7% and 11%.",
  },
  {
    key: "marginOfSafety",
    label: "Margin of safety",
    group: "risk",
    unit: "percent",
    min: 0,
    max: 0.7,
    step: 0.05,
    aiFillable: true,
    short: "Discount to the estimate before you would buy.",
    help: "Every estimate can be wrong. A margin of safety sets a buy price below the estimate, so a mistake still leaves room. Benjamin Graham used about a third; 20–30% is common, more for uncertain businesses.",
  },
  {
    key: "bondYield",
    label: "AAA corporate bond yield",
    group: "risk",
    unit: "percent",
    min: 0.01,
    max: 0.15,
    step: 0.0025,
    aiFillable: true,
    short: "Yield on top-rated corporate bonds, used by the Graham formula.",
    help: "Graham's formula scales value by 4.4% (the AAA yield when he wrote it) divided by today's AAA yield, so higher interest rates lower the value. The default is the 10-year Treasury yield plus a typical AAA spread.",
  },
  {
    key: "exitPe",
    label: "Exit P/E multiple",
    group: "exit",
    unit: "multiple",
    min: 1,
    max: 80,
    step: 0.5,
    aiFillable: true,
    short: "The P/E the stock trades at when the projection ends.",
    help: "The price-to-earnings ratio you expect at the end of the projection. Growth slows as companies mature, so this is usually lower than today's P/E. The long-run market average is about 15–20.",
  },
  {
    key: "payoutRatio",
    label: "Payout ratio",
    group: "exit",
    unit: "percent",
    min: 0,
    max: 1,
    step: 0.05,
    aiFillable: true,
    short: "Share of earnings paid out as dividends.",
    help: "Dividends divided by earnings. The earnings model adds the dividends you collect along the way, and the residual income model keeps the rest as retained earnings that grow book value.",
  },
  {
    key: "returnOnEquity",
    label: "Return on equity (ROE)",
    group: "exit",
    unit: "percent",
    min: -0.2,
    max: 0.6,
    step: 0.005,
    aiFillable: true,
    short: "Profit earned on each dollar of book value.",
    help: "Net income divided by shareholders' equity. In the residual income model, a company creates value only when ROE beats the discount rate. Banks typically earn 8–15%.",
  },
  {
    key: "targetNetMargin",
    label: "Target net margin",
    group: "exit",
    unit: "percent",
    min: -0.2,
    max: 0.6,
    step: 0.005,
    aiFillable: true,
    short: "Profit margin once the business matures.",
    help: "The share of revenue the company keeps as profit at the end of the projection. For unprofitable companies, compare with mature peers in the same industry.",
  },
];

export const ASSUMPTION_SPEC_BY_KEY = Object.fromEntries(
  ASSUMPTION_SPECS.map((spec) => [spec.key, spec]),
) as Record<AssumptionKey, AssumptionSpec>;

export const AI_FILLABLE_KEYS = ASSUMPTION_SPECS
  .filter((spec) => spec.aiFillable)
  .map((spec) => spec.key);

export function clampAssumption(key: AssumptionKey, value: number): number {
  const spec = ASSUMPTION_SPEC_BY_KEY[key];
  const clamped = Math.min(spec.max, Math.max(spec.min, value));
  return spec.unit === "years" ? Math.round(clamped) : clamped;
}
