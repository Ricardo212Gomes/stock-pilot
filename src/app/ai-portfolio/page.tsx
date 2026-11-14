import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppShell } from "../components/app-shell";
import { CompanyLogo } from "../components/company-logo";
import { PerformanceChart } from "../portfolio/performance-chart";
import { alpacaFailureMessage } from "@/lib/alpaca";
import { RULES, type MoveAction } from "@/lib/ai-portfolio/rules";
import type { StoredMove, StoredRun } from "@/lib/ai-portfolio/store";
import { getAiPortfolio, type AiPortfolioView } from "@/lib/ai-portfolio/view";
import { listedName } from "@/lib/listed-companies";
import { formatDay } from "@/lib/portfolio";
import { formatMoney, formatPercent, formatSignedPercent } from "@/lib/valuation/format";

export const metadata: Metadata = {
  title: "AI portfolio — StockPilot",
  description: "A paper-money portfolio that Gemini rebalances every week from StockPilot's data, with the reason for every move.",
};

const ACTION_LABELS: Record<MoveAction, string> = { buy: "Buy", add: "Add", hold: "Hold", trim: "Trim", sell: "Sell" };

function tone(value: number | null): string {
  return value === null || Math.abs(value) < 1e-9 ? "" : value > 0 ? "positive-value" : "negative-value";
}

function signedMoney(value: number): string {
  return `${value > 0 ? "+" : ""}${formatMoney(value, "USD")}`;
}

