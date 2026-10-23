import Link from "next/link";
import { AppShell } from "../components/app-shell";
import { AIAnalysis } from "./ai-analysis";
import { FinancialCharts } from "./financial-charts";
import { PriceHistoryChart } from "./price-history-chart";
import {
  getCompanyFundamentals,
  getFinancialChartExtras,
  getStockPriceHistory,
  normalizeTicker,
  type AnnualFinancialSummary,
  type FmpFailureReason,
} from "@/lib/fmp";
import { providerFailureMessage } from "@/lib/fmp-messages";

type StockPageProps = {
  searchParams: Promise<{ symbol?: string | string[] }>;
};

function formatMoney(value: number | null, currency: string, compact = true): string {
  if (value === null) return "—";
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 0,
    }).format(value);
  } catch {
    return new Intl.NumberFormat("en-US", {
      notation: compact ? "compact" : "standard",
      maximumFractionDigits: compact ? 1 : 0,
    }).format(value);
  }
}

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function formatSignedPercent(value: number | null): string {
  if (value === null) return "—";
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${(value * 100).toFixed(1)}%`;
}

function formatMultiple(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2)}×`;
}

function formattedPeriod(financial: AnnualFinancialSummary): string {
  return financial.period === "FY"
    ? financial.fiscalYear
    : `${financial.fiscalYear} ${financial.period}`;
}

