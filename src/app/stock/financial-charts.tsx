"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AnnualFinancialSummary, RevenueSegmentPeriod } from "@/lib/fmp";

type SegmentView = "product" | "geographic";
type ChartDatum = Record<string, string | number | null>;

const palette = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
];

function compactMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return new Intl.NumberFormat("en-US", {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  }
}

function preciseMoney(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function multiple(value: number): string {
  return `${value.toFixed(1)}×`;
}

function hasValues(rows: AnnualFinancialSummary[], fields: (keyof AnnualFinancialSummary)[]): boolean {
  return rows.some((row) => fields.some((field) => typeof row[field] === "number"));
}

function hasPositiveValues(rows: AnnualFinancialSummary[], fields: (keyof AnnualFinancialSummary)[]): boolean {
  return rows.some((row) => fields.some((field) => {
    const value = row[field];
    return typeof value === "number" && value > 0;
  }));
}

function ChartCard({
  title,
  description,
  className = "",
  action,
  children,
}: {
  title: string;
  description: string;
  className?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className={`fundamental-chart-card ${className}`}>
      <div className="fundamental-chart-heading">
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        {action}
      </div>
      <div className="fundamental-chart-plot">{children}</div>
    </article>
  );
}

function ChartFrame({ children }: { children: ReactNode }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      {children}
    </ResponsiveContainer>
  );
}

const gridProps = {
  stroke: "var(--border)",
  strokeDasharray: "3 5",
  vertical: false,
};

const xAxisProps = {
  dataKey: "fiscalYear",
  axisLine: false,
  tickLine: false,
  tick: { fill: "var(--muted-foreground)", fontSize: 12 },
  tickMargin: 10,
};

const moneyTooltip = (currency: string) => (value: unknown) =>
  typeof value === "number" ? compactMoney(value, currency) : "—";

function segmentChartData(periods: RevenueSegmentPeriod[]) {
  const ordered = [...periods].sort((left, right) => left.fiscalYear.localeCompare(right.fiscalYear));
  const latest = ordered[ordered.length - 1];
  if (!latest) return { data: [] as ChartDatum[], keys: [] as string[] };

  const topKeys = [...latest.segments]
    .sort((left, right) => right.revenue - left.revenue)
    .slice(0, 6)
    .map((segment) => segment.name);
  const hasOther = ordered.some((period) => period.segments.some((segment) => !topKeys.includes(segment.name)));
  const keys = hasOther ? [...topKeys, "Other segments"] : topKeys;
  const data = ordered.map((period): ChartDatum => {
    const point: ChartDatum = { fiscalYear: period.fiscalYear };
    let otherRevenue = 0;
    for (const segment of period.segments) {
      if (topKeys.includes(segment.name)) point[segment.name] = segment.revenue;
      else otherRevenue += segment.revenue;
    }
    if (hasOther) point["Other segments"] = otherRevenue;
    return point;
  });

  return { data, keys };
}

