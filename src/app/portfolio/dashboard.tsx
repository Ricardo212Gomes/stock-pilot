import Link from "next/link";
import { CompanyLogo } from "../components/company-logo";
import type { Currency } from "@/lib/fx";
import {
  BENCHMARK,
  formatDay,
  formatShares,
  MAX_SYMBOLS,
  type HistoryIssue,
  type PortfolioView,
  type Split,
  type Trade,
} from "@/lib/portfolio";
import { formatMoney, formatPercent, formatSignedPercent } from "@/lib/valuation/format";
import { CurrencySwitch } from "./currency-switch";
import { DeleteAllTrades } from "./delete-all-trades";
import { DeleteTradeButton } from "./delete-trade-button";
import { ImportStatement } from "./import-statement";
import { PerformanceChart } from "./performance-chart";
import { TradeForm } from "./trade-form";

// The Portfolio page's content once the trades are priced (see lib/portfolio.ts).

// Trades shown at first; the rest are a click away.
const TRADE_ROWS = 100;

function signedMoney(value: number, currency: Currency): string {
  return `${value > 0 ? "+" : ""}${formatMoney(value, currency)}`;
}

function tone(value: number | null): string {
  return value === null || Math.abs(value) < 1e-9 ? "" : value > 0 ? "positive-value" : "negative-value";
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function list(items: string[]): string {
  return items.length <= 2 ? items.join(" and ") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// "10-for-1", or "1-for-8" for a reverse split.
function splitRatio(factor: number): string {
  return factor >= 1 ? `${formatShares(factor)}-for-1` : `1-for-${formatShares(1 / factor)}`;
}

function splitNote(splits: Split[]): string {
  return splits.length === 1 ? `after the ${splitRatio(splits[0].factor)} split on ${formatDay(splits[0].date)}` : `after ${splits.length} splits`;
}

function historyMessage(issue: HistoryIssue): string {
  switch (issue.kind) {
    case "no-tiingo":
      return "The chart needs Tiingo's daily prices, and so do splits and dividends: add TIINGO_API_KEY to the environment file (see docs/data-fallbacks.md).";
    case "missing":
      return `Tiingo didn't send prices for ${list(issue.symbols)}, which the chart needs. If it was Tiingo's limit of 50 requests an hour, they'll be back within the hour.`;
    case "too-new":
      return "The chart starts once your first trade has a close behind it. Check back after the market closes.";
    case "nothing-priced":
      return "The chart follows the companies StockPilot has prices for, and none of yours has them: they were sold before they were imported.";
  }
}

// "Oct 2026".
function formatMonth(month: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${month}-15T12:00:00Z`));
}

// A company with prices links to its page; an instrument without them shows the broker's code, and its name or
// ISIN.
function CompanyCell({ symbol, label, name, priced }: { symbol: string; label: string; name: string; priced: boolean }) {
  if (!priced) {
    return (
      <span className="favorites-company portfolio-unpriced">
        <span>
          <strong>{label}</strong>
          {name !== label && <small>{name}</small>}
        </span>
      </span>
    );
  }
  return (
    <Link className="favorites-company" href={`/stock?symbol=${encodeURIComponent(symbol)}`}>
      <span className="earnings-logo-box"><CompanyLogo symbol={symbol} /></span>
      <span>
        <strong>{symbol}</strong>
        {name !== symbol && <small>{name}</small>}
      </span>
    </Link>
  );
}

function SummaryCards({ view }: { view: PortfolioView }) {
  const { totals, holdings, currency } = view;
  const income = totals.annualIncome;
  return (
    <div className="portfolio-cards">
      <section className="portfolio-card" aria-label="Value">
        <p className="portfolio-card-label">Value</p>
        <p className="portfolio-card-value">{formatMoney(totals.value, currency)}</p>
        <p className="portfolio-card-detail">{plural(holdings.length, "holding")}, bought for {formatMoney(totals.cost, currency)}</p>
      </section>
      <section className="portfolio-card" aria-label="Today">
        <p className="portfolio-card-label">Today</p>
        <p className={`portfolio-card-value ${tone(totals.dayChange)}`}>{totals.dayChange === null ? "—" : signedMoney(totals.dayChange, currency)}</p>
        <p className="portfolio-card-detail">
          {totals.dayChangePercent === null ? "No live prices just now." : formatSignedPercent(totals.dayChangePercent)}
          {totals.stalePrices > 0 && totals.dayChange !== null && ` · ${plural(totals.stalePrices, "holding")} at the last close`}
        </p>
      </section>
      <section className="portfolio-card" aria-label="Profit">
        <p className="portfolio-card-label">Profit</p>
        <p className={`portfolio-card-value ${tone(totals.profit)}`}>{signedMoney(totals.profit, currency)}</p>
        <dl className="portfolio-card-breakdown">
          <div>
            <dt>Holdings</dt>
            <dd className={tone(totals.gain)}>{signedMoney(totals.gain, currency)} <small>{formatSignedPercent(totals.gainPercent)}</small></dd>
          </div>
          <div>
            <dt>Sales</dt>
            <dd className={tone(totals.realized)}>{signedMoney(totals.realized, currency)}</dd>
          </div>
          <div>
            <dt>Dividends</dt>
            <dd>{formatMoney(totals.dividends, currency)}</dd>
          </div>
          {Math.abs(totals.interest) >= 0.005 && (
            <div>
              <dt>Interest</dt>
              <dd>{formatMoney(totals.interest, currency)}</dd>
            </div>
          )}
        </dl>
      </section>
      <section className="portfolio-card" aria-label="Dividends">
        <p className="portfolio-card-label">Dividends a year</p>
        <p className="portfolio-card-value">{income === null ? "—" : formatMoney(income, currency)}</p>
        <p className="portfolio-card-detail">
          {income === null
            ? "Dividends need Tiingo's prices."
            : income > 0
              ? `${formatPercent(totals.incomeYield)} yield, at the last 12 months' payouts`
              : "None of your holdings paid one in the last 12 months."}

        </p>
      </section>
    </div>
  );
}