function shares(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function Notice({ title, children, icon = "i" }: { title: string; children: React.ReactNode; icon?: string }) {
  return (
    <section className={`empty-state${icon === "i" ? " empty-state-info" : ""}`} role="status">
      <span className="empty-state-icon" aria-hidden="true">{icon}</span>
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}

function Company({ symbol, name }: { symbol: string; name: string | null }) {
  return (
    <Link className="favorites-company" href={`/stock?symbol=${encodeURIComponent(symbol)}`}>
      <span className="earnings-logo-box"><CompanyLogo symbol={symbol} /></span>
      <span>
        <strong>{symbol}</strong>
        {name && <small>{name}</small>}
      </span>
    </Link>
  );
}

function SummaryCards({ view }: { view: AiPortfolioView }) {
  const { account, history, positions } = view;
  const today = account.equity - account.lastEquity;
  const first = history[0];
  const last = history[history.length - 1];
  const growth = first && last ? last.growth / first.growth - 1 : null;
  const spy = first?.benchmark && last?.benchmark ? last.benchmark / first.benchmark - 1 : null;
  return (
    <div className="portfolio-cards">
      <section className="portfolio-card" aria-label="Value">
        <p className="portfolio-card-label">Value</p>
        <p className="portfolio-card-value">{formatMoney(account.equity, "USD")}</p>
        <p className="portfolio-card-detail">{positions.length} position{positions.length === 1 ? "" : "s"}, in paper money</p>
      </section>
      <section className="portfolio-card" aria-label="Today">
        <p className="portfolio-card-label">Today</p>
        <p className={`portfolio-card-value ${tone(today)}`}>{signedMoney(today)}</p>
        <p className="portfolio-card-detail">{account.lastEquity > 0 ? formatSignedPercent(today / account.lastEquity) : "—"}</p>
      </section>
      <section className="portfolio-card" aria-label="Return">
        <p className="portfolio-card-label">Return</p>
        <p className={`portfolio-card-value ${tone(growth)}`}>{growth === null ? "—" : formatSignedPercent(growth)}</p>
        <p className="portfolio-card-detail">
          {growth === null ? "Starts after the first full day." : `Since ${formatDay(first.date)}${spy !== null ? `; S&P 500 ${formatSignedPercent(spy)}` : ""}`}
        </p>
      </section>
      <section className="portfolio-card" aria-label="Cash">
        <p className="portfolio-card-label">Cash</p>
        <p className="portfolio-card-value">{formatMoney(account.cash, "USD")}</p>
        <p className="portfolio-card-detail">{account.equity > 0 ? formatPercent(account.cash / account.equity) : "—"} of the portfolio, at least {formatPercent(RULES.minCash, 0)}</p>
      </section>
    </div>
  );
}

function Positions({ view }: { view: AiPortfolioView }) {
  return (
    <section className="portfolio-section" aria-labelledby="ai-positions-heading">
      <h2 id="ai-positions-heading">Positions</h2>
      {view.positions.length === 0 ? (
        <p className="portfolio-empty">No positions yet: the first weekly run builds the portfolio from cash.</p>
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
              {view.positions.map((position) => (
                <tr key={position.symbol}>
                  <th scope="row"><Company symbol={position.symbol} name={position.name} /></th>
                  <td className="portfolio-optional">{shares(position.qty)}</td>
                  <td className="portfolio-optional">{formatMoney(position.avgEntryPrice, "USD")}</td>
                  <td className="portfolio-optional">{formatMoney(position.currentPrice, "USD")}</td>
                  <td className={`portfolio-optional ${tone(position.changeToday)}`}>{formatSignedPercent(position.changeToday)}</td>
                  <td>
                    {formatMoney(position.marketValue, "USD")}
                    <small className={`portfolio-phone-only ${tone(position.unrealizedPl)}`}>{signedMoney(position.unrealizedPl)} · {formatSignedPercent(position.unrealizedPlpc)}</small>
                  </td>
                  <td className={`portfolio-optional ${tone(position.unrealizedPl)}`}>
                    {signedMoney(position.unrealizedPl)}
                    <small>{formatSignedPercent(position.unrealizedPlpc)}</small>
                  </td>
                  <td className="portfolio-optional">
                    <span className="portfolio-weight">
                      <span className="portfolio-bar" aria-hidden="true"><span style={{ width: `${Math.min(position.weight / RULES.maxWeight, 1) * 100}%` }} /></span>
                      {formatPercent(position.weight)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function orderText(move: StoredMove, run: StoredRun): string {
  if (move.action === "hold") return "—";
  if (move.error) return `Not placed: ${move.error}`;
  if (run.status === "recorded") return "Not placed: trading is off";
  if (run.status === "rejected" || run.status === "failed") return "Not placed";
  if (!move.orderStatus) return "Pending";
  if (move.orderStatus === "filled" && move.filledQty !== null && move.filledPrice !== null) {
    return `Filled: ${shares(move.filledQty)} at ${formatMoney(move.filledPrice, "USD")}`;
  }
  return move.orderStatus.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function MovesTable({ run }: { run: StoredRun }) {
  if (run.moves.length === 0) return null;
  return (
    <div className="table-scroll">
      <table className="financial-table portfolio-table ai-moves">
        <thead>
          <tr>
            <th scope="col">Move</th>
            <th scope="col">Company</th>
            <th scope="col">Weight</th>
            <th scope="col" className="portfolio-optional">Amount</th>
            <th scope="col" className="portfolio-optional">Order</th>
            <th scope="col">Why</th>
          </tr>
        </thead>
        <tbody>
          {run.moves.map((move) => {
            const badge = move.action === "buy" || move.action === "add" ? " portfolio-badge-buy" : move.action === "hold" ? "" : " portfolio-badge-sell";
            return (
              <tr key={move.id}>
                <td><span className={`portfolio-badge${badge}`}>{ACTION_LABELS[move.action]}</span></td>
                <th scope="row"><Company symbol={move.symbol} name={listedName(move.symbol)} /></th>
                <td>{move.action === "hold" ? formatPercent(move.weightAfter) : `${formatPercent(move.weightBefore)} → ${formatPercent(move.weightAfter)}`}</td>
                <td className="portfolio-optional">{move.action === "hold" ? "—" : formatMoney(move.amount, "USD")}</td>
                <td className="portfolio-optional">{orderText(move, run)}</td>
                <td className="ai-move-reason">{move.reason}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_TEXT: Record<StoredRun["status"], string> = {
  placing: "Placing the orders.",
  placed: "Orders placed on the paper account.",
  recorded: "Recorded, not placed: trading is off.",
  rejected: "Rejected by the checks: nothing was traded.",
  failed: "Didn't run: nothing was traded.",
};

function RunDetails({ run }: { run: StoredRun }) {
  return (
    <>
      <p className="portfolio-note">
        <strong>{STATUS_TEXT[run.status]}</strong> Week of {formatDay(run.week)}
        {run.model && `, by ${run.model}`}
        {run.candidates !== null && ` from ${run.candidates} candidates`}.
      </p>
      {run.summary && <p className="ai-run-summary">{run.summary}</p>}
      {run.problems.length > 0 && (
        <ul className="ai-run-problems">
          {run.problems.map((problem) => <li key={problem}>{problem}</li>)}
        </ul>
      )}
      <MovesTable run={run} />
    </>
  );
}

function Moves({ view }: { view: AiPortfolioView }) {
  const [latest, ...earlier] = view.runs;
  return (
    <section className="portfolio-section" aria-labelledby="ai-moves-heading">
      <h2 id="ai-moves-heading">This week&apos;s moves</h2>
      {view.runsNote ? (
        <p className="portfolio-empty">{view.runsNote}</p>
      ) : !latest ? (
        <p className="portfolio-empty">No weekly run yet. The first is on {formatDay(view.nextRebalance)}.</p>
      ) : (
        <RunDetails run={latest} />
      )}
      {earlier.length > 0 && (
        <details className="portfolio-closed-details">
          <summary>Earlier weeks ({earlier.length})</summary>
          {earlier.map((run) => (
            <section key={run.id} className="ai-earlier-run" aria-label={`Week of ${formatDay(run.week)}`}>
              <h3>Week of {formatDay(run.week)}</h3>
              <RunDetails run={run} />
            </section>
          ))}
        </details>
      )}
    </section>
  );
}

async function AiPortfolioBody() {
  // The account is live: render for each request (Alpaca's reads are still cached for a minute).
  await connection();
  const result = await getAiPortfolio();
  if (!result.ok) {
    return result.reason === "not-configured" ? (
      <Notice title="The paper account isn't connected">
        <p>Create a free paper trading account at Alpaca and set ALPACA_API_KEY and ALPACA_SECRET_KEY (see docs/ai-portfolio.md).</p>
      </Notice>
    ) : (
      <Notice title="We couldn't load the AI portfolio" icon="!">
        <p>{alpacaFailureMessage(result.reason)}</p>
      </Notice>
    );
  }
  const { view } = result;
  return (
    <>
      <SummaryCards view={view} />
      <section className="portfolio-section" aria-labelledby="ai-performance-heading">
        <h2 id="ai-performance-heading">Performance</h2>
        {view.history.length > 0 ? (
          <PerformanceChart history={view.history} subject={{ label: "AI portfolio", short: "AI" }} />
        ) : (
          view.historyNote && <p className="portfolio-empty">{view.historyNote}</p>
        )}
        {view.history.length > 0 && view.historyNote && <p className="portfolio-note">{view.historyNote}</p>}
      </section>
      <Positions view={view} />
      <Moves view={view} />
      <div className="news-footnote portfolio-footnote">
        <p>
          A paper trading account at Alpaca: real market prices, virtual money. Once a week Gemini reviews the holdings and
          the Recommendations screen&apos;s best candidates, with their analysts&apos; targets and ratings, price trend and
          headlines, and proposes target weights with a reason for each. StockPilot checks them before any order:{" "}
          {RULES.minPositions}–{RULES.maxPositions} positions, at most {formatPercent(RULES.maxWeight, 0)} in one stock, at
          least {formatPercent(RULES.minCash, 0)} in cash and at most {formatPercent(RULES.maxSold, 0)} of the portfolio sold
          in a week. Next review: {formatDay(view.nextRebalance)}.
        </p>
        <p>
          Returns are the account&apos;s daily equity; the S&amp;P 500 is the SPDR S&amp;P 500 ETF (SPY), with its
          dividends. Written by AI from StockPilot&apos;s data. It can be wrong, and it isn&apos;t investment advice.
        </p>
      </div>
    </>
  );
}

export default function AiPortfolioPage() {
  return (
    <AppShell contentClassName="dashboard-content" activeSection="ai-portfolio" dataSource="Paper trading account by Alpaca; moves by Gemini">
      <section className="company-heading">
        <div>
          <p className="section-label">WORKSPACE</p>
          <div className="company-title-row">
            <h1>AI portfolio</h1>
          </div>
          <p className="company-subtitle">
            A paper-money portfolio that Gemini rebalances every week from StockPilot&apos;s data, with the reason for every
            move, checked against fixed rules before any order.
          </p>
        </div>
      </section>
      <Suspense fallback={<p className="reco-loading" role="status">Loading the paper account…</p>}>
        <AiPortfolioBody />
      </Suspense>
    </AppShell>
  );
}
