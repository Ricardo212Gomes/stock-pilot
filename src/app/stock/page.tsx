import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "../components/app-shell";
import { CompanyHeader } from "../components/company-header";
import { companyMetadata } from "../components/company-metadata";
import { QuoteHeader } from "../components/quote-header";
import { StockNav } from "../components/stock-nav";
import { Leaderboard } from "./leaderboard";
import { PriceHistoryChart } from "./price-history-chart";
import { getStockPriceHistory, normalizeTicker } from "@/lib/fmp";
import { providerFailureMessage } from "@/lib/fmp-messages";
import { isLeaderboardId } from "@/lib/leaderboard";
import { getStockOverview, type StockOverview } from "@/lib/stock-overview";

export const generateMetadata = companyMetadata("Overview", "Price, key statistics, analyst views and company profile for any stock.", "Stocks");

const ABOUT_LENGTH = 600;

const REPORT_TIME_LABELS = { bmo: "before the open", dmh: "during the day", amc: "after the close" } as const;

type StockPageProps = {
  searchParams: Promise<{ symbol?: string | string[]; list?: string | string[] }>;
};

function compactNumber(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { notation: "compact", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function money(value: number | null, currency: string): string {
  if (value === null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
  } catch {
    return value.toFixed(2);
  }
}

function plain(value: number | null, digits = 2): string {
  return value === null ? "—" : new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

function signedPercent(value: number | null, digits = 2): string {
  if (value === null) return "";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}


function Growth({ value }: { value: number | null }) {
  if (value === null) return null;
  return <span className={value >= 0 ? "positive-value" : "negative-value"}> {signedPercent(value, 1)}</span>;
}

// A term with a plain-language explanation on hover, for readers new to the metric.
function Term({ children, help }: { children: ReactNode; help?: string }) {
  return help ? <span className="stat-term" title={help}>{children}</span> : <>{children}</>;
}

type Stat = { label: string; help?: string; value: ReactNode };

function StatTable({ rows, label }: { rows: Stat[]; label: string }) {
  return (
    <table className="overview-stat-table">
      <caption className="visually-hidden">{label}</caption>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row"><Term help={row.help}>{row.label}</Term></th>
            <td>{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function statRows(data: StockOverview): [Stat[], Stat[]] {
  const { currency } = data;
  const range = (low: number | null, high: number | null) =>
    low === null || high === null ? "—" : `${plain(low)} - ${plain(high)}`;

  return [
    [
      { label: "Market Cap", help: "Share price times all shares outstanding: what the market values the whole company at.", value: compactNumber(data.marketCap) },
      { label: "Revenue (ttm)", help: "Total sales over the trailing twelve months (the last four reported quarters).", value: <>{compactNumber(data.revenueTtm)}<Growth value={data.revenueGrowth} /></> },
      { label: "Net Income (ttm)", help: "Profit after all expenses and taxes over the last four quarters.", value: compactNumber(data.netIncomeTtm) },
      { label: "EPS (ttm)", help: "Earnings per share: net income divided by diluted shares, over the last four quarters.", value: <>{plain(data.epsTtm)}<Growth value={data.epsGrowth} /></> },
      { label: "Shares Out", help: "Shares currently outstanding.", value: compactNumber(data.sharesOutstanding) },
      { label: "PE Ratio", help: "Price divided by trailing EPS: how many years of current earnings the price pays for.", value: plain(data.peRatio) },
      { label: "Forward PE", help: "Price divided by analysts' EPS estimate for the next fiscal year.", value: plain(data.forwardPe) },
      {
        label: "Dividend",
        help: "The latest dividend times its yearly frequency, and its yield at today's price.",
        value: data.dividendPerShare === null ? "n/a" : `${money(data.dividendPerShare, currency)} (${((data.dividendYield ?? 0) * 100).toFixed(2)}%)`,
      },
      { label: "Ex-Dividend Date", help: "Buy before this date to receive the next dividend.", value: formatDate(data.exDividendDate) },
    ],
    [
      { label: "Volume", help: "Shares traded today.", value: data.volume === null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(data.volume) },
      { label: "Open", value: plain(data.open) },
      { label: "Previous Close", value: plain(data.previousClose) },
      { label: "Day's Range", value: range(data.dayLow, data.dayHigh) },
      { label: "52-Week Range", help: "Lowest and highest price over the past year.", value: range(data.yearLow, data.yearHigh) },
      { label: "Beta", help: "How much the stock moves with the market: 1 moves in line, above 1 swings more, below 1 less.", value: plain(data.beta) },
      {
        label: "Analysts",
        help: data.analystCount ? `Consensus rating from ${data.analystCount} analysts.` : "Consensus analyst rating.",
        value: data.analystConsensus ?? "—",
      },
      {
        label: "Price Target",
        help: "Average analyst price target, and how far it is from today's price.",
        value: data.priceTarget === null ? "—" : <>{plain(data.priceTarget)} <span className={(data.priceTargetUpside ?? 0) >= 0 ? "positive-value" : "negative-value"}>({signedPercent(data.priceTargetUpside)})</span></>,
      },
      {
        label: "Earnings Date",
        help: "Next scheduled earnings report, from Finnhub's earnings calendar.",
        value: data.earningsDate ? <>{formatDate(data.earningsDate)}{data.earningsTime && <span className="overview-earnings-time"> · {REPORT_TIME_LABELS[data.earningsTime]}</span>}</> : "—",
      },
    ],
  ];
}

function About({ data }: { data: StockOverview }) {
  const profile = data.profile;
  if (!profile?.description && !profile?.sector) return null;

  const description = profile.description && profile.description.length > ABOUT_LENGTH
    ? `${profile.description.slice(0, ABOUT_LENGTH).replace(/\s+\S*$/, "")}…`
    : profile.description;
  const website = profile.website && /^https?:\/\//.test(profile.website) ? profile.website : null;

  return (
    <section className="overview-about" aria-labelledby="about-heading">
      <h2 id="about-heading">About {data.name}</h2>
      {description && <p>{description}</p>}
      <dl>
        {profile.sector && <div><dt>Sector</dt><dd>{profile.sector}</dd></div>}
        {profile.industry && <div><dt>Industry</dt><dd>{profile.industry}</dd></div>}
        {profile.ceo && <div><dt>CEO</dt><dd>{profile.ceo}</dd></div>}
        {profile.employees !== null && <div><dt>Employees</dt><dd>{new Intl.NumberFormat("en-US").format(profile.employees)}</dd></div>}
        {website && (
          <div>
            <dt>Website</dt>
            <dd><a href={website} target="_blank" rel="noopener noreferrer">{website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a></dd>
          </div>
        )}
      </dl>
    </section>
  );
}

export default async function StockOverviewPage({ searchParams }: StockPageProps) {
  const params = await searchParams;
  const rawSymbol = Array.isArray(params.symbol) ? null : params.symbol;
  const symbol = rawSymbol ? normalizeTicker(rawSymbol) : null;
  const [overview, history] = symbol
    ? await Promise.all([getStockOverview(symbol), getStockPriceHistory(symbol)])
    : [null, null];

  if (!symbol || !overview) {
    const rawList = Array.isArray(params.list) ? params.list[0] : params.list;
    return (
      <AppShell contentClassName="dashboard-content">
        <section className="company-heading">
          <div>
            <p className="section-label">LEADERBOARDS</p>
            <div className="company-title-row">
              <h1>Stocks</h1>
            </div>
            <p className="company-subtitle">
              {rawSymbol ? "That isn't a valid ticker. " : ""}
              Start from the largest companies or today&apos;s biggest moves, or search for any company above.
            </p>
          </div>
        </section>
        <Leaderboard list={isLeaderboardId(rawList) ? rawList : "largest"} />
      </AppShell>
    );
  }

  if (!overview.ok) {
    return (
      <AppShell contentClassName="dashboard-content" tickerValue={symbol} headerLabel={`${symbol} · Overview`}>
        <CompanyHeader symbol={symbol} quote={null} />
        <StockNav symbol={symbol} active="overview" />
        <section className="empty-state" role="status">
          <span className="empty-state-icon" aria-hidden="true">!</span>
          <div>
            <h2>We couldn&apos;t load {symbol}</h2>
            <p>
              {overview.reason === "no-data" || overview.reason === "plan-restricted" || overview.reason === "rate-limited"
                // A plan restriction or limit only gets here when Finnhub has no quote either.
                ? `Neither FMP nor Finnhub has a quote for ${symbol}. Check the ticker, or search by company name above.`
                : providerFailureMessage(overview.reason, "the quote")}
            </p>
          </div>
        </section>
      </AppShell>
    );
  }

  const data = overview.data;
  const [left, right] = statRows(data);

  return (
    <AppShell contentClassName="dashboard-content" tickerValue={symbol} headerLabel={`${symbol} · Overview`}>
      <QuoteHeader quote={data} currency={data.currency} />

      <StockNav symbol={symbol} active="overview" />

      <div className="overview-main">
        <div className="overview-stats">
          <StatTable rows={left} label={`${symbol} valuation and fundamentals`} />
          <StatTable rows={right} label={`${symbol} trading and analyst data`} />
        </div>
        <div className="overview-chart">
          {history?.ok ? (
            <PriceHistoryChart symbol={symbol} currency={data.currency} prices={history.data} compact />
          ) : (
            <p className="overview-chart-unavailable">
              {providerFailureMessage(history?.reason, "the price history")}
            </p>
          )}
        </div>
      </div>

      <About data={data} />

      <p className="news-footnote">
        {data.quoteSource === "finnhub"
          ? `FMP couldn't provide ${symbol} (its free plan doesn't cover every company and has a daily limit), so the quote comes from Finnhub and the trailing figures from SEC filings; analyst data isn't available${history?.ok ? "" : ", and nor is the price chart"}.`
          : "Quote and statistics from Financial Modeling Prep; growth rates from Finnhub."}{" "}
        {history?.ok && history.source === "tiingo" && "The price chart comes from Tiingo (closes adjusted for splits and dividends). "}
        TTM means trailing twelve months.
        Prices may be delayed. <Link href={`/stock/financials?symbol=${symbol}`}>See the full financials</Link> or{" "}
        <Link href={`/compare?symbols=${symbol}`}>compare {symbol} with other stocks</Link>.
      </p>
    </AppShell>
  );
}
