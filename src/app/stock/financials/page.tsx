import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../../components/app-shell";
import { QuoteHeader } from "../../components/quote-header";
import { StockNav } from "../../components/stock-nav";
import { FinancialCharts } from "../financial-charts";
import { StatementChart } from "./statement-chart";
import { AiHeading } from "./ai-review";
import { getCompanyFundamentals, getFinancialChartExtras, normalizeTicker } from "@/lib/fmp";
import { providerFailureMessage } from "@/lib/fmp-messages";
import {
  STATEMENTS,
  getStatementTable,
  isStatementId,
  type StatementId,
  type StatementPeriod,
  type StatementRow,
  type StatementTable,
  type ValueFormat,
} from "@/lib/financial-statements";
import { getQuote } from "@/lib/stock-overview";

export const metadata: Metadata = {
  title: "Financials — StockPilot",
  description: "Income statement, balance sheet, cash flow and ratios, annual and quarterly.",
};

type FinancialsPageProps = {
  searchParams: Promise<{ symbol?: string | string[]; statement?: string | string[]; period?: string | string[] }>;
};

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// "overview" is the charts-only Financials tab; the others are the statement tables.
type FinancialsView = "overview" | StatementId;

const VIEWS: { id: FinancialsView; label: string }[] = [
  { id: "overview", label: "Financials" },
  ...STATEMENTS.map(({ id, label }) => ({ id, label })),
];

function financialsHref(symbol: string, view: FinancialsView, period: StatementPeriod): string {
  const params = new URLSearchParams({ symbol });
  if (view !== "overview") params.set("statement", view);
  if (period !== "annual") params.set("period", period);
  return `/stock/financials?${params}`;
}

