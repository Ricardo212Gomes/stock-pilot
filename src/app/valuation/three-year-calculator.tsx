"use client";

import { useMemo, useState, useTransition } from "react";
import { NumberInput, type Unit } from "./calculator-input";
import { SparkIcon } from "../components/spark-icon";
import { formatMoney, formatMultiple, formatPercent, formatSignedPercent } from "@/lib/valuation/format";
import type { ThreeYearKey } from "@/lib/three-year-autofill";
import {
  SCENARIOS,
  projectScenario,
  type ProjectionDefaults,
  type ProjectionInputs,
  type ProjectionNotes,
  type ScenarioId,
  type ScenarioInputs,
  type YearRow,
} from "@/lib/three-year-projection";
import { autofillThreeYear } from "./actions";

type Source = "data" | "ai" | "edited";
type FieldKey = keyof ProjectionNotes;
type StartKey = "price" | "revenue" | "netIncome" | "shares";

const SOURCE_LABEL: Record<Source, string> = { data: "From filings", ai: "AI suggestion", edited: "Your value" };
const SCENARIO_FIELDS: { field: keyof ScenarioInputs; label: string; unit: Unit; help: string }[] = [
  { field: "revenueGrowth", label: "Revenue growth / year", unit: "percent", help: "How fast sales grow in each projected year." },
  { field: "netIncomeGrowth", label: "Net income growth / year", unit: "percent", help: "How fast profit grows in each projected year. Faster than revenue means the margin widens every year; check the margin row." },
  { field: "peLow", label: "P/E low", unit: "multiple", help: "A cautious price-to-earnings multiple. Gives the low share price." },
  { field: "peHigh", label: "P/E high", unit: "multiple", help: "A generous price-to-earnings multiple. Gives the high share price." },
];

function Range({ low, high, tone }: { low: string; high: string; tone?: [string, string] }) {
  return (
    <span className="projection-range">
      <span className={tone?.[0]}>{low}</span>
      <span aria-hidden="true">–</span>
      <span className={tone?.[1]}>{high}</span>
    </span>
  );
}

function toneOf(value: number | null): string {
  return value === null ? "" : value >= 0 ? "positive-value" : "negative-value";
}

function returnRange(row: YearRow | undefined) {
  if (!row || row.annualReturnLow === null || row.annualReturnHigh === null) return <span>—</span>;
  return (
    <Range
      low={formatSignedPercent(row.annualReturnLow)}
      high={formatSignedPercent(row.annualReturnHigh)}
      tone={[toneOf(row.annualReturnLow), toneOf(row.annualReturnHigh)]}
    />
  );
}

