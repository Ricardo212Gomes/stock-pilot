import { Suspense } from "react";
import { AppShell } from "../../components/app-shell";
import { CompanyHeader } from "../../components/company-header";
import { companyMetadata } from "../../components/company-metadata";
import { StockNav } from "../../components/stock-nav";
import { PriceTargetChart } from "./price-target-chart";
import {
  ACTION_WINDOW_DAYS,
  getAnalystForecast,
  surprise,
  yearGrowth,
  type AnalystForecast,
  type EarningsReport,
  type GradeAction,
} from "@/lib/analyst-forecast";
import { normalizeTicker } from "@/lib/fmp";
import { RATING_KEYS, summarizeRatings } from "@/lib/recommendation-signals";
import { getQuote } from "@/lib/stock-overview";

export const generateMetadata = companyMetadata("Forecast", "Analysts' price targets, ratings, revenue and EPS estimates and earnings surprises for a company.");

const RATING_NAMES: Record<(typeof RATING_KEYS)[number], string> = {
  strongBuy: "Strong Buy",
  buy: "Buy",
  hold: "Hold",
  sell: "Sell",
  strongSell: "Strong Sell",
};

const ACTION_LABELS: Record<GradeAction["action"], string> = {
  upgrade: "Upgrade",
  downgrade: "Downgrade",
  maintain: "Reiterated",
  initiate: "Initiated",
  other: "Changed",
};

type ForecastPageProps = { searchParams: Promise<{ symbol?: string | string[] }> };

function formatDate(iso: string, options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" }): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${iso.slice(0, 10)}T12:00:00Z`));
}