function Holdings({ view }: { view: PortfolioView }) {
  const { holdings, closed, totals, currency } = view;
  const closedRealized = closed.reduce((total, position) => total + position.realized, 0);
  return (
    <section className="portfolio-section" aria-labelledby="portfolio-holdings-heading">
      <h2 id="portfolio-holdings-heading">Holdings</h2>
      {holdings.length === 0 ? (
        <p className="portfolio-empty">You&apos;ve sold everything you bought; your closed positions are below.</p>
      ) : (
        <div className="table-scroll">
          <table className="financial-table portfolio-table">
            <thead>
              <tr>
                <th scope="col">Company</th>
                <th scope="col" className="portfolio-optional">Shares</th>
                <th scope="col" className="portfolio-optional">Avg cost</th>
                <th scope="col" className="portfolio-optional">Price</th>
                <th scope="col" className="portfolio-optional">Today</th>
                <th scope="col">Value</th>
                <th scope="col" className="portfolio-optional">Gain</th>
                <th scope="col" className="portfolio-optional">Weight</th>
              </tr>
            </thead>
            <tbody>
              {holdings.map((holding) => (
                <tr key={holding.symbol}>
                  <th scope="row"><CompanyCell symbol={holding.symbol} label={holding.label} name={holding.name} priced={holding.priced} /></th>
                  <td className="portfolio-optional">{formatShares(holding.shares)}</td>
                  <td className="portfolio-optional">{formatMoney(holding.averageCost, currency)}</td>
                  <td className="portfolio-optional">
                    {formatMoney(holding.price, currency)}
                    {holding.priceSource !== "live" && <small>{holding.priceSource === "close" ? "Last close" : "Your last trade"}</small>}
                  </td>
                  <td className={`portfolio-optional ${tone(holding.dayChangePercent)}`}>{formatSignedPercent(holding.dayChangePercent)}</td>
                  <td>
                    {formatMoney(holding.value, currency)}
                    <small className={`portfolio-phone-only ${tone(holding.gain)}`}>{signedMoney(holding.gain, currency)} · {formatSignedPercent(holding.gainPercent)}</small>
                  </td>
                  <td className={`portfolio-optional ${tone(holding.gain)}`}>
                    {signedMoney(holding.gain, currency)}
                    <small>{formatSignedPercent(holding.gainPercent)}</small>
                  </td>
                  <td className="portfolio-optional">
                    <span className="portfolio-weight">
                      <span className="portfolio-bar" aria-hidden="true"><span style={{ width: `${holding.weight * 100}%` }} /></span>
                      {formatPercent(holding.weight)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td className="portfolio-optional" colSpan={3} />
                <td className={`portfolio-optional ${tone(totals.dayChangePercent)}`}>{formatSignedPercent(totals.dayChangePercent)}</td>
                <td>
                  {formatMoney(totals.value, currency)}
                  <small className={`portfolio-phone-only ${tone(totals.gain)}`}>{signedMoney(totals.gain, currency)} · {formatSignedPercent(totals.gainPercent)}</small>
                </td>
                <td className={`portfolio-optional ${tone(totals.gain)}`}>
                  {signedMoney(totals.gain, currency)}
                  <small>{formatSignedPercent(totals.gainPercent)}</small>
                </td>
                <td className="portfolio-optional" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {closed.length > 0 && (
        <details className="portfolio-closed-details" open={closed.length <= 10}>
          <summary>
            Closed positions: {closed.length} · <span className={tone(closedRealized)}>{signedMoney(closedRealized, currency)}</span> realized
          </summary>
          <div className="table-scroll">
            <table className="financial-table portfolio-table portfolio-closed">
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col" className="portfolio-optional">Last sale</th>
                  <th scope="col">Realized</th>
                  <th scope="col">Dividends</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((position) => (
                  <tr key={position.symbol}>
                    <th scope="row"><CompanyCell symbol={position.symbol} label={position.label} name={position.name} priced={position.priced} /></th>
                    <td className="portfolio-optional">{formatDay(position.soldOn)}</td>
                    <td className={tone(position.realized)}>{signedMoney(position.realized, currency)}</td>
                    <td>{position.dividends >= 0.005 ? formatMoney(position.dividends, currency) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

function Industries({ view }: { view: PortfolioView }) {
  if (view.industries.length === 0) return null;
  const { currency } = view;
  return (
    <section className="portfolio-section" aria-labelledby="portfolio-industries-heading">
      <h2 id="portfolio-industries-heading">By industry</h2>
      <ul className="portfolio-industries">
        {view.industries.map((industry) => (
          <li key={industry.name}>
            <span className="portfolio-industry-name">{industry.name}</span>
            <span className="portfolio-bar" aria-hidden="true"><span style={{ width: `${industry.weight * 100}%` }} /></span>
            <span className="portfolio-industry-weight">{formatPercent(industry.weight)}</span>
            <span className="portfolio-industry-value">{formatMoney(industry.value, currency, true)}</span>
          </li>
        ))}
      </ul>
      <p className="portfolio-note">Industries are Finnhub&apos;s. Funds and ETFs count as Funds, whatever they hold.</p>
    </section>
  );
}

function tradeLabel(trade: Trade & { label: string }): string {
  return `${trade.side === "buy" ? "buy" : "sale"} of ${formatShares(trade.shares)} ${trade.label} on ${formatDay(trade.date)}`;
}

// Imported dividends and interest, month by month, newest first.
function Income({ view }: { view: PortfolioView }) {
  if (view.income.length === 0) return null;
  const { currency } = view;
  const months = [...view.income].reverse();
  const dividends = view.income.reduce((total, month) => total + month.dividends, 0);
  const interest = view.income.reduce((total, month) => total + month.interest, 0);
  return (
    <section className="portfolio-section" aria-labelledby="portfolio-income-heading">
      <h2 id="portfolio-income-heading">Dividends and interest</h2>
      <p className="portfolio-note">From your statements: dividends after withholding tax, and interest on cash.</p>
      <div className="table-scroll">
        <table className="financial-table portfolio-table portfolio-income">
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Dividends</th>
              <th scope="col">Interest</th>
              <th scope="col" className="portfolio-optional">Total</th>
            </tr>
          </thead>
          <tbody>
            {months.map((month) => (
              <tr key={month.month}>
                <th scope="row">{formatMonth(month.month)}</th>
                <td>{month.dividends >= 0.005 ? formatMoney(month.dividends, currency) : "—"}</td>
                <td>{Math.abs(month.interest) >= 0.005 ? formatMoney(month.interest, currency) : "—"}</td>
                <td className="portfolio-optional">{formatMoney(month.dividends + month.interest, currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Total</th>
              <td>{formatMoney(dividends, currency)}</td>
              <td>{formatMoney(interest, currency)}</td>
              <td className="portfolio-optional">{formatMoney(dividends + interest, currency)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function Trades({ view, showAll }: { view: PortfolioView; showAll: boolean }) {
  const { currency } = view;
  const shown = showAll ? view.trades : view.trades.slice(0, TRADE_ROWS);
  return (
    <section className="portfolio-section" aria-labelledby="portfolio-trades-heading">
      <div className="portfolio-section-heading">
        <h2 id="portfolio-trades-heading">Trades</h2>
        <DeleteAllTrades count={view.trades.length} />
      </div>
      <TradeForm today={view.today} defaultCurrency={currency} />
      <ImportStatement />
      <div className="table-scroll">
        <table className="financial-table portfolio-table portfolio-trades">
          <thead>
            <tr>
              <th scope="col" className="portfolio-optional">Date</th>
              <th scope="col" className="portfolio-optional">Trade</th>
              <th scope="col">Company</th>
              <th scope="col">Shares</th>
              <th scope="col" className="portfolio-optional">Price</th>
              <th scope="col" className="portfolio-optional">Amount</th>
              <th scope="col" className="portfolio-optional">Gain</th>
              <th scope="col"><span className="visually-hidden">Delete</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((trade) => (
              <tr key={trade.id}>
                <td className="portfolio-optional">{formatDay(trade.date)}</td>
                <td className="portfolio-optional"><span className={`portfolio-badge portfolio-badge-${trade.side}`}>{trade.side === "buy" ? "Buy" : "Sell"}</span></td>
                <th scope="row">
                  {/* Phones fold the trade and its date into this cell. */}
                  <span className={`portfolio-badge portfolio-badge-${trade.side} portfolio-phone-badge`}>{trade.side === "buy" ? "Buy" : "Sell"}</span>
                  {trade.priced === false ? <strong>{trade.label}</strong> : <Link href={`/stock?symbol=${encodeURIComponent(trade.symbol)}`}>{trade.symbol}</Link>}
                  {trade.name !== trade.label && <small className="portfolio-optional">{trade.name}</small>}
                  <small className="portfolio-phone-only">{formatDay(trade.date)}</small>
                </th>
                <td>
                  {formatShares(trade.shares)}
                  {trade.splits.length > 0 && <small>{formatShares(trade.adjustedShares)} {splitNote(trade.splits)}</small>}
                  {trade.oversold && <small className="negative-value">More than you held then</small>}
                </td>
                <td className="portfolio-optional">{formatMoney(trade.price, trade.currency)}</td>
                <td className="portfolio-optional">{formatMoney(trade.shares * trade.price, trade.currency)}</td>
                <td className={`portfolio-optional ${tone(trade.realized)}`}>{trade.realized === null ? "—" : signedMoney(trade.realized, currency)}</td>
                <td><DeleteTradeButton id={trade.id} label={tradeLabel(trade)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length < view.trades.length && (
        <p className="portfolio-note">
          The latest {shown.length} of {view.trades.length}. <Link href="/portfolio?trades=all" scroll={false}>Show all {view.trades.length} trades</Link>
        </p>
      )}
    </section>
  );
}

export function PortfolioDashboard({ view, showAllTrades = false }: { view: PortfolioView; showAllTrades?: boolean }) {
  return (
    <>
      <CurrencySwitch current={view.currency} />
      <SummaryCards view={view} />
      <section className="portfolio-section" aria-labelledby="portfolio-performance-heading">
        <h2 id="portfolio-performance-heading">Performance</h2>
        {view.history.length > 0 ? (
          <PerformanceChart history={view.history} currency={view.currency} />
        ) : (
          view.historyIssue && <p className="portfolio-empty">{historyMessage(view.historyIssue)}</p>
        )}
        {view.history.length > 0 && view.unpriced > 0 && (
          <p className="portfolio-note">
            The chart follows the companies with prices. It leaves out {view.unpriced} without them (sold before they were imported, or with no
            US listing), whose gains are in the profit.
          </p>
        )}
      </section>
      <Holdings view={view} />
      <Industries view={view} />
      <Income view={view} />
      <Trades view={view} showAll={showAllTrades} />
      <div className="news-footnote portfolio-footnote">
        <p>
          Live prices are Finnhub&apos;s, a minute old at most; daily closes, splits and dividends are Tiingo&apos;s. Holdings are
          at average cost, and trades from before a split count in today&apos;s shares. Today&apos;s change applies the day&apos;s
          move to every share you hold. The profit adds the gain on your holdings, the gains on what you sold, dividends and
          interest. Imported companies&apos; dividends are your statements&apos;, after withholding tax; the others&apos; are counted
          from Tiingo&apos;s ex-dividend dates, before tax.
          {view.currency === "EUR" && " Prices are in dollars, converted at the ECB's rate for each day; trades keep the currency they were paid in."}
        </p>
        <p>
          Returns are each day&apos;s change on what you held, with dividends reinvested, so money you add or take out
          isn&apos;t counted as a gain or a loss. The S&amp;P 500 is the SPDR S&amp;P 500 ETF ({BENCHMARK}), with its dividends.
          Up to {MAX_SYMBOLS} tickers.
        </p>
      </div>
    </>
  );
}