function MetricCard({
  label,
  value,
  note,
  accent = false,
}: {
  label: string;
  value: string;
  note: string;
  accent?: boolean;
}) {
  return (
    <article className={`metric-card${accent ? " metric-card-accent" : ""}`}>
      <div className="metric-card-top">
        <span>{label}</span>
        <span className="metric-card-dot" aria-hidden="true" />
      </div>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function EmptyResults({
  symbol,
  reason,
}: {
  symbol: string | null;
  reason?: FmpFailureReason;
}) {
  const message = !symbol
    ? "Enter a valid ticker symbol to load its fundamentals."
    : reason === "not-configured"
      ? "FMP is not connected yet. Add your FMP_API_KEY to .env and restart the development server."
      : reason === "no-data"
        ? `No annual financial statements were found for ${symbol}. Check the ticker or your FMP plan access.`
        : providerFailureMessage(reason, "the financial statements");

  return (
    <section className="empty-state" role="status">
      <span className="empty-state-icon" aria-hidden="true">!</span>
      <div>
        <h2>{symbol ? "We couldn't load this company" : "Start with a ticker"}</h2>
        <p>{message}</p>
      </div>
    </section>
  );
}

function HistoryTable({ rows }: { rows: AnnualFinancialSummary[] }) {
  return (
    <div className="table-scroll">
      <table className="financial-table">
        <thead>
          <tr>
            <th scope="col">Fiscal year</th>
            <th scope="col">Revenue</th>
            <th scope="col">Growth</th>
            <th scope="col">Gross margin</th>
            <th scope="col">Operating margin</th>
            <th scope="col">Net income</th>
            <th scope="col">Net margin</th>
            <th scope="col">Net debt</th>
            <th scope="col">Debt / equity</th>
            <th scope="col">Operating cash flow</th>
            <th scope="col">Free cash flow</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.date}-${row.period}`}>
              <th scope="row">
                <span className="table-year">{formattedPeriod(row)}</span>
                {row.date && <span className="table-date">{row.date}</span>}
              </th>
              <td>{formatMoney(row.revenue, row.currency)}</td>
              <td className={row.revenueGrowth === null ? "" : row.revenueGrowth >= 0 ? "positive-value" : "negative-value"}>
                {formatSignedPercent(row.revenueGrowth)}
              </td>
              <td>{formatPercent(row.grossMargin)}</td>
              <td>{formatPercent(row.operatingMargin)}</td>
              <td>{formatMoney(row.netIncome, row.currency)}</td>
              <td>{formatPercent(row.netMargin)}</td>
              <td>{formatMoney(row.netDebt, row.currency)}</td>
              <td>{formatMultiple(row.debtToEquity)}</td>
              <td>{formatMoney(row.operatingCashFlow, row.currency)}</td>
              <td>{formatMoney(row.freeCashFlow, row.currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function StockPage({ searchParams }: StockPageProps) {
  const params = await searchParams;
  const rawSymbol = Array.isArray(params.symbol) ? null : params.symbol;
  const symbol = rawSymbol ? normalizeTicker(rawSymbol) : null;
  const [result, priceHistory, chartExtras] = await Promise.all([
    symbol ? getCompanyFundamentals(symbol) : Promise.resolve(null),
    symbol ? getStockPriceHistory(symbol) : Promise.resolve(null),
    symbol
      ? getFinancialChartExtras(symbol)
      : Promise.resolve({ productSegments: [], geographicSegments: [], nextYearEps: null, nextYearDate: null }),
  ]);
  const rows = result?.ok ? result.data.annualFinancials : [];
  const latest = rows[0];
  const chartCurrency = result?.ok ? result.data.annualFinancials[0]?.currency ?? "USD" : "USD";
  const latestClose = priceHistory?.ok ? priceHistory.data.at(-1)?.close ?? null : null;
  const forwardPe = latestClose !== null && chartExtras.nextYearEps !== null && chartExtras.nextYearEps > 0
    ? latestClose / chartExtras.nextYearEps
    : null;

  return (
    <AppShell contentClassName="dashboard-content" tickerValue={symbol ?? ""}>
          {symbol && <div className="breadcrumb"><Link href="/">Research</Link><span>/</span><span>{symbol}</span></div>}

          {!result || !result.ok ? (
            <>
              {symbol && priceHistory?.ok && (
                <PriceHistoryChart
                  symbol={symbol}
                  currency={chartCurrency}
                  prices={priceHistory.data}
                />
              )}
              <EmptyResults symbol={symbol} reason={result?.reason} />
            </>
          ) : (
            <>
              <section className="company-heading">
                <div>
                  <p className="section-label">COMPANY FUNDAMENTALS</p>
                  <div className="company-title-row">
                    <h1>{result.data.symbol}</h1>
                    <span className="access-badge">ANNUAL · {rows.length} {rows.length === 1 ? "YEAR" : "YEARS"}</span>
                  </div>
                  <p className="company-subtitle">
                    Revenue, profitability, leverage and cash generation at a glance.
                  </p>
                </div>
                <div className="report-date">
                  <span>LATEST REPORT</span>
                  <strong>{latest?.date || "—"}</strong>
                  <small>Reported in {latest?.currency ?? "—"}</small>
                </div>
              </section>

              {priceHistory?.ok ? (
                <PriceHistoryChart
                  symbol={result.data.symbol}
                  currency={chartCurrency}
                  prices={priceHistory.data}
                />
              ) : (
                <section className="price-history-unavailable" role="status">
                  <div>
                    <p className="section-label">PRICE HISTORY</p>
                    <h2>Price history unavailable</h2>
                    <p>
                      {priceHistory?.reason === "no-data"
                        ? `No daily price history was found for ${result.data.symbol}.`
                        : providerFailureMessage(priceHistory?.reason, "daily price history")}
                    </p>
                  </div>
                </section>
              )}

              <AIAnalysis fundamentals={result.data} symbol={symbol} />

              <nav className="research-tabs" aria-label="Company sections">
                <a className="research-tab" href="#summary">Summary</a>
                <a className="research-tab" href="#company-charts">Charts</a>
                <a className="research-tab" href="#financials">Financials</a>
                <a className="research-tab" href="#balance-sheet">Balance &amp; cash flow</a>
                <Link className="research-tab" href={`/projections?symbol=${result.data.symbol}`}>
                  Projections <span aria-hidden="true">→</span>
                </Link>
                <Link className="research-tab" href={`/news?symbol=${result.data.symbol}`}>
                  News <span aria-hidden="true">→</span>
                </Link>
              </nav>

              {rows.length > 0 && (
                <>
                  <section className="overview-grid" id="summary" aria-label="Latest annual metrics">
                    <MetricCard
                      label="Revenue"
                      value={formatMoney(latest.revenue, latest.currency)}
                      note={`${formattedPeriod(latest)} · ${formatPercent(latest.revenueGrowth)} year over year`}
                      accent
                    />
                    <MetricCard
                      label="Net income"
                      value={formatMoney(latest.netIncome, latest.currency)}
                      note={`${formattedPeriod(latest)} · ${formatPercent(latest.netMargin)} net margin`}
                    />
                    <MetricCard
                      label="Operating margin"
                      value={formatPercent(latest.operatingMargin)}
                      note="Operating income as a share of revenue"
                    />
                    <MetricCard
                      label="Net debt"
                      value={formatMoney(latest.netDebt, latest.currency)}
                      note={`Debt / equity ${formatMultiple(latest.debtToEquity)}`}
                    />
                  </section>

                  <FinancialCharts
                    rows={rows}
                    currency={chartCurrency}
                    productSegments={chartExtras.productSegments}
                    geographicSegments={chartExtras.geographicSegments}
                    forwardPe={forwardPe}
                    forwardPeDate={chartExtras.nextYearDate}
                  />

                  <section className="history-section" id="financials" aria-labelledby="history-heading">
                    <div className="content-section-heading">
                      <div>
                        <p className="section-label">FINANCIAL HISTORY</p>
                        <h2 id="history-heading">Last {rows.length} fiscal years</h2>
                      </div>
                      <span className="table-hint">Scroll to see all metrics <span aria-hidden="true">→</span></span>
                    </div>
                    <HistoryTable rows={rows} />
                    <p className="table-footnote">
                      Ratios are shown as reported by FMP when available; margins are calculated from the statements otherwise. A dash means data was unavailable.
                    </p>
                  </section>

                  <section className="details-section" id="balance-sheet" aria-labelledby="details-heading">
                    <div className="content-section-heading">
                      <div>
                        <p className="section-label">LATEST ANNUAL PERIOD</p>
                        <h2 id="details-heading">Balance sheet &amp; cash generation</h2>
                      </div>
                    </div>
                    <div className="detail-grid">
                      <MetricCard label="Total debt" value={formatMoney(latest.totalDebt, latest.currency)} note="Short- and long-term debt" />
                      <MetricCard label="Cash & short-term investments" value={formatMoney(latest.cash, latest.currency)} note="Cash and short-term investments when available" />
                      <MetricCard label="Shareholders’ equity" value={formatMoney(latest.equity, latest.currency)} note="Total stockholders’ equity" />
                      <MetricCard label="Current ratio" value={formatMultiple(latest.currentRatio)} note="Current assets divided by liabilities" />
                      <MetricCard label="Interest coverage" value={formatMultiple(latest.interestCoverage)} note="Operating income relative to interest expense" />
                      <MetricCard label="Free cash flow" value={formatMoney(latest.freeCashFlow, latest.currency)} note={`${formatMoney(latest.operatingCashFlow, latest.currency)} operating cash flow`} />
                    </div>
                  </section>
                </>
              )}
            </>
          )}
    </AppShell>
  );
}