function money(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function bigMoney(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function signedPercent(value: number | null, digits = 1): string {
  return value === null ? "—" : `${value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function tone(value: number | null): string {
  return value === null || value === 0 ? "" : value > 0 ? "positive-value" : "negative-value";
}

function RatingSplit({ counts }: { counts: Record<(typeof RATING_KEYS)[number], number> }) {
  return (
    <span className="rating-bar forecast-rating-bar" aria-hidden="true">
      {RATING_KEYS.filter((key) => counts[key] > 0).map((key) => <span key={key} className={`rating-${key}`} style={{ flexGrow: counts[key] }} />)}
    </span>
  );
}

// Where today's price sits between the lowest and highest targets, with the average marked.
function TargetRange({ low, high, average, price }: { low: number; high: number; average: number; price: number }) {
  const min = Math.min(low, price);
  const max = Math.max(high, price);
  const at = (value: number) => `${((value - min) / (max - min || 1)) * 100}%`;
  return (
    <div className="forecast-range" aria-hidden="true">
      <span className="forecast-range-track" style={{ left: at(low), right: `calc(100% - ${at(high)})` }} />
      <span className="forecast-range-marker forecast-range-average" style={{ left: at(average) }} />
      <span className="forecast-range-marker forecast-range-price" style={{ left: at(price) }} />
      <span className="forecast-range-label" style={{ left: at(low) }}>Low {money(low)}</span>
      <span className="forecast-range-label forecast-range-label-end" style={{ left: at(high) }}>High {money(high)}</span>
    </div>
  );
}

function PriceTargetSection({ forecast, price }: { forecast: AnalystForecast; price: number | null }) {
  const { targets, targetTrend, closes } = forecast;
  if (!targets) return null;
  const upside = price ? targets.consensus / price - 1 : null;
  const lastYear = targetTrend.find((period) => period.label === "Last year");
  return (
    <section className="forecast-section" aria-labelledby="forecast-target-heading">
      <h2 id="forecast-target-heading">Price target</h2>
      <div className="forecast-target">
        <div>
          <p className="forecast-figure">{money(targets.consensus)}</p>
          <p className="forecast-figure-detail">
            Average target{price !== null && <>, <span className={tone(upside)}>{signedPercent(upside)}</span> from {money(price)}</>}
            {lastYear && <> · {lastYear.count} targets set in the last year</>}
          </p>
          <dl className="forecast-stats">
            <div><dt>Low</dt><dd>{money(targets.low)}</dd></div>
            <div><dt>Median</dt><dd>{money(targets.median)}</dd></div>
            <div><dt>High</dt><dd>{money(targets.high)}</dd></div>
          </dl>
          {price !== null && targets.low !== null && targets.high !== null && (
            <>
              <TargetRange low={targets.low} high={targets.high} average={targets.consensus} price={price} />
              <p className="forecast-range-legend" aria-hidden="true">
                <span><span className="forecast-range-dot forecast-range-price" />Today {money(price)}</span>
                <span><span className="forecast-range-dot forecast-range-average" />Average target {money(targets.consensus)}</span>
              </p>
            </>
          )}
        </div>
        {targetTrend.length > 0 && (
          <table className="forecast-trend">
            <caption>Average of the targets set in the</caption>
            <tbody>
              {targetTrend.map((period) => (
                <tr key={period.label}>
                  <th scope="row">{period.label}</th>
                  <td>{money(period.average)}</td>
                  <td>{period.count} {period.count === 1 ? "target" : "targets"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {closes.length > 20 && (
        <>
          <h3 className="forecast-subheading">The last year, and where analysts see it in a year</h3>
          <PriceTargetChart closes={closes} targets={targets} />
        </>
      )}
    </section>
  );
}

function RatingsSection({ forecast }: { forecast: AnalystForecast }) {
  const { ratings, ratingMonths } = forecast;
  if (!ratings) return null;
  return (
    <section className="forecast-section" aria-labelledby="forecast-ratings-heading">
      <h2 id="forecast-ratings-heading">Analyst ratings</h2>
      <p className="forecast-figure">{ratings.label}</p>
      <p className="forecast-figure-detail">
        {Math.round(ratings.buyShare * 100)}% of {ratings.total} analysts rate it Buy or Strong Buy · average {ratings.mean.toFixed(2)} on a scale from 1 (Strong Buy) to 5 (Strong Sell)
      </p>
      <p className="rating-legend" aria-hidden="true">
        {RATING_KEYS.map((key) => <span key={key}><span className={`rating-swatch rating-${key}`} />{RATING_NAMES[key]}</span>)}
      </p>
      <table className="forecast-months">
        <caption className="visually-hidden">Analysts&apos; ratings by month</caption>
        <tbody>
          {ratingMonths.map((month) => {
            const summary = summarizeRatings([month]);
            return (
              <tr key={month.period}>
                <th scope="row">{formatDate(month.period, { month: "short", year: "numeric" })}</th>
                <td><RatingSplit counts={month} /></td>
                <td>
                  {RATING_KEYS.map((key) => `${month[key]} ${RATING_NAMES[key]}`).join(" · ")}
                  {summary && <strong> · {summary.label}</strong>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function EstimatesSection({ forecast }: { forecast: AnalystForecast }) {
  const { estimates } = forecast;
  if (!estimates.some((year) => !year.reported)) return null;
  return (
    <section className="forecast-section" aria-labelledby="forecast-estimates-heading">
      <h2 id="forecast-estimates-heading">Revenue and EPS estimates</h2>
      <p className="forecast-lede">The last two reported years, then analysts&apos; average estimate for each year ahead, with the lowest and highest.</p>
      <div className="table-scroll">
        <table className="financial-table forecast-table">
          <thead>
            <tr>
              <th scope="col">Fiscal year</th>
              <th scope="col">Revenue</th>
              <th scope="col">Growth</th>
              <th scope="col">EPS</th>
              <th scope="col">Growth</th>
              <th scope="col" className="forecast-optional">Analysts</th>
            </tr>
          </thead>
          <tbody>
            {estimates.map((year, index) => {
              const previous = estimates[index - 1];
              const revenueGrowth = previous ? yearGrowth(year.revenue, previous.revenue) : null;
              const epsGrowth = previous ? yearGrowth(year.eps, previous.eps) : null;
              return (
                <tr key={year.date} className={year.reported ? "forecast-reported" : ""}>
                  <th scope="row">
                    {year.year}
                    <small>{year.reported ? "Reported" : "Estimate"}</small>
                  </th>
                  <td>
                    {bigMoney(year.revenue)}
                    {year.revenueLow !== null && year.revenueHigh !== null && <small>{bigMoney(year.revenueLow)}–{bigMoney(year.revenueHigh)}</small>}
                  </td>
                  <td className={tone(revenueGrowth)}>{signedPercent(revenueGrowth)}</td>
                  <td>
                    {money(year.eps)}
                    {year.epsLow !== null && year.epsHigh !== null && <small>{money(year.epsLow)}–{money(year.epsHigh)}</small>}
                  </td>
                  <td className={tone(epsGrowth)}>{signedPercent(epsGrowth)}</td>
                  <td className="forecast-optional">{year.analysts ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SurpriseCell({ actual, estimate, format }: { actual: number | null; estimate: number | null; format: (value: number | null) => string }) {
  const gap = surprise(actual, estimate);
  return (
    <td>
      {format(actual)}
      {gap !== null && <small className={tone(gap)}>{gap >= 0 ? "Beat" : "Missed"} by {Math.abs(gap * 100).toFixed(1)}%</small>}
    </td>
  );
}

function EarningsSection({ forecast }: { forecast: AnalystForecast }) {
  const { earnings } = forecast;
  if (!earnings || (earnings.past.length === 0 && !earnings.upcoming)) return null;
  const withRevenue = earnings.past.some((report: EarningsReport) => report.revenueActual !== null || report.revenueEstimate !== null);
  return (
    <section className="forecast-section" aria-labelledby="forecast-earnings-heading">
      <h2 id="forecast-earnings-heading">Earnings</h2>
      {earnings.upcoming && (
        <p className="forecast-next">
          Next report <strong>{formatDate(earnings.upcoming.date)}</strong>
          {earnings.upcoming.epsEstimate !== null && <> · EPS estimate <strong>{money(earnings.upcoming.epsEstimate)}</strong></>}
          {earnings.upcoming.revenueEstimate !== null && <> · revenue estimate <strong>{bigMoney(earnings.upcoming.revenueEstimate)}</strong></>}
        </p>
      )}
      {earnings.past.length > 0 && (
        <div className="table-scroll">
          <table className="financial-table forecast-table">
            <thead>
              <tr>
                <th scope="col">{earnings.source === "fmp" ? "Reported" : "Quarter ended"}</th>
                <th scope="col">EPS estimate</th>
                <th scope="col">EPS</th>
                {withRevenue && <th scope="col" className="forecast-optional">Revenue estimate</th>}
                {withRevenue && <th scope="col">Revenue</th>}
              </tr>
            </thead>
            <tbody>
              {earnings.past.map((report) => (
                <tr key={report.date}>
                  <th scope="row">{formatDate(report.date)}</th>
                  <td>{money(report.epsEstimate)}</td>
                  <SurpriseCell actual={report.epsActual} estimate={report.epsEstimate} format={money} />
                  {withRevenue && <td className="forecast-optional">{bigMoney(report.revenueEstimate)}</td>}
                  {withRevenue && <SurpriseCell actual={report.revenueActual} estimate={report.revenueEstimate} format={bigMoney} />}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ActionsSection({ forecast }: { forecast: AnalystForecast }) {
  const { actions, actionCounts } = forecast;
  if (actions.length === 0) return null;
  const { upgrades, downgrades, maintains } = actionCounts;
  return (
    <section className="forecast-section" aria-labelledby="forecast-actions-heading">
      <h2 id="forecast-actions-heading">Rating changes</h2>
      <p className="forecast-lede">
        Last {ACTION_WINDOW_DAYS} days: <strong className={upgrades > 0 ? "positive-value" : ""}>{upgrades} {upgrades === 1 ? "upgrade" : "upgrades"}</strong>,{" "}
        <strong className={downgrades > 0 ? "negative-value" : ""}>{downgrades} {downgrades === 1 ? "downgrade" : "downgrades"}</strong> and {maintains} reiterated.
      </p>
      <div className="table-scroll">
        <table className="financial-table forecast-table forecast-actions">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Firm</th>
              <th scope="col">Action</th>
              <th scope="col">Rating</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((action) => (
              <tr key={`${action.date}-${action.firm}-${action.grade}`}>
                <td>{formatDate(action.date)}</td>
                <th scope="row">{action.firm}</th>
                <td><span className={`forecast-action forecast-action-${action.action}`}>{ACTION_LABELS[action.action]}</span></td>
                <td>{action.previous && action.previous !== action.grade ? <>{action.previous} → <strong>{action.grade}</strong></> : <strong>{action.grade}</strong>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

async function ForecastBody({ symbol, price }: { symbol: string; price: number | null }) {
  const forecast = await getAnalystForecast(symbol);
  const empty = !forecast.targets && !forecast.ratings && forecast.estimates.length === 0 && !forecast.earnings && forecast.actions.length === 0;
  if (empty) {
    return (
      <section className="empty-state empty-state-info" role="status">
        <span className="empty-state-icon" aria-hidden="true">i</span>
        <div>
          <h2>No analyst forecasts for {symbol}</h2>
          <p>Neither FMP nor Finnhub has price targets, ratings or estimates for it. Smaller companies often have no analyst coverage.</p>
        </div>
      </section>
    );
  }
  return (
    <>
      <PriceTargetSection forecast={forecast} price={price} />
      <RatingsSection forecast={forecast} />
      <EstimatesSection forecast={forecast} />
      <EarningsSection forecast={forecast} />
      <ActionsSection forecast={forecast} />
      <div className="news-footnote forecast-footnote">
        <p>
          Price targets, their trend, estimates, rating changes and earnings come from Financial Modeling Prep; ratings by month
          {forecast.earnings?.source === "finnhub" ? " and earnings surprises" : ""} from Finnhub. Analysts&apos; targets are for
          twelve months out and are often optimistic; estimates change as the year goes on.
        </p>
        {!forecast.fmpCovered && (
          <p>FMP&apos;s plan doesn&apos;t cover {symbol}&apos;s price targets, estimates or rating changes, so only Finnhub&apos;s ratings and earnings are shown.</p>
        )}
      </div>
    </>
  );
}

export default async function ForecastPage({ searchParams }: ForecastPageProps) {
  const raw = (await searchParams).symbol;
  const symbol = normalizeTicker(Array.isArray(raw) ? raw[0] : raw) ?? "AAPL";
  const quote = await getQuote(symbol);

  return (
    <AppShell contentClassName="dashboard-content" tickerValue={symbol} headerLabel={`${symbol} · Forecast`} dataSource="Analyst data from Financial Modeling Prep and Finnhub">
      <CompanyHeader symbol={symbol} quote={quote} />
      <StockNav symbol={symbol} active="forecast" />
      <Suspense fallback={<p className="forecast-loading" role="status">Loading analysts&apos; forecasts for {symbol}…</p>}>
        <ForecastBody symbol={symbol} price={quote.ok ? quote.data.price : null} />
      </Suspense>
    </AppShell>
  );
}