export function ThreeYearCalculator({
  symbol,
  defaults,
}: {
  symbol: string;
  defaults: ProjectionDefaults;
}) {
  const { currency, baseYear, currentYear, history } = defaults;
  const [inputs, setInputs] = useState<ProjectionInputs>(defaults.inputs);
  const [selected, setSelected] = useState<ScenarioId>("neutral");
  const [sources, setSources] = useState<Partial<Record<FieldKey, Source>>>({});
  const [aiNotes, setAiNotes] = useState<Partial<Record<FieldKey, string>>>({});
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [isAutofilling, startAutofill] = useTransition();

  const projections = useMemo(
    () => Object.fromEntries(SCENARIOS.map(({ id }) => [id, projectScenario(inputs, inputs.scenarios[id], baseYear, currentYear)])) as
      Record<ScenarioId, ReturnType<typeof projectScenario>>,
    [inputs, baseYear, currentYear],
  );
  const source = (key: FieldKey): Source => sources[key] ?? "data";
  const note = (key: FieldKey) => (source(key) === "ai" ? aiNotes[key] : defaults.notes[key]);
  const scenarioLabel = SCENARIOS.find(({ id }) => id === selected)!.label;
  const projection = projections[selected];
  const finalYear = baseYear + 5;
  // The template's headline return is three years out.
  const threeYearsOut = currentYear + 3;

  function setStart(key: StartKey, value: number | null) {
    setInputs((current) => ({ ...current, [key]: value }));
    setSources((current) => ({ ...current, [key]: "edited" }));
  }

  function setScenario(field: keyof ScenarioInputs, value: number | null) {
    if (value === null) return;
    setInputs((current) => ({
      ...current,
      scenarios: { ...current.scenarios, [selected]: { ...current.scenarios[selected], [field]: value } },
    }));
    setSources((current) => ({ ...current, [`${selected}.${field}`]: "edited" }));
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
          const scenarios = Object.fromEntries(SCENARIOS.map(({ id }) => [id, { ...current.scenarios[id] }])) as ProjectionInputs["scenarios"];
          for (const key of keys) {
            const [scenario, field] = key.split(".") as [ScenarioId, keyof ScenarioInputs];
            scenarios[scenario][field] = response.suggestions[key]!.value;
          }
          return { ...current, scenarios };
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

  const startFields: { key: StartKey; label: string; unit: Unit; help: string }[] = [
    { key: "price", label: "Current share price", unit: "currency", help: "What one share costs today. Returns are measured from this price." },
    { key: "revenue", label: `Revenue, FY ${baseYear}`, unit: "millions", help: "The last fiscal year's sales, the starting point that grows each year." },
    { key: "netIncome", label: `Net income, FY ${baseYear}`, unit: "millions", help: "The last fiscal year's profit, which grows at its own rate." },
    { key: "shares", label: "Shares outstanding", unit: "shares", help: "Diluted shares. Net income is divided by these to get EPS, the same count in every year." },
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
          <p>AI suggests growth rates and P/E ranges for all five scenarios from the company&apos;s history, with a reason for each.</p>
          {isAutofilling && <p className="ai-analysis-status" role="status">Reviewing {symbol}&apos;s history…</p>}
          {aiError && <p className="ai-analysis-error" role="alert">{aiError}</p>}
          {aiSummary && <p className="autofill-summary" aria-live="polite"><strong>AI outlook: </strong>{aiSummary}</p>}
        </div>

        <fieldset className="assumption-group">
          <legend>Scenario</legend>
          <div className="chart-view-switch scenario-switch" role="group" aria-label="Scenario to edit">
            {SCENARIOS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                className={id === selected ? "chart-view-active" : ""}
                aria-pressed={id === selected}
                onClick={() => setSelected(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {SCENARIO_FIELDS.map(({ field, label, unit, help }) => {
            const key = `${selected}.${field}` as const;
            return (
              <div className={`assumption-field assumption-source-${source(key)}`} key={key}>
                <div className="assumption-label-row">
                  <label htmlFor={`three-year-${field}`}>{label}</label>
                  <span className="assumption-source">{SOURCE_LABEL[source(key)]}</span>
                </div>
                <NumberInput
                  key={`${key}-${version}`}
                  id={`three-year-${field}`}
                  label={`${label}, ${scenarioLabel}`}
                  value={inputs.scenarios[selected][field]}
                  unit={unit}
                  currency={currency}
                  onChange={(value) => setScenario(field, value)}
                />
                <details className="assumption-help">
                  <summary>What is this?</summary>
                  <p>{help}</p>
                  {note(key) && <p className="assumption-note"><strong>{source(key) === "ai" ? "Why AI chose this: " : "Where it comes from: "}</strong>{note(key)}</p>}
                </details>
              </div>
            );
          })}
        </fieldset>

        <fieldset className="assumption-group">
          <legend>Starting point</legend>
          {startFields.map(({ key, label, unit, help }) => (
            <div className={`assumption-field assumption-source-${source(key)}`} key={key}>
              <div className="assumption-label-row">
                <label htmlFor={`three-year-${key}`}>{label}</label>
                <span className="assumption-source">{SOURCE_LABEL[source(key)]}</span>
              </div>
              <NumberInput
                key={`${key}-${version}`}
                id={`three-year-${key}`}
                label={label}
                value={inputs[key]}
                unit={unit}
                currency={currency}
                onChange={(value) => setStart(key, value)}
              />
              <details className="assumption-help">
                <summary>What is this?</summary>
                <p>{help}</p>
                {note(key) && <p className="assumption-note"><strong>Where it comes from: </strong>{note(key)}</p>}
              </details>
            </div>
          ))}
        </fieldset>
      </aside>

      <div className="projection-results">
        <section className="projection-section" aria-labelledby="three-year-results">
          <div className="content-section-heading">
            <div>
              <p className="section-label">FIVE SCENARIOS</p>
              <h2 id="three-year-results">What could {symbol} be worth?</h2>
            </div>
          </div>
          {!projection.ok ? (
            <p className="model-card-reason">{projection.reason}</p>
          ) : (
            <>
              <p className="projection-section-intro">
                Share price from a low and a high P/E, and the yearly return from {inputs.price === null ? "today's price" : formatMoney(inputs.price, currency)} before
                dividends. Select a scenario to see it year by year.
              </p>
              <div className="table-scroll">
                <table className="financial-table scenario-table">
                  <thead>
                    <tr>
                      <th scope="col">Scenario</th>
                      <th scope="col">Price in {threeYearsOut}</th>
                      <th scope="col">Return / yr</th>
                      <th scope="col">Price in {finalYear}</th>
                      <th scope="col">Return / yr</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SCENARIOS.map(({ id, label }) => {
                      const result = projections[id];
                      const rows = result.ok ? result.rows : [];
                      const atThree = rows.find((row) => row.year === threeYearsOut);
                      const atEnd = rows[rows.length - 1];
                      return (
                        <tr key={id} className={id === selected ? "scenario-row-selected" : ""}>
                          <th scope="row">
                            <button type="button" className="scenario-row-button" aria-pressed={id === selected} onClick={() => setSelected(id)}>{label}</button>
                          </th>
                          <td>{atThree ? <Range low={formatMoney(atThree.priceLow, currency)} high={formatMoney(atThree.priceHigh, currency)} /> : "—"}</td>
                          <td>{returnRange(atThree)}</td>
                          <td>{atEnd ? <Range low={formatMoney(atEnd.priceLow, currency)} high={formatMoney(atEnd.priceHigh, currency)} /> : "—"}</td>
                          <td>{returnRange(atEnd)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        {projection.ok && (
          <section className="projection-section" aria-labelledby="three-year-table">
            <div className="content-section-heading">
              <div>
                <p className="section-label">{scenarioLabel.toUpperCase()} · YEAR BY YEAR</p>
                <h2 id="three-year-table">How the business grows</h2>
              </div>
            </div>
            <div className="table-scroll">
              <table className="financial-table three-year-table">
                <thead>
                  <tr>
                    <th scope="col">Fiscal year</th>
                    <th scope="col">{baseYear}</th>
                    {projection.rows.map((row) => <th scope="col" key={row.year}>{row.year}</th>)}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <th scope="row">Revenue</th>
                    <td>{formatMoney(inputs.revenue, currency, true)}</td>
                    {projection.rows.map((row) => <td key={row.year}>{formatMoney(row.revenue, currency, true)}</td>)}
                  </tr>
                  <tr className="three-year-growth">
                    <th scope="row">Revenue growth</th>
                    <td />
                    {projection.rows.map((row) => <td key={row.year}>{formatSignedPercent(inputs.scenarios[selected].revenueGrowth)}</td>)}
                  </tr>
                  <tr>
                    <th scope="row">Net income</th>
                    <td>{formatMoney(inputs.netIncome, currency, true)}</td>
                    {projection.rows.map((row) => <td key={row.year}>{formatMoney(row.netIncome, currency, true)}</td>)}
                  </tr>
                  <tr className="three-year-growth">
                    <th scope="row">Net income growth</th>
                    <td />
                    {projection.rows.map((row) => <td key={row.year}>{formatSignedPercent(inputs.scenarios[selected].netIncomeGrowth)}</td>)}
                  </tr>
                  <tr>
                    <th scope="row">Net margin</th>
                    <td>{inputs.revenue && inputs.netIncome !== null ? formatPercent(inputs.netIncome / inputs.revenue) : "—"}</td>
                    {projection.rows.map((row) => (
                      <td key={row.year} className={row.netMargin > 0.6 ? "negative-value" : ""}>{formatPercent(row.netMargin)}</td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row">EPS</th>
                    <td>{inputs.netIncome !== null && inputs.shares ? formatMoney(inputs.netIncome / inputs.shares, currency) : "—"}</td>
                    {projection.rows.map((row) => <td key={row.year}>{formatMoney(row.eps, currency)}</td>)}
                  </tr>
                  <tr>
                    <th scope="row">P/E low</th>
                    <td />
                    {projection.rows.map((row) => <td key={row.year}>{formatMultiple(inputs.scenarios[selected].peLow)}</td>)}
                  </tr>
                  <tr>
                    <th scope="row">P/E high</th>
                    <td />
                    {projection.rows.map((row) => <td key={row.year}>{formatMultiple(inputs.scenarios[selected].peHigh)}</td>)}
                  </tr>
                  <tr className="three-year-total">
                    <th scope="row">Share price low</th>
                    <td />
                    {projection.rows.map((row) => <td key={row.year}>{formatMoney(row.priceLow, currency)}</td>)}
                  </tr>
                  <tr className="three-year-total">
                    <th scope="row">Share price high</th>
                    <td />
                    {projection.rows.map((row) => <td key={row.year}>{formatMoney(row.priceHigh, currency)}</td>)}
                  </tr>
                  <tr>
                    <th scope="row">Return / yr, low</th>
                    <td />
                    {projection.rows.map((row) => <td key={row.year} className={toneOf(row.annualReturnLow)}>{row.annualReturnLow === null ? "—" : formatSignedPercent(row.annualReturnLow)}</td>)}
                  </tr>
                  <tr>
                    <th scope="row">Return / yr, high</th>
                    <td />
                    {projection.rows.map((row) => <td key={row.year} className={toneOf(row.annualReturnHigh)}>{row.annualReturnHigh === null ? "—" : formatSignedPercent(row.annualReturnHigh)}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="table-footnote">
              Returns are measured from today to the end of each fiscal year, so years that end within a year of today show none.
              {projection.rows.some((row) => row.netMargin > 0.6) && " A net margin above 60% is shown in red: net income is growing much faster than revenue."}
            </p>
          </section>
        )}

        <section className="projection-section" aria-labelledby="three-year-history">
          <div className="content-section-heading">
            <div>
              <p className="section-label">HISTORY</p>
              <h2 id="three-year-history">What the company has done</h2>
            </div>
          </div>
          <p className="projection-section-intro">Use the past as a reference for the growth rates. The neutral case starts from these averages.</p>
          <div className="table-scroll">
            <table className="financial-table history-table">
              <thead>
                <tr>
                  <th scope="col">Fiscal year</th>
                  <th scope="col">Revenue growth</th>
                  <th scope="col">Net income growth</th>
                  <th scope="col">Net margin</th>
                </tr>
              </thead>
              <tbody>
                {history.rows.map((row) => (
                  <tr key={row.year}>
                    <th scope="row">{row.year}</th>
                    <td className={toneOf(row.revenueGrowth)}>{row.revenueGrowth === null ? "—" : formatSignedPercent(row.revenueGrowth)}</td>
                    <td className={toneOf(row.netIncomeGrowth)}>{row.netIncomeGrowth === null ? "—" : formatSignedPercent(row.netIncomeGrowth)}</td>
                    <td>{formatPercent(row.netMargin)}</td>
                  </tr>
                ))}
                <tr className="three-year-total">
                  <th scope="row">Average</th>
                  <td>{history.average.revenueGrowth === null ? "—" : formatSignedPercent(history.average.revenueGrowth)}</td>
                  <td>{history.average.netIncomeGrowth === null ? "—" : formatSignedPercent(history.average.netIncomeGrowth)}</td>
                  <td>{formatPercent(history.average.netMargin)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="projection-section" aria-labelledby="three-year-how">
          <div className="content-section-heading">
            <div>
              <p className="section-label">HOW IT WORKS</p>
              <h2 id="three-year-how">From revenue to share price</h2>
            </div>
          </div>
          <ol className="three-year-steps">
            <li><strong>Revenue</strong> and <strong>net income</strong> each grow from fiscal {baseYear} at their own yearly rate.</li>
            <li><strong>Net margin</strong> is net income ÷ revenue, a check that the two rates make sense together.</li>
            <li><strong>EPS</strong> is net income ÷ today&apos;s shares outstanding.</li>
            <li><strong>Share price</strong> is EPS × the low and the high P/E.</li>
            <li><strong>Return / yr</strong> is (future price ÷ price today)<sup>1/years</sup> − 1, before dividends.</li>
          </ol>
          <p className="projection-section-intro">
            This follows Jeremy Lefebvre&apos;s (1000xStocks) projection template. Unlike the intrinsic value models, it
            doesn&apos;t discount anything: it asks what the price could be if the business hits each scenario and the
            market pays that multiple. Small changes in the P/E move the answer a lot.
          </p>
        </section>

        <p className="projection-disclaimer">
          Projections depend entirely on the assumptions above. They are an educational tool, not investment advice.
        </p>
      </div>
    </div>
  );
}
