"use client";

import { useMemo, useState, useTransition } from "react";
import { NumberInput, type Unit } from "./calculator-input";
import { SparkIcon } from "../components/spark-icon";
import { formatMoney, formatPercent, formatSignedPercent } from "@/lib/valuation/format";
import type { ThreeYearKey } from "@/lib/three-year-autofill";
import {
  YEARS_RANGE,
  projectThreeYear,
  type ProjectionDefaults,
  type ProjectionInputs,
  type ProjectionNotes,
  type ScenarioId,
  type ScenarioInputs,
  type ScenarioResult,
} from "@/lib/three-year-projection";
import { autofillThreeYear } from "./actions";

type Source = "data" | "ai" | "edited";
type FieldKey = keyof ProjectionNotes;

const SOURCE_LABEL: Record<Source, string> = { data: "From filings", ai: "AI suggestion", edited: "Your value" };
const SCENARIO_FIELDS: { field: keyof ScenarioInputs; label: string; unit: Unit; help: string }[] = [
  { field: "revenueGrowth", label: "Revenue growth / year", unit: "percent", help: "How fast sales grow each year of the projection." },
  { field: "netMargin", label: "Net margin", unit: "percent", help: "Share of revenue kept as profit at the end of the projection." },
  { field: "peRatio", label: "P/E ratio", unit: "multiple", help: "Price-to-earnings multiple the market pays at the end of the projection." },
];

function RangeCell({ low, high }: { low: string; high: string }) {
  return (
    <td className="three-year-range">
      <span>{low}</span>
      <span className="three-year-range-high">{high}</span>
    </td>
  );
}

function ResultCard({
  id,
  result,
  currency,
  targetReturn,
}: {
  id: ScenarioId;
  result: ScenarioResult;
  currency: string;
  targetReturn: number;
}) {
  const tone = result.annualReturn === null ? "" : result.annualReturn >= targetReturn ? "positive-value" : result.annualReturn < 0 ? "negative-value" : "";
  return (
    <article className={`model-card${id === "high" ? " model-card-primary" : ""}`}>
      <div className="model-card-top">
        <div>
          <span className={`model-role ${id === "high" ? "model-role-primary" : "model-role-secondary"}`}>{id === "low" ? "Low case" : "High case"}</span>
          <h3>Price in the final year</h3>
        </div>
        <div className="model-card-value">
          <strong>{formatMoney(result.price, currency)}</strong>
          <small className={tone}>{result.annualReturn === null ? "No positive earnings" : `${formatSignedPercent(result.annualReturn)} a year`}</small>
        </div>
      </div>
      <dl className="model-card-stats">
        <div><dt>Total return</dt><dd>{formatSignedPercent(result.totalReturn)}</dd></div>
        <div><dt>EPS</dt><dd>{formatMoney(result.eps, currency)}</dd></div>
        <div><dt>Buy below for {formatPercent(targetReturn, 0)}/yr</dt><dd>{formatMoney(result.buyBelow, currency)}</dd></div>
      </dl>
    </article>
  );
}

