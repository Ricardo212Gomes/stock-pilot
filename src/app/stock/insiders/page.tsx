import Link from "next/link";
import { Suspense } from "react";
import { AppShell } from "../../components/app-shell";
import { CompanyHeader } from "../../components/company-header";
import { companyMetadata } from "../../components/company-metadata";
import { StockNav } from "../../components/stock-nav";
import { InsiderChart } from "./insider-chart";
import { finnhubFailureMessage } from "@/lib/finnhub";
import { normalizeTicker } from "@/lib/fmp";
import { getInsiderActivity, type InsiderTransaction } from "@/lib/insiders";
import { getQuote } from "@/lib/stock-overview";

export const generateMetadata = companyMetadata("Insiders", "What a company's executives, directors and big holders bought and sold, from their SEC Form 4 filings.");

const VIEWS = [
  { id: "trades", label: "Buys and sales" },
  { id: "all", label: "All transactions" },
] as const;

type View = (typeof VIEWS)[number]["id"];

// Enough for a year of a busy company's trades; the rest are a click away on EDGAR.
const ROW_LIMIT = 100;

type InsidersPageProps = {
  searchParams: Promise<{ symbol?: string | string[]; view?: string | string[] }>;
};

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
}

// Same options as the chart's, so the two read alike ("$20M", "$7.5M").
function compactMoney(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(value);
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function count(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function plural(value: number, word: string): string {
  return `${count(value)} ${word}${value === 1 ? "" : "s"}`;
}

function TransactionBadge({ transaction }: { transaction: InsiderTransaction }) {
  return (
    <span className="insider-kind">
      <span className={`insider-badge insider-badge-${transaction.kind}`}>{transaction.label}</span>
      {transaction.planned && (
        <span className="insider-planned" title="Made under a Rule 10b5-1 plan set up in advance, so the timing wasn't the insider's call that day.">10b5-1 plan</span>
      )}
    </span>
  );
}

async function InsiderBody({ symbol, view }: { symbol: string; view: View }) {
  const result = await getInsiderActivity(symbol);
  if (!result.ok) {
    return (
      <section className="empty-state" role="status">
        <span className="empty-state-icon" aria-hidden="true">!</span>
        <div>
          <h2>We couldn&apos;t load the insider trades</h2>
          <p>{finnhubFailureMessage(result.reason, "the insider trades")}</p>
        </div>
      </section>
    );
  }

  const { transactions, summary, months, people, from, filingsRead } = result.data;
  if (transactions.length === 0) {
    return (
      <section className="empty-state empty-state-info" role="status">
        <span className="empty-state-icon" aria-hidden="true">i</span>
        <div>
          <h2>No insider filings in the last year</h2>
          <p>None of {symbol}&apos;s executives, directors or 10% holders reported a transaction since {formatDate(from)}.</p>
        </div>
      </section>
    );
  }

  const { buys, sales } = summary;
  // People who only received awards, exercised options or gave gifts are counted, not listed.
  const traders = people.filter((person) => person.trades > 0);
  const others = people.length - traders.length;
  const net = buys.value - sales.value;
  const trades = transactions.filter((transaction) => transaction.kind === "buy" || transaction.kind === "sale");
  const listed = view === "all" ? transactions : trades;
  const rows = listed.slice(0, ROW_LIMIT);

  return (
    <>
      <div className="insider-cards">
        <section className="insider-card" aria-label="Bought in the market">
          <p className="insider-card-label">Bought in the market</p>
          <p className="insider-card-value">{buys.count > 0 ? compactMoney(buys.value) : "None"}</p>
          <p className="insider-card-detail">{buys.count > 0 ? `${plural(buys.count, "buy")} by ${plural(buys.insiders, "insider")}` : "No open-market buys in the last year."}</p>
        </section>
        <section className="insider-card" aria-label="Sold in the market">
          <p className="insider-card-label">Sold in the market</p>
          <p className="insider-card-value">{sales.count > 0 ? compactMoney(sales.value) : "None"}</p>
          <p className="insider-card-detail">
            {sales.count > 0 ? `${plural(sales.count, "sale")} by ${plural(sales.insiders, "insider")}` : "No open-market sales in the last year."}
            {sales.plannedValue > 0 && <><br />{compactMoney(sales.plannedValue)} ({Math.round((sales.plannedValue / sales.value) * 100)}%) under 10b5-1 plans</>}
          </p>
        </section>
        <section className="insider-card" aria-label="Net">
          <p className="insider-card-label">Net</p>
          <p className={`insider-card-value ${net > 0 ? "positive-value" : net < 0 ? "negative-value" : ""}`}>
            {net === 0 ? "$0" : `${net > 0 ? "+" : "−"}${compactMoney(Math.abs(net))}`}
          </p>
          <p className="insider-card-detail">
            {net > 0 ? "Insiders bought more than they sold." : net < 0 ? "Insiders sold more than they bought." : "No trades in the market."}
          </p>
        </section>
      </div>

      <section className="insider-section" aria-labelledby="insider-chart-heading">
        <h2 id="insider-chart-heading">Trades in the market by month</h2>
        <InsiderChart months={months} />
      </section>

      <section className="insider-section" aria-labelledby="insider-people-heading">
        <h2 id="insider-people-heading">Who&apos;s trading</h2>
        {traders.length === 0 ? (
          <p className="insider-empty">Nobody bought or sold in the market in the last year.</p>
        ) : (
          <div className="table-scroll">
            <table className="financial-table insider-table">
              <thead>
                <tr>
                  <th scope="col">Insider</th>
                  <th scope="col">Trades</th>
                  <th scope="col">Bought</th>
                  <th scope="col">Sold</th>
                  <th scope="col" className="insider-optional">Shares held</th>
                  <th scope="col" className="insider-optional">Last filing</th>
                </tr>
              </thead>
              <tbody>
                {traders.map((person) => (
                  <tr key={person.name}>
                    <th scope="row">
                      <span className="insider-name">{person.name}</span>
                      {person.role && <small>{person.role}</small>}
                    </th>
                    <td>{person.trades}</td>
                    <td className={person.bought > 0 ? "positive-value" : ""}>{person.bought > 0 ? compactMoney(person.bought) : "—"}</td>
                    <td className={person.sold > 0 ? "negative-value" : ""}>{person.sold > 0 ? compactMoney(person.sold) : "—"}</td>
                    <td className="insider-optional">{person.owned === null ? "—" : count(person.owned)}</td>
                    <td className="insider-optional">{formatDate(person.lastDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {others > 0 && (
          <p className="insider-others">
            {plural(others, "other insider")} only received awards, exercised options, had shares withheld for tax or gave gifts.
          </p>
        )}
      </section>

      <section className="insider-section" aria-labelledby="insider-trades-heading">
        <div className="insider-trades-heading">
          <h2 id="insider-trades-heading">Transactions</h2>
          <nav className="statement-tabs" aria-label="Transactions to show">
            {VIEWS.map((item) => (
              <Link
                key={item.id}
                href={`/stock/insiders?${new URLSearchParams({ symbol, ...(item.id === "all" ? { view: "all" } : {}) })}`}
                className={item.id === view ? "statement-tab-active" : ""}
                aria-current={item.id === view ? "page" : undefined}
                scroll={false}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        {rows.length === 0 ? (
          <p className="insider-empty">No buys or sales in the market in the last year; switch to All transactions for awards, exercises and gifts.</p>
        ) : (
          <div className="table-scroll">
            <table className="financial-table insider-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Insider</th>
                  <th scope="col">Transaction</th>
                  <th scope="col">Shares</th>
                  <th scope="col" className="insider-optional">Price</th>
                  <th scope="col">Value</th>
                  <th scope="col" className="insider-optional">Held after</th>
                  <th scope="col" className="insider-optional"><span className="visually-hidden">Filing</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((transaction) => (
                  <tr key={transaction.id}>
                    <td className="insider-date">
                      {formatDate(transaction.date)}
                      {transaction.filed !== transaction.date && <small>Filed {formatDate(transaction.filed)}</small>}
                    </td>
                    <th scope="row">
                      <span className="insider-name">{transaction.name}</span>
                      {transaction.role && <small>{transaction.role}</small>}
                    </th>
                    <td><TransactionBadge transaction={transaction} /></td>
                    <td className={transaction.shares > 0 ? "positive-value" : "negative-value"}>
                      {transaction.shares > 0 ? "+" : "−"}{count(Math.abs(transaction.shares))}
                    </td>
                    <td className="insider-optional">{transaction.price === null ? "—" : money(transaction.price)}</td>
                    <td>{transaction.value === null ? "—" : compactMoney(transaction.value)}</td>
                    <td className="insider-optional">{transaction.ownedAfter === null ? "—" : count(transaction.ownedAfter)}</td>
                    <td className="insider-optional filing-links">
                      {transaction.filingUrl && <a href={transaction.filingUrl} target="_blank" rel="noreferrer">Form 4</a>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {listed.length > rows.length && (
          <p className="news-footnote">
            Showing the latest {ROW_LIMIT} of {listed.length}. The rest are among the{" "}
            <Link href={`/stock/filings?${new URLSearchParams({ symbol, type: "insider" })}`}>insider filings</Link>.
          </p>
        )}
      </section>

      <div className="news-footnote insider-footnote">
        <p>
          Executives, directors and holders of 10% or more report each transaction on an SEC Form 4 within two business
          days. Trades come from Finnhub, which reads those filings; roles and 10b5-1 plans come from the filings themselves
          (the latest {filingsRead}). Since {formatDate(from)}.
        </p>
        <p>
          Buys and sales are trades in the market at the insider&apos;s own choosing. Awards, option exercises, shares
          withheld for tax and gifts come with pay, and say less about the price. A sale under a 10b5-1 plan was scheduled
          months ahead, so it says little about the insider&apos;s view; a buy in the market is the strongest signal.
        </p>
      </div>
    </>
  );
}

export default async function InsidersPage({ searchParams }: InsidersPageProps) {
  const params = await searchParams;
  const symbol = normalizeTicker(single(params.symbol)) ?? "AAPL";
  const view: View = single(params.view) === "all" ? "all" : "trades";
  const quote = await getQuote(symbol);

  return (
    <AppShell contentClassName="dashboard-content" tickerValue={symbol} headerLabel={`${symbol} · Insiders`} dataSource="Insider trades from Finnhub and SEC EDGAR">
      <CompanyHeader symbol={symbol} quote={quote} />
      <StockNav symbol={symbol} active="insiders" />
      <Suspense fallback={<p className="insider-loading" role="status">Reading {symbol}&apos;s insider filings…</p>}>
        <InsiderBody symbol={symbol} view={view} />
      </Suspense>
    </AppShell>
  );
}