export function FinancialCharts({
  rows,
  currency,
  productSegments,
  geographicSegments,
  forwardPe,
  forwardPeDate,
}: {
  rows: AnnualFinancialSummary[];
  currency: string;
  productSegments: RevenueSegmentPeriod[];
  geographicSegments: RevenueSegmentPeriod[];
  forwardPe: number | null;
  forwardPeDate: string | null;
}) {
  const [segmentView, setSegmentView] = useState<SegmentView>(
    productSegments.length > 0 ? "product" : "geographic",
  );
  const chronologicalRows = useMemo(() => [...rows].reverse(), [rows]);
  const availableSegmentViews = [
    ...(productSegments.length > 0 ? (["product"] as const) : []),
    ...(geographicSegments.length > 0 ? (["geographic"] as const) : []),
  ];
  const activeSegmentPeriods = segmentView === "product" ? productSegments : geographicSegments;
  const segmentData = useMemo(() => segmentChartData(activeSegmentPeriods), [activeSegmentPeriods]);

  const showRevenue = hasValues(rows, ["revenue", "grossProfit", "operatingIncome", "netIncome"]);
  const showBalance = hasValues(rows, ["cash", "totalDebt", "netDebt"]);
  const showCashFlow = hasValues(rows, ["operatingCashFlow", "freeCashFlow", "capitalExpenditure"]);
  const showMargins = hasValues(rows, ["grossMargin", "operatingMargin", "netMargin"]);
  const showValuationHistory = hasPositiveValues(rows, ["peRatio", "psRatio", "pfcfRatio"]);
  const forwardPeValue = forwardPe !== null && forwardPe > 0 ? forwardPe : null;
  const showForwardPe = forwardPeValue !== null;
  const showValuation = showValuationHistory || showForwardPe;
  const showDividends = hasValues(rows, ["dividendPerShare", "dividendYield"]);
  const valuationRows = chronologicalRows.map((row) => ({
    ...row,
    peRatio: row.peRatio !== null && row.peRatio > 0 ? row.peRatio : null,
    psRatio: row.psRatio !== null && row.psRatio > 0 ? row.psRatio : null,
    pfcfRatio: row.pfcfRatio !== null && row.pfcfRatio > 0 ? row.pfcfRatio : null,
  }));

  if (
    !showRevenue && !showBalance && !showCashFlow && !showMargins && !showValuation &&
    !showDividends && availableSegmentViews.length === 0
  ) return null;

  const segmentActions = availableSegmentViews.length > 1 ? (
    <div className="chart-view-switch" role="group" aria-label="Revenue segment type">
      {availableSegmentViews.map((view) => (
        <button
          key={view}
          type="button"
          aria-pressed={segmentView === view}
          className={segmentView === view ? "chart-view-active" : ""}
          onClick={() => setSegmentView(view)}
        >
          {view === "product" ? "Product" : "Geography"}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <section className="fundamental-charts-section" id="company-charts" aria-labelledby="company-charts-title">
      <div className="fundamental-charts-intro">
        <div>
          <p className="section-label">THE BUSINESS IN CHARTS</p>
          <h2 id="company-charts-title">Fundamentals over time</h2>
          <p>Annual financials put revenue, profitability, cash generation and valuation in context.</p>
        </div>
        <span className="chart-period-badge">{rows.length} fiscal years</span>
      </div>

      <div className="fundamental-charts-grid">
        {showRevenue && (
          <ChartCard
            title="Revenue &amp; profits"
            description="Revenue with gross, operating and net income · reported currency"
            className="fundamental-chart-wide"
          >
            <ChartFrame>
              <ComposedChart data={chronologicalRows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.24} />
                    <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.015} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...gridProps} />
                <XAxis {...xAxisProps} />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  width={72}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                  tickFormatter={(value: number) => compactMoney(value, currency)}
                />
                <Tooltip
                  formatter={moneyTooltip(currency)}
                  contentStyle={{ background: "var(--card)", borderColor: "var(--border)", borderRadius: 4 }}
                  labelStyle={{ color: "var(--foreground)", fontWeight: 600 }}
                  itemStyle={{ color: "var(--foreground)", fontSize: 13 }}
                />
                <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                <Area type="monotone" dataKey="revenue" name="Revenue" stroke="var(--chart-1)" fill="url(#revenueFill)" strokeWidth={2.5} connectNulls />
                <Line type="monotone" dataKey="grossProfit" name="Gross profit" stroke="var(--chart-2)" strokeWidth={2} dot={{ r: 3, fill: "var(--chart-2)" }} connectNulls />
                <Line type="monotone" dataKey="operatingIncome" name="Operating income" stroke="var(--chart-3)" strokeWidth={2} dot={{ r: 3, fill: "var(--chart-3)" }} connectNulls />
                <Line type="monotone" dataKey="netIncome" name="Net income" stroke="var(--chart-4)" strokeWidth={2} dot={{ r: 3, fill: "var(--chart-4)" }} connectNulls />
              </ComposedChart>
            </ChartFrame>
          </ChartCard>
        )}

        {showBalance && (
          <ChartCard title="Cash, debt &amp; net cash" description="Cash and debt are bars; net cash is the line">
            <ChartFrame>
              <ComposedChart
                data={chronologicalRows.map((row) => ({
                  ...row,
                  netCash: row.cash !== null && row.totalDebt !== null
                    ? row.cash - row.totalDebt
                    : row.netDebt !== null ? -row.netDebt : null,
                }))}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid {...gridProps} />
                <XAxis {...xAxisProps} />
                <YAxis axisLine={false} tickLine={false} width={72} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickFormatter={(value: number) => compactMoney(value, currency)} />
                <Tooltip formatter={moneyTooltip(currency)} contentStyle={{ background: "var(--card)", borderColor: "var(--border)", borderRadius: 4 }} labelStyle={{ color: "var(--foreground)", fontWeight: 600 }} itemStyle={{ color: "var(--foreground)", fontSize: 13 }} />
                <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                <Bar dataKey="cash" name="Cash &amp; investments" fill={palette[0]} radius={[3, 3, 0, 0]} maxBarSize={24} />
                <Bar dataKey="totalDebt" name="Total debt" fill={palette[1]} radius={[3, 3, 0, 0]} maxBarSize={24} />
                <Line type="monotone" dataKey="netCash" name="Net cash" stroke={palette[2]} strokeWidth={2.5} dot={{ r: 3, fill: palette[2] }} connectNulls />
              </ComposedChart>
            </ChartFrame>
          </ChartCard>
        )}

        {showCashFlow && (
          <ChartCard title="Cash flow &amp; investment" description="Capital expenditure is shown as reported, usually a cash outflow">
            <ChartFrame>
              <ComposedChart data={chronologicalRows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis {...xAxisProps} />
                <YAxis axisLine={false} tickLine={false} width={72} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickFormatter={(value: number) => compactMoney(value, currency)} />
                <Tooltip formatter={moneyTooltip(currency)} contentStyle={{ background: "var(--card)", borderColor: "var(--border)", borderRadius: 4 }} labelStyle={{ color: "var(--foreground)", fontWeight: 600 }} itemStyle={{ color: "var(--foreground)", fontSize: 13 }} />
                <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                <Bar dataKey="operatingCashFlow" name="Operating cash flow" fill={palette[0]} radius={[3, 3, 0, 0]} maxBarSize={28} />
                <Bar dataKey="capitalExpenditure" name="Capital expenditure" fill={palette[4]} radius={[3, 3, 0, 0]} maxBarSize={28} />
                <Line type="monotone" dataKey="freeCashFlow" name="Free cash flow" stroke={palette[2]} strokeWidth={2.5} dot={{ r: 3, fill: palette[2] }} connectNulls />
              </ComposedChart>
            </ChartFrame>
          </ChartCard>
        )}

        {showMargins && (
          <ChartCard title="Profit margins" description="Each margin is measured against revenue">
            <ChartFrame>
              <ComposedChart data={chronologicalRows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis {...xAxisProps} />
                <YAxis axisLine={false} tickLine={false} width={56} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickFormatter={(value: number) => percent(value)} />
                <Tooltip formatter={(value: unknown) => typeof value === "number" ? percent(value) : "—"} contentStyle={{ background: "var(--card)", borderColor: "var(--border)", borderRadius: 4 }} labelStyle={{ color: "var(--foreground)", fontWeight: 600 }} itemStyle={{ color: "var(--foreground)", fontSize: 13 }} />
                <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                <Line type="monotone" dataKey="grossMargin" name="Gross margin" stroke={palette[0]} strokeWidth={2.5} dot={{ r: 3, fill: palette[0] }} connectNulls />
                <Line type="monotone" dataKey="operatingMargin" name="Operating margin" stroke={palette[2]} strokeWidth={2.5} dot={{ r: 3, fill: palette[2] }} connectNulls />
                <Line type="monotone" dataKey="netMargin" name="Net margin" stroke={palette[4]} strokeWidth={2.5} dot={{ r: 3, fill: palette[4] }} connectNulls />
              </ComposedChart>
            </ChartFrame>
          </ChartCard>
        )}

        {showValuation && (
          <ChartCard
            title="Valuation multiples"
            description="Positive historical fiscal-year price-to-earnings, sales and free cash flow"
            className="fundamental-chart-wide"
            action={showValuationHistory && forwardPeValue !== null ? (
              <div className="forward-pe-callout" title="Latest close divided by upcoming annual consensus EPS">
                <span>Forward P/E</span>
                <strong>{multiple(forwardPeValue)}</strong>
                <small>{forwardPeDate ? `EPS estimate · ${forwardPeDate.slice(0, 4)}` : "Consensus estimate"}</small>
              </div>
            ) : undefined}
          >
            {showValuationHistory ? (
              <ChartFrame>
                <ComposedChart data={valuationRows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                  <CartesianGrid {...gridProps} />
                  <XAxis {...xAxisProps} />
                  <YAxis axisLine={false} tickLine={false} width={56} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickFormatter={(value: number) => `${value}×`} />
                  <Tooltip formatter={(value: unknown) => typeof value === "number" ? multiple(value) : "—"} contentStyle={{ background: "var(--card)", borderColor: "var(--border)", borderRadius: 4 }} labelStyle={{ color: "var(--foreground)", fontWeight: 600 }} itemStyle={{ color: "var(--foreground)", fontSize: 13 }} />
                  <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                  <Line type="monotone" dataKey="peRatio" name="P/E" stroke={palette[0]} strokeWidth={2.5} dot={{ r: 3, fill: palette[0] }} connectNulls />
                  <Line type="monotone" dataKey="psRatio" name="P/S" stroke={palette[2]} strokeWidth={2.5} dot={{ r: 3, fill: palette[2] }} connectNulls />
                  <Line type="monotone" dataKey="pfcfRatio" name="P / free cash flow" stroke={palette[4]} strokeWidth={2.5} dot={{ r: 3, fill: palette[4] }} connectNulls />
                </ComposedChart>
              </ChartFrame>
            ) : (
              <div className="forward-pe-only">
                <div className="forward-pe-callout" title="Latest close divided by upcoming annual consensus EPS">
                  <span>Forward P/E</span>
                  <strong>{forwardPeValue === null ? "—" : multiple(forwardPeValue)}</strong>
                  <small>{forwardPeDate ? `EPS estimate · ${forwardPeDate.slice(0, 4)}` : "Consensus estimate"}</small>
                </div>
                <p>Historical valuation ratios are unavailable for this ticker.</p>
              </div>
            )}
          </ChartCard>
        )}

        {showDividends && (
          <ChartCard title="Dividends &amp; yield" description="Annual dividend per share with reported dividend yield">
            <ChartFrame>
              <ComposedChart data={chronologicalRows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis {...xAxisProps} />
                <YAxis yAxisId="dps" axisLine={false} tickLine={false} width={62} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickFormatter={(value: number) => preciseMoney(value, currency)} />
                <YAxis yAxisId="yield" orientation="right" axisLine={false} tickLine={false} width={56} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickFormatter={(value: number) => percent(value)} />
                <Tooltip formatter={(value: unknown, name: unknown) => typeof value === "number" ? name === "Dividend yield" ? percent(value) : preciseMoney(value, currency) : "—"} contentStyle={{ background: "var(--card)", borderColor: "var(--border)", borderRadius: 4 }} labelStyle={{ color: "var(--foreground)", fontWeight: 600 }} itemStyle={{ color: "var(--foreground)", fontSize: 13 }} />
                <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                <Bar yAxisId="dps" dataKey="dividendPerShare" name="Dividend / share" fill={palette[0]} radius={[3, 3, 0, 0]} maxBarSize={30} />
                <Line yAxisId="yield" type="monotone" dataKey="dividendYield" name="Dividend yield" stroke={palette[2]} strokeWidth={2.5} dot={{ r: 3, fill: palette[2] }} connectNulls />
              </ComposedChart>
            </ChartFrame>
          </ChartCard>
        )}

        {availableSegmentViews.length > 0 && (
          <ChartCard
            title="Revenue by segment"
            description={`Annual reported revenue · ${segmentView === "product" ? "product lines" : "geography"}`}
            className="fundamental-chart-wide"
            action={segmentActions}
          >
            <ChartFrame>
              <AreaChart data={segmentData.data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid {...gridProps} />
                <XAxis {...xAxisProps} />
                <YAxis axisLine={false} tickLine={false} width={72} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickFormatter={(value: number) => compactMoney(value, currency)} />
                <Tooltip formatter={moneyTooltip(currency)} contentStyle={{ background: "var(--card)", borderColor: "var(--border)", borderRadius: 4 }} labelStyle={{ color: "var(--foreground)", fontWeight: 600 }} itemStyle={{ color: "var(--foreground)", fontSize: 13 }} />
                <Legend wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
                {segmentData.keys.map((key, index) => (
                  <Area
                    key={key}
                    type="monotone"
                    dataKey={key}
                    name={key}
                    stackId="revenue"
                    stroke={palette[index % palette.length]}
                    fill={palette[index % palette.length]}
                    fillOpacity={0.75}
                    connectNulls
                  />
                ))}
              </AreaChart>
            </ChartFrame>
            <p className="chart-note">Segment names follow the company’s filings and may change between years; smaller lines are grouped into Other segments.</p>
          </ChartCard>
        )}
      </div>
      <p className="fundamental-charts-footnote">Annual figures from Financial Modeling Prep. Missing or unavailable periods are left blank; reported currencies and segment classifications can vary.</p>
    </section>
  );
}