export function ThreeYearCalculator({
  symbol,
  defaults,
}: {
  symbol: string;
  defaults: ProjectionDefaults;
}) {
  const { currency } = defaults;
  const [inputs, setInputs] = useState<ProjectionInputs>(defaults.inputs);
  const [sources, setSources] = useState<Partial<Record<FieldKey, Source>>>({});
  const [aiNotes, setAiNotes] = useState<Partial<Record<FieldKey, string>>>({});
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [isAutofilling, startAutofill] = useTransition();

  const result = useMemo(() => projectThreeYear(inputs), [inputs]);
  const source = (key: FieldKey): Source => sources[key] ?? "data";
  // The horizon and target return are sensible defaults, not figures from the filings.
  const sourceLabel = (key: FieldKey) =>
    source(key) === "data" && (key === "years" || key === "targetReturn") ? "Default" : SOURCE_LABEL[source(key)];
  const note = (key: FieldKey) => (source(key) === "ai" ? aiNotes[key] : defaults.notes[key]);

  function setShared(key: "price" | "revenue" | "shares" | "years" | "sharesChange" | "targetReturn", value: number | null) {
    setInputs((current) => ({ ...current, [key]: key === "years" ? (value ?? 3) : key === "sharesChange" || key === "targetReturn" ? (value ?? 0) : value }));
    setSources((current) => ({ ...current, [key]: "edited" }));
  }

  function setScenario(scenario: ScenarioId, field: keyof ScenarioInputs, value: number | null) {
    if (value === null) return;
    setInputs((current) => ({ ...current, [scenario]: { ...current[scenario], [field]: value } }));
    setSources((current) => ({ ...current, [`${scenario}.${field}`]: "edited" }));
  }

  function reset() {
    setInputs(defaults.inputs);
    setSources({});
    setAiNotes({});
    setAiSummary(null);
    setAiError(null);
    setVersion((current) => current + 1);
  }

  function runAutofill() {
    setAiError(null);
    startAutofill(async () => {
      try {
        const response = await autofillThreeYear(symbol);
        if (!response.ok) {
          setAiError(response.error);
          return;
        }
        const keys = Object.keys(response.suggestions) as ThreeYearKey[];
        setInputs((current) => {
          const next = { ...current, low: { ...current.low }, high: { ...current.high } };
          for (const key of keys) {
            const value = response.suggestions[key]!.value;
            if (key === "sharesChange") next.sharesChange = value;
            else {
              const [scenario, field] = key.split(".") as [ScenarioId, keyof ScenarioInputs];
              next[scenario][field] = value;
            }
          }
          return next;
        });
        setSources((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, "ai"])) }));
        setAiNotes(Object.fromEntries(keys.map((key) => [key, response.suggestions[key]!.rationale])));
        setAiSummary(response.summary || null);
        setVersion((current) => current + 1);
      } catch {
        setAiError("The autofill failed to run. Please try again.");
      }
    });
  }

  const sharedFields: { key: "price" | "revenue" | "shares" | "years" | "sharesChange" | "targetReturn"; label: string; unit: Unit; help: string }[] = [
    { key: "price", label: "Current share price", unit: "currency", help: "What one share costs today. Returns are measured from this price." },
    { key: "revenue", label: "Revenue today", unit: "millions", help: "Trailing-twelve-month sales, the starting point that grows each year." },
    { key: "shares", label: "Shares outstanding", unit: "shares", help: "Diluted shares. Earnings are divided by these to get EPS." },
    { key: "sharesChange", label: "Share count change / year", unit: "percent", help: "Negative when the company buys back shares (each share gets more of the profit), positive when it issues new ones." },
    { key: "years", label: "Projection years", unit: "years", help: `How far ahead to project, from ${YEARS_RANGE.min} to ${YEARS_RANGE.max} years.` },
    { key: "targetReturn", label: "Your target return / year", unit: "percent", help: "The yearly return you want. Sets the highest price you could pay today and still earn it." },
  ];

  return (
    <div className="projection-layout">
      <aside className="assumptions-panel" aria-labelledby="three-year-inputs">
        <div className="assumptions-heading">
          <div>
            <p className="section-label">ASSUMPTIONS</p>
            <h2 id="three-year-inputs">Your inputs</h2>
          </div>
          <button className="assumptions-reset" type="button" onClick={reset}>Reset</button>
        </div>

        <div className="autofill-box">
          <button className="ai-analysis-button" type="button" onClick={runAutofill} disabled={isAutofilling}>
            <SparkIcon />
            <span>{isAutofilling ? "Thinking…" : "Autofill with AI"}</span>
          </button>
          <p>AI suggests the low and high cases and the share count change from the company&apos;s history, with a reason for each.</p>
          {isAutofilling && <p className="ai-analysis-status" role="status">Reviewing {symbol}&apos;s history…</p>}
          {aiError && <p className="ai-analysis-error" role="alert">{aiError}</p>}
          {aiSummary && <p className="autofill-summary" aria-live="polite"><strong>AI outlook: </strong>{aiSummary}</p>}
        </div>

        <fieldset className="assumption-group">
          <legend>Scenarios</legend>
          <p className="assumption-group-description">What the business looks like in the final year, in a cautious and an optimistic case.</p>
          <div className="scenario-columns" aria-hidden="true"><span>Low case</span><span>High case</span></div>
          {SCENARIO_FIELDS.map(({ field, label, unit, help }) => (
            <div className="scenario-field" key={field}>
              <span className="scenario-label stat-term" title={help}>{label}</span>
              <div className="scenario-inputs">
                {(["low", "high"] as const).map((scenario) => (
                  <div key={scenario}>
                    <NumberInput
                      key={`${scenario}-${field}-${version}`}
                      id={`three-year-${scenario}-${field}`}
                      label={`${label}, ${scenario} case`}
                      value={inputs[scenario][field]}
                      unit={unit}
                      currency={currency}
                      onChange={(value) => setScenario(scenario, field, value)}
                    />
                    <span className={`scenario-source assumption-source-${source(`${scenario}.${field}`)}`} title={note(`${scenario}.${field}`)}>
                      {SOURCE_LABEL[source(`${scenario}.${field}`)]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
          <details className="assumption-help">
            <summary>Where these come from</summary>
            {SCENARIO_FIELDS.flatMap(({ field, label }) => (["low", "high"] as const).map((scenario) => {
              const text = note(`${scenario}.${field}`);
              return text ? <p key={`${scenario}-${field}`}><strong>{label} ({scenario}): </strong>{text}</p> : null;
            }))}
          </details>
        </fieldset>

        <fieldset className="assumption-group">
          <legend>Starting point and goal</legend>
          {sharedFields.map(({ key, label, unit, help }) => (
            <div className={`assumption-field assumption-source-${source(key)}`} key={key}>
              <div className="assumption-label-row">
                <label htmlFor={`three-year-${key}`}>{label}</label>
                <span className="assumption-source">{sourceLabel(key)}</span>
              </div>
              <NumberInput
                key={`${key}-${version}`}
                id={`three-year-${key}`}
                label={label}
                value={inputs[key]}
                unit={unit}
                currency={currency}
                onChange={(value) => setShared(key, value)}
              />
              <details className="assumption-help">
                <summary>What is this?</summary>
                <p>{help}</p>
                {note(key) && <p className="assumption-note"><strong>{source(key) === "ai" ? "Why AI chose this: " : "Where it comes from: "}</strong>{note(key)}</p>}
              </details>
            </div>
          ))}
        </fieldset>
      </aside>

      <div className="projection-results">
        <section className="projection-section" aria-labelledby="three-year-results">
          <div className="content-section-heading">
            <div>
              <p className="section-label">{inputs.years}-YEAR PROJECTION</p>
              <h2 id="three-year-results">What could {symbol} be worth?</h2>
            </div>
          </div>
          {!result.ok ? (
            <p className="model-card-reason">{result.reason}</p>
          ) : (
            <>
              <p className="projection-section-intro">
                {inputs.price !== null && result.low.annualReturn !== null && result.high.annualReturn !== null
                  ? <>From {formatMoney(inputs.price, currency)} today, these assumptions point to <strong>{formatSignedPercent(result.low.annualReturn)}</strong> to <strong>{formatSignedPercent(result.high.annualReturn)}</strong> a year over {inputs.years} years, before dividends.</>
                  : "Enter a current price and assumptions that give positive earnings to see the expected return."}
              </p>
              <div className="model-grid">
                <ResultCard id="low" result={result.low} currency={currency} targetReturn={inputs.targetReturn} />
                <ResultCard id="high" result={result.high} currency={currency} targetReturn={inputs.targetReturn} />
              </div>
            </>
          )}
        </section>

        {result.ok && (
          <section className="projection-section" aria-labelledby="three-year-table">
            <div className="content-section-heading">
              <div>
                <p className="section-label">YEAR BY YEAR</p>
                <h2 id="three-year-table">How the business grows</h2>
              </div>
            </div>
            <div className="table-scroll">
              <table className="financial-table three-year-table">
                <thead>
                  <tr>
                    <th scope="col">Year</th>
                    <th scope="col">Revenue</th>
                    <th scope="col">Net income</th>
                    <th scope="col">EPS</th>
                    <th scope="col">Share price</th>
                  </tr>
                </thead>
                <tbody>
                  {result.years.map((row) => (
                    <tr key={row.year}>
                      <th scope="row">Year {row.year}</th>
                      <RangeCell low={formatMoney(row.low.revenue, currency, true)} high={formatMoney(row.high.revenue, currency, true)} />
                      <RangeCell low={formatMoney(row.low.netIncome, currency, true)} high={formatMoney(row.high.netIncome, currency, true)} />
                      <RangeCell low={formatMoney(row.low.eps, currency)} high={formatMoney(row.high.eps, currency)} />
                      <RangeCell low={formatMoney(row.low.price, currency)} high={formatMoney(row.high.price, currency)} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="table-footnote">Each cell shows the low case above the high case.</p>
          </section>
        )}

        <section className="projection-section" aria-labelledby="three-year-how">
          <div className="content-section-heading">
            <div>
              <p className="section-label">HOW IT WORKS</p>
              <h2 id="three-year-how">From revenue to share price</h2>
            </div>
          </div>
          <ol className="three-year-steps">
            <li><strong>Revenue</strong> grows each year: revenue today × (1 + growth)<sup>years</sup>.</li>
            <li><strong>Net income</strong> is that revenue × the net margin.</li>
            <li><strong>EPS</strong> is net income ÷ shares, after the yearly change in the share count.</li>
            <li><strong>Share price</strong> is EPS × the P/E ratio the market might pay.</li>
            <li><strong>Annual return</strong> is (future price ÷ price today)<sup>1/years</sup> − 1, before dividends.</li>
          </ol>
          <p className="projection-section-intro">
            Unlike the intrinsic value models, this doesn&apos;t discount anything: it asks what the price could be if the
            business hits your assumptions and the market pays that multiple. Small changes in the P/E move the answer a lot.
          </p>
        </section>

        <p className="projection-disclaimer">
          Projections depend entirely on the assumptions above. They are an educational tool, not investment advice.
        </p>
      </div>
    </div>
  );
}