// Amounts are shown in millions, like the statements in company filings.
function formatCell(value: number | null, format: ValueFormat): string {
  if (value === null) return "—";
  switch (format) {
    case "money":
    case "shares": {
      // FMP reports items a company doesn't break out (like Apple's interest expense) as 0.
      if (value === 0) return "—";
      const millions = value / 1e6;
      const digits = Math.abs(millions) < 10 ? 2 : 0;
      return new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(millions);
    }
    case "perShare":
    case "ratio":
      return value.toFixed(2);
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "growth":
      return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
  }
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

const LEGAL_SUFFIX = /,?\s+(&\s*Co\.?|Inc\.?|Incorporated|Corporation|Corp\.?|Company|Co\.?|Ltd\.?|Limited|plc|N\.V\.|S\.A\.|AG|SE)$/i;

// "Apple Inc." → "Apple", "The Coca-Cola Company" → "Coca-Cola", for headings like "Apple Income Statement".
function shortName(name: string): string {
  let short = name.trim();
  while (LEGAL_SUFFIX.test(short)) short = short.replace(LEGAL_SUFFIX, "");
  return short.replace(/^The\s+/i, "") || name;
}

function RowLabel({ row }: { row: StatementRow }) {
  return row.help ? <span className="stat-term" title={row.help}>{row.label}</span> : <>{row.label}</>;
}

function StatementTableView({ table }: { table: StatementTable }) {
  return (
    <div className="table-scroll statement-table-wrap">
      <table className="financial-table statement-table">
        <thead>
          <tr>
            <th scope="col">{table.period === "annual" ? "Fiscal Year" : "Fiscal Quarter"}</th>
            {table.columns.map((column) => <th scope="col" key={column.id}>{column.label}</th>)}
          </tr>
          <tr className="statement-period-row">
            <th scope="row">Period Ending</th>
            {table.columns.map((column) => <td key={column.id}>{formatDate(column.periodEnding)}</td>)}
          </tr>
        </thead>
        <tbody>
          {table.rows.flatMap((row) => [
            ...(row.section ? [
              <tr className="statement-section-row" key={`${row.id}-section`}>
                <th scope="colgroup" colSpan={table.columns.length + 1}>{row.section}</th>
              </tr>,
            ] : []),
            <tr key={row.id} className={row.emphasis ? "statement-row-emphasis" : row.format === "growth" ? "statement-row-growth" : ""}>
              <th scope="row"><RowLabel row={row} /></th>
              {row.values.map((value, index) => (
                <td
                  key={table.columns[index].id}
                  className={row.format === "growth" && value !== null ? (value >= 0 ? "positive-value" : "negative-value") : ""}
                >
                  {formatCell(value, row.format)}
                </td>
              ))}
            </tr>,
          ])}
        </tbody>
      </table>
    </div>
  );
}

function LoadError({ message }: { message: string }) {
  return (
    <section className="empty-state" role="status">
      <span className="empty-state-icon" aria-hidden="true">!</span>
      <div>
        <h2>We couldn&apos;t load the financials</h2>
        <p>{message}</p>
      </div>
    </section>
  );
}

export default async function FinancialsPage({ searchParams }: FinancialsPageProps) {
  const params = await searchParams;
  const rawSymbol = single(params.symbol);
  const symbol = rawSymbol ? normalizeTicker(rawSymbol) : null;
  const rawStatement = single(params.statement);
  const view: FinancialsView = isStatementId(rawStatement) ? rawStatement : "overview";
  const period: StatementPeriod = single(params.period) === "quarterly" ? "quarterly" : "annual";

  if (!symbol) {
    return (
      <AppShell contentClassName="dashboard-content">
        <section className="projection-start">
          <p className="section-label">FINANCIALS</p>
          <h1>Company financials</h1>
          <p>Search for a ticker above to see its income statement, balance sheet, cash flow and ratios.</p>
        </section>
      </AppShell>
    );
  }

  const statementIds = view === "overview" ? STATEMENTS.map((item) => item.id) : [view];
  const [quote, tables, fundamentals, chartExtras] = await Promise.all([
    getQuote(symbol),
    Promise.all(statementIds.map((id) => getStatementTable(symbol, id, period))),
    view === "overview" ? getCompanyFundamentals(symbol) : Promise.resolve(null),
    view === "overview" ? getFinancialChartExtras(symbol) : Promise.resolve(null),
  ]);
  // Every statement table shares the income statement, so its failure is the page's failure.
  const primary = tables[0];
  const currency = primary.ok ? primary.data.currency : "USD";
  const companyName = quote.ok ? shortName(quote.data.name) : symbol;
  const forwardPe = quote.ok && chartExtras && chartExtras.nextYearEps !== null && chartExtras.nextYearEps > 0
    ? quote.data.price / chartExtras.nextYearEps
    : null;
  const subtitle = (data: StatementTable, ratios: boolean) => (
    <p>
      {ratios
        ? "Valuation ratios, margins, returns and financial health."
        : `Financials in millions ${data.currency}, except per-share data.`}
      {data.fiscalYear && ` Fiscal year is ${data.fiscalYear}.`}
      {period === "quarterly" && " The free FMP plan includes the last 5 quarters."}
    </p>
  );

  return (
    <AppShell contentClassName="dashboard-content" tickerValue={symbol} headerLabel={`${symbol} financials`}>
      {quote.ok ? (
        <QuoteHeader quote={quote.data} currency={currency} />
      ) : (
        <section className="quote-header"><h1>{symbol}</h1></section>
      )}
      <StockNav symbol={symbol} active="financials" />

      <div className="statement-toolbar">
        <nav className="statement-tabs" aria-label="Financial statements">
          {VIEWS.map((item) => (
            <Link
              key={item.id}
              href={financialsHref(symbol, item.id, period)}
              className={item.id === view ? "statement-tab-active" : ""}
              aria-current={item.id === view ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <nav className="statement-tabs" aria-label="Reporting period">
          {(["annual", "quarterly"] as const).map((option) => (
            <Link
              key={option}
              href={financialsHref(symbol, view, option)}
              className={option === period ? "statement-tab-active" : ""}
              aria-current={option === period ? "page" : undefined}
            >
              {option === "annual" ? "Annual" : "Quarterly"}
            </Link>
          ))}
        </nav>
      </div>

      {!primary.ok ? (
        <LoadError
          message={primary.reason === "no-data"
            ? `No financial statements were found for ${symbol}. Check the ticker or your FMP plan access.`
            : providerFailureMessage(primary.reason, "the financial statements")}
        />
      ) : view === "overview" ? (
        <>
          <section className="statement-heading">
            <h2>{companyName} Financials Overview</h2>
            {subtitle(primary.data, false)}
          </section>

          <div className="financials-charts-grid">
            {tables.map((table) => table.ok && (
              <StatementChart
                key={`${table.data.statement}-${period}`}
                title={table.data.chart.title}
                labels={table.data.chart.labels}
                series={table.data.chart.series}
                defaults={table.data.chart.defaults}
                headingLevel={3}
              />
            ))}
          </div>
          <p className="table-footnote">
            Click a legend item to show or hide it. Open a statement tab above for the full numbers.
          </p>

          {fundamentals?.ok && chartExtras && (
            <section className="financials-more" aria-label="More analysis">
              <FinancialCharts
                rows={fundamentals.data.annualFinancials}
                currency={fundamentals.data.annualFinancials[0]?.currency ?? currency}
                productSegments={chartExtras.productSegments}
                geographicSegments={chartExtras.geographicSegments}
                forwardPe={forwardPe}
                forwardPeDate={chartExtras.nextYearDate}
                extrasOnly
              />
            </section>
          )}
        </>
      ) : (
        <>
          <section className="statement-heading">
            <AiHeading
              target={{ symbol, statement: view, period, label: STATEMENTS.find((item) => item.id === view)!.title }}
              subtitle={subtitle(primary.data, view === "ratios")}
            >
              <h2>{companyName} {STATEMENTS.find((item) => item.id === view)!.title}</h2>
            </AiHeading>
          </section>

          <StatementChart
            key={`${view}-${period}`}
            title={primary.data.chart.title}
            labels={primary.data.chart.labels}
            series={primary.data.chart.series}
            defaults={primary.data.chart.defaults}
          />

          <StatementTableView table={primary.data} />
          <p className="table-footnote">
            {view === "balance"
              ? "Current is the latest quarterly balance sheet. "
              : "TTM (trailing twelve months) adds up the last four quarters. "}
            Growth compares each period with the same period a year earlier. A dash means FMP has no value for that period.
          </p>
        </>
      )}
    </AppShell>
  );
}
