"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CompanyLogo } from "../components/company-logo";
import {
  DEFAULT_MIN_UPSIDE,
  RATING_KEYS,
  scoreCandidates,
  SIGNALS,
  signalHelp,
  UPSIDE_CHOICES,
  versus,
  type AnalystRatings,
  type Candidate,
  type ScoredCandidate,
  type SignalId,
} from "@/lib/recommendation-signals";

const RATING_NAMES: Record<(typeof RATING_KEYS)[number], string> = {
  strongBuy: "Strong Buy",
  buy: "Buy",
  hold: "Hold",
  sell: "Sell",
  strongSell: "Strong Sell",
};

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function signedPercent(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

// The split of ratings as a thin bar beside its figures; the legend above the table names the colours.
function RatingBar({ ratings }: { ratings: AnalystRatings }) {
  return (
    <span className="rating-bar" aria-hidden="true">
      {RATING_KEYS.filter((key) => ratings[key] > 0).map((key) => (
        <span key={key} className={`rating-${key}`} style={{ flexGrow: ratings[key] }} />
      ))}
    </span>
  );
}

function Ratings({ ratings }: { ratings: AnalystRatings | null }) {
  if (!ratings) return <>—</>;
  const split = RATING_KEYS.map((key) => `${ratings[key]} ${RATING_NAMES[key]}`).join(", ");
  return (
    <div className="reco-ratings" title={`${split}. Average ${ratings.mean.toFixed(2)} on a 1 (Strong Buy) to 5 (Strong Sell) scale.`}>
      <strong>{ratings.label}</strong>
      <RatingBar ratings={ratings} />
      <small>
        {Math.round(ratings.buyShare * 100)}% Buy · {ratings.total} analysts
        <span className="visually-hidden">: {split}</span>
      </small>
    </div>
  );
}

function SignalDots({ candidate, minUpside }: { candidate: ScoredCandidate; minUpside: number }) {
  return (
    <span className="reco-signals">
      <span className="reco-signal-dots" aria-hidden="true">
        {SIGNALS.map((signal) => (
          <span
            key={signal.id}
            className={candidate.signals[signal.id] ? "reco-dot-met" : ""}
            title={`${signal.label}: ${candidate.signals[signal.id] ? "yes" : "no"}. ${signalHelp(signal.id, minUpside)}`}
          />
        ))}
      </span>
      <span>
        {candidate.met}/{SIGNALS.length}
        <span className="visually-hidden">
          {" "}signals: {SIGNALS.filter((signal) => candidate.signals[signal.id]).map((signal) => signal.label).join(", ") || "none"}
        </span>
      </span>
    </span>
  );
}

export function RecommendationsTable({ candidates, covered, universe, asOf }: { candidates: Candidate[]; covered: number; universe: number; asOf: string | null }) {
  const [minUpside, setMinUpside] = useState(DEFAULT_MIN_UPSIDE);
  const [required, setRequired] = useState<Set<SignalId>>(() => new Set(SIGNALS.filter((signal) => signal.core).map((signal) => signal.id)));
  const [showAll, setShowAll] = useState(false);

  const scored = useMemo(() => scoreCandidates(candidates, minUpside), [candidates, minUpside]);
  const meets = (candidate: ScoredCandidate) => [...required].every((id) => candidate.signals[id]);
  const matches = scored.filter(meets);
  const rows = showAll ? scored : matches;

  function toggle(id: SignalId) {
    setRequired((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const asOfLabel = asOf
    ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${asOf}T12:00:00Z`))
    : null;

  return (
    <>
      <section className="reco-card" aria-labelledby="reco-criteria-heading">
        <div className="reco-criteria-heading">
          <h2 id="reco-criteria-heading">Criteria</h2>
          <label className="reco-upside">
            Minimum upside
            <select value={minUpside} onChange={(event) => setMinUpside(Number(event.target.value))}>
              {UPSIDE_CHOICES.map((choice) => <option key={choice} value={choice}>{Math.round(choice * 100)}%</option>)}
            </select>
          </label>
        </div>
        <p className="reco-criteria-lede">Show stocks that meet every checked signal. The first three are the screen&apos;s question: cheap against analysts&apos; targets, rated Buy, and pulled back.</p>
        <ul className="reco-criteria">
          {SIGNALS.map((signal) => (
            <li key={signal.id}>
              <label>
                <input type="checkbox" checked={required.has(signal.id)} onChange={() => toggle(signal.id)} />
                <span>
                  <strong>{signal.label}</strong>
                  <small>{signalHelp(signal.id, minUpside)}</small>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="reco-card" aria-labelledby="reco-results-heading">
        <div className="reco-results-heading">
          <div>
            <h2 id="reco-results-heading">{matches.length === 0 ? "No matches" : `${matches.length} ${matches.length === 1 ? "stock matches" : "stocks match"}`}</h2>
            <p>
              Of {candidates.length} screened{asOfLabel ? `, using closes through ${asOfLabel}` : ""}. Ranked by signals met, then upside.
            </p>
          </div>
          <div className="reco-results-actions">
            {matches.length > 1 && (
              <Link href={`/compare?symbols=${matches.slice(0, 5).map((candidate) => candidate.symbol).join(",")}`}>
                Compare the top {Math.min(matches.length, 5)} →
              </Link>
            )}
            <label className="events-check">
              <input type="checkbox" checked={showAll} onChange={(event) => setShowAll(event.target.checked)} />
              Show all {scored.length}
            </label>
          </div>
        </div>

        <p className="rating-legend" aria-hidden="true">
          {RATING_KEYS.map((key) => (
            <span key={key}><span className={`rating-swatch rating-${key}`} />{RATING_NAMES[key]}</span>
          ))}
        </p>

        {rows.length === 0 ? (
          <p className="reco-empty">
            Nothing meets every checked signal today. Uncheck one, lower the minimum upside, or show all {scored.length} screened stocks.
          </p>
        ) : (
          <div className="table-scroll">
            <table className="financial-table reco-table">
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col" className="reco-optional">Close</th>
                  <th scope="col"><span className="stat-term" title="The analysts' consensus price target and how far it is above the last close.">Target</span></th>
                  <th scope="col">Analysts</th>
                  <th scope="col"><span className="stat-term" title="The last close against the average of the last 60 sessions (12 weeks).">vs 12-week avg</span></th>
                  <th scope="col" className="reco-optional"><span className="stat-term" title="The last close against the 200-day average.">vs 200-day avg</span></th>
                  <th scope="col" className="reco-optional"><span className="stat-term" title="14-day relative strength index: under 30 is usually called oversold, over 70 overbought.">RSI</span></th>
                  <th scope="col" className="reco-optional"><span className="stat-term" title="How far the last close is below the highest close of the past 52 weeks.">From 52-week high</span></th>
                  <th scope="col">Signals</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((candidate) => {
                  const { trend, target } = candidate;
                  return (
                    <tr key={candidate.symbol} className={showAll && !meets(candidate) ? "reco-row-other" : ""}>
                      <th scope="row">
                        <Link className="favorites-company" href={`/stock?symbol=${encodeURIComponent(candidate.symbol)}`}>
                          <span className="earnings-logo-box"><CompanyLogo symbol={candidate.symbol} /></span>
                          <span>
                            <strong>{candidate.symbol}</strong>
                            <small>{candidate.name}</small>
                          </span>
                        </Link>
                      </th>
                      <td className="reco-optional">{money(trend.close)}</td>
                      <td>
                        {target ? (
                          <div className="reco-target" title={target.low !== null && target.high !== null ? `Analysts' targets range from ${money(target.low)} to ${money(target.high)}.` : undefined}>
                            <span>{money(target.consensus)}</span>
                            <small className={(candidate.upside ?? 0) >= 0 ? "positive-value" : "negative-value"}>{signedPercent(candidate.upside)}</small>
                          </div>
                        ) : "—"}
                      </td>
                      <td><Ratings ratings={candidate.ratings} /></td>
                      <td>{signedPercent(versus(trend.close, trend.sma60))}</td>
                      <td className="reco-optional">{signedPercent(versus(trend.close, trend.sma200))}</td>
                      <td className="reco-optional">{trend.rsi14 === null ? "—" : Math.round(trend.rsi14)}</td>
                      <td className="reco-optional">{signedPercent(trend.close / trend.high52 - 1)}</td>
                      <td><SignalDots candidate={candidate} minUpside={minUpside} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="news-footnote reco-footnote">
        <p>
          Screens the {covered} of the {universe} largest US companies that Financial Modeling Prep&apos;s plan covers. Price
          targets (consensus of analysts&apos; latest targets) and daily closes come from FMP, ratings from Finnhub&apos;s monthly
          analyst counts; all refresh once a day. The 12-week average is the last 60 sessions&apos; closes.
        </p>
        <p>
          A screen, not advice: analysts&apos; targets are often too optimistic, and a stock below its average can keep
          falling. Check the company&apos;s financials and valuation before acting.
        </p>
      </div>
    </>
  );
}
