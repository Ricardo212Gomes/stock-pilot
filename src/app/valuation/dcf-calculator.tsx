"use client";

import { useMemo, useState, useTransition } from "react";
import { SparkIcon } from "../components/spark-icon";
import { NumberInput, type Unit } from "./calculator-input";
import { formatMoney, formatPercent, formatSignedPercent } from "@/lib/valuation/format";
import type { DcfAiKey } from "@/lib/simple-dcf-autofill";
import {
  PROJECTION_YEARS,
  STAGE_YEARS,
  calculateDcf,
  dcfSensitivityGrid,
  impliedDcfGrowth,
  type DcfDefaults,
  type DcfInputs,
  type DcfNoteKey,
  type TerminalMethod,
} from "@/lib/simple-dcf";
import { autofillDcf } from "./actions";

type Source = "data" | "ai" | "edited";
type FieldKey = DcfNoteKey;
type Field = { key: FieldKey; label: string; unit: Unit; help: string };

const SOURCE_LABEL: Record<Source, string> = { data: "From filings", ai: "AI suggestion", edited: "Your value" };
// These start from sensible conventions rather than the company's filings.
const CONVENTION_KEYS = new Set<FieldKey>(["discountRate", "terminalGrowth", "terminalMultiple", "marginOfSafety", "firstYearCashFlow"]);

const GROWTH_FIELDS: Field[] = [
  {
    key: "firstYearCashFlow",
    label: "Year 1 free cash flow (optional)",
    unit: "millions",
    help: "Leave it blank to grow today's free cash flow from year 1. Type a forecast, such as the company's guidance or an analyst estimate, when next year will differ a lot from the last twelve months: years 2–10 then grow from it.",
  },
  { key: "growthEarly", label: `Growth, years 1–${STAGE_YEARS}`, unit: "percent", help: "How fast free cash flow grows each year over the next five years." },
  { key: "growthLate", label: `Growth, years ${STAGE_YEARS + 1}–${PROJECTION_YEARS}`, unit: "percent", help: "Growth in the following five years. It's usually lower, because growth slows as companies mature." },
];

const START_FIELDS: Field[] = [
  { key: "price", label: "Current share price", unit: "currency", help: "What one share costs today. The intrinsic value is compared with it." },
  { key: "freeCashFlow", label: "Free cash flow today", unit: "millions", help: "Operating cash flow minus capital expenditures over the last twelve months: the cash the business produces after investing in itself." },
  { key: "cash", label: "Cash & short-term investments", unit: "millions", help: "Added to the value: it belongs to shareholders." },
  { key: "debt", label: "Total debt", unit: "millions", help: "Subtracted from the value: lenders are paid before shareholders." },
  { key: "shares", label: "Shares outstanding", unit: "shares", help: "Diluted shares. The company's value is divided by these." },
];

function Value({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={tone}>{value}</dd>
    </div>
  );
}

export function DcfCalculator({ symbol, defaults }: { symbol: string; defaults: DcfDefaults }) {
  const { currency } = defaults;
  const [inputs, setInputs] = useState<DcfInputs>(defaults.inputs);
  const [sources, setSources] = useState<Partial<Record<FieldKey, Source>>>({});
  const [aiNotes, setAiNotes] = useState<Partial<Record<FieldKey, string>>>({});
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [isAutofilling, startAutofill] = useTransition();

  const result = useMemo(() => calculateDcf(inputs), [inputs]);
  const sensitivity = useMemo(() => dcfSensitivityGrid(inputs), [inputs]);
  const implied = useMemo(() => impliedDcfGrowth(inputs), [inputs]);
  const { history } = defaults;
  // With a year 1 forecast, growth starts in year 2.
  const firstGrowthYear = inputs.firstYearCashFlow !== null ? 2 : 1;
  const growthFields = GROWTH_FIELDS.map((field) => (field.key === "growthEarly" ? { ...field, label: `Growth, years ${firstGrowthYear}–${STAGE_YEARS}` } : field));
  const source = (key: FieldKey): Source => sources[key] ?? "data";
  const sourceLabel = (key: FieldKey) =>
    source(key) === "data" && CONVENTION_KEYS.has(key) ? "Default" : SOURCE_LABEL[source(key)];
  const note = (key: FieldKey) => (source(key) === "ai" ? aiNotes[key] : defaults.notes[key]);

  function update(key: FieldKey, value: number | null) {
    setInputs((current) => {
      // Amounts that can be missing stay null; rates fall back to zero while being typed.
      const nullable = key === "price" || key === "freeCashFlow" || key === "firstYearCashFlow" || key === "shares";
      return { ...current, [key]: nullable ? value : value ?? 0 };
    });
    setSources((current) => ({ ...current, [key]: "edited" }));
  }

  function setMethod(method: TerminalMethod) {
    setInputs((current) => ({ ...current, terminalMethod: method }));
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
        const response = await autofillDcf(symbol);
        if (!response.ok) {
          setAiError(response.error);
          return;
        }
        const keys = Object.keys(response.suggestions) as DcfAiKey[];
        setInputs((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, response.suggestions[key]!.value])) }));
        setSources((current) => ({ ...current, ...Object.fromEntries(keys.map((key) => [key, "ai"])) }));
        setAiNotes(Object.fromEntries(keys.map((key) => [key, response.suggestions[key]!.rationale])));
        setAiSummary(response.summary || null);
        setVersion((current) => current + 1);
      } catch {
        setAiError("The autofill failed to run. Please try again.");
      }
    });
  }

  function renderField({ key, label, unit, help }: Field) {
    return (
      <div className={`assumption-field assumption-source-${source(key)}`} key={key}>
        <div className="assumption-label-row">
          <label htmlFor={`dcf-${key}`}>{label}</label>
          <span className="assumption-source">{sourceLabel(key)}</span>
        </div>
        <NumberInput
          key={`${key}-${version}`}
          id={`dcf-${key}`}
          label={label}
          value={inputs[key]}
          unit={unit}
          currency={currency}
          onChange={(value) => update(key, value)}
        />
        <details className="assumption-help">
          <summary>What is this?</summary>
          <p>{help}</p>
          {note(key) && <p className="assumption-note"><strong>{source(key) === "ai" ? "Why AI chose this: " : "Where it comes from: "}</strong>{note(key)}</p>}
        </details>
      </div>
    );
  }

  const terminalField: Field = inputs.terminalMethod === "growth"
    ? { key: "terminalGrowth", label: "Terminal growth", unit: "percent", help: "Growth forever after year 10. Keep it at or below long-run economic growth, about 2–3%, and below the discount rate." }
    : { key: "terminalMultiple", label: "Exit multiple (× free cash flow)", unit: "multiple", help: "What the business sells for at the end of year 10, as a multiple of that year's free cash flow." };

  return (
    <div className="projection-layout">
      <aside className="assumptions-panel" aria-labelledby="dcf-inputs">
        <div className="assumptions-heading">
          <div>
            <p className="section-label">ASSUMPTIONS</p>
            <h2 id="dcf-inputs">Your inputs</h2>
          </div>
          <button className="assumptions-reset" type="button" onClick={reset}>Reset</button>
        </div>

        <div className="autofill-box">
          <button className="ai-analysis-button" type="button" onClick={runAutofill} disabled={isAutofilling}>
            <SparkIcon />
            <span>{isAutofilling ? "Thinking…" : "Autofill with AI"}</span>
          </button>
          <p>AI suggests the growth rates, discount rate and terminal value from the company&apos;s history, with a reason for each.</p>
          {isAutofilling && <p className="ai-analysis-status" role="status">Reviewing {symbol}&apos;s cash flows…</p>}
          {aiError && <p className="ai-analysis-error" role="alert">{aiError}</p>}
          {aiSummary && <p className="autofill-summary" aria-live="polite"><strong>AI outlook: </strong>{aiSummary}</p>}
        </div>

        <fieldset className="assumption-group">
          <legend>Free cash flow growth</legend>
          <p className="assumption-group-description">
            Two stages: faster growth first, then slower as the business matures.
            {history.cagr && ` Free cash flow grew ${formatPercent(history.cagr.rate)} a year over fiscal ${history.cagr.from}–${history.cagr.to}.`}
          </p>
          {growthFields.map(renderField)}
        </fieldset>

        <fieldset className="assumption-group">
          <legend>Discount and terminal value</legend>
          <p className="assumption-group-description">The return you require, and what the business is worth after year {PROJECTION_YEARS}.</p>
          {renderField({ key: "discountRate", label: "Discount rate", unit: "percent", help: "The yearly return you require. Future cash is divided by (1 + this rate) for each year it is away, so a higher rate lowers the value." })}
          <div className="assumption-field">
            <span className="assumption-method-label" id="dcf-terminal-method">Terminal value method</span>
            <div className="chart-view-switch dcf-method-switch" role="group" aria-labelledby="dcf-terminal-method">
              {(["growth", "multiple"] as const).map((method) => (
                <button
                  key={method}
                  type="button"
                  className={inputs.terminalMethod === method ? "chart-view-active" : ""}
                  aria-pressed={inputs.terminalMethod === method}
                  onClick={() => setMethod(method)}
                >
                  {method === "growth" ? "Perpetual growth" : "Exit multiple"}
                </button>
              ))}
            </div>
          </div>
          {renderField(terminalField)}
          {renderField({ key: "marginOfSafety", label: "Margin of safety", unit: "percent", help: "How far below the intrinsic value you'd want to buy, in case the estimates are wrong." })}
        </fieldset>

        <fieldset className="assumption-group">
          <legend>Starting point</legend>
          <p className="assumption-group-description">From the latest filings and quote. Amounts are in millions.</p>
          {START_FIELDS.map(renderField)}
        </fieldset>
      </aside>

      <div className="projection-results">
        {!result.ok ? (
          <section className="projection-section"><p className="model-card-reason">{result.reason}</p></section>
        ) : (
          <>
            <section className="projection-summary" aria-labelledby="dcf-value">
              <div className="projection-summary-figures">
                <div className="projection-summary-main">
                  <p className="section-label" id="dcf-value">INTRINSIC VALUE PER SHARE</p>
                  <strong>{formatMoney(result.valuePerShare, currency)}</strong>
                  <small>
                    Ten years of free cash flow plus a terminal value, discounted at {formatPercent(inputs.discountRate)},
                    with cash added and debt subtracted.
                  </small>
                </div>
                <dl className="projection-summary-stats">
                  <Value label="Current price" value={formatMoney(inputs.price, currency)} />
                  <Value
                    label="Upside / downside"
                    value={formatSignedPercent(result.upside)}
                    tone={result.upside === null ? "" : result.upside >= 0 ? "positive-value" : "negative-value"}
                  />
                  <Value label={`Buy below (${formatPercent(inputs.marginOfSafety, 0)} margin)`} value={formatMoney(result.buyBelow, currency)} />
                  <Value
                    label="Implied growth"
                    value={implied === null ? "—" : `${implied.beyond === "above" ? "> " : implied.beyond === "below" ? "< " : ""}${formatPercent(implied.rate)}`}
                  />
                </dl>
              </div>
              {inputs.price !== null && (
                <p className={`projection-verdict projection-verdict-${inputs.price <= result.valuePerShare ? "below" : "above"}`}>
                  <strong>{inputs.price <= result.buyBelow ? "Below buy price." : inputs.price <= result.valuePerShare ? "Undervalued, thin margin." : "Above estimate."}</strong>{" "}
                  {inputs.price <= result.valuePerShare
                    ? "The price is below what these cash flow assumptions justify."
                    : "The price is higher than these cash flow assumptions justify. The market may expect faster growth."}
                </p>
              )}
            </section>

            <section className="projection-section" aria-labelledby="dcf-reverse">
              <div className="content-section-heading">
                <div>
                  <p className="section-label">REVERSE DCF</p>
                  <h2 id="dcf-reverse">What growth does the price assume?</h2>
                </div>
              </div>
              <p className="reverse-dcf-answer">
                {implied === null
                  ? "Enter a current price to see the growth it implies."
                  : implied.beyond === "above"
                    ? <>At {formatMoney(inputs.price, currency)}, the price implies more than <strong>100%</strong> free cash flow growth a year, with your discount rate and terminal value: more than any growth here can justify.</>
                    : implied.beyond === "below"
                      ? <>At {formatMoney(inputs.price, currency)}, the price holds up even if free cash flow shrinks <strong>50%</strong> a year: either the market expects a collapse, or an input is off.</>
                      : (
                        <>
                          At {formatMoney(inputs.price, currency)}, the price implies about <strong>{formatPercent(implied.rate)}</strong> free cash flow
                          growth a year {firstGrowthYear === 2 ? `in years 2–${PROJECTION_YEARS}, after your year 1 forecast,` : `for ${PROJECTION_YEARS} years,`} with
                          your discount rate and terminal value. You assume <strong>{formatPercent(inputs.growthEarly)}</strong> in
                          years {firstGrowthYear}–{STAGE_YEARS} and <strong>{formatPercent(inputs.growthLate)}</strong> in years {STAGE_YEARS + 1}–{PROJECTION_YEARS}
                          {history.cagr ? <>, and free cash flow grew <strong>{formatPercent(history.cagr.rate)}</strong> a year over fiscal {history.cagr.from}–{history.cagr.to}</> : null}.
                        </>
                      )}
              </p>
              <p className="projection-section-intro">
                Instead of guessing growth, a reverse DCF asks what today&apos;s price already expects: the one growth rate for every
                projected year that makes the value equal the price. Well above what the business has done, and the stock leaves little
                room for disappointment; well below, and the price may be too cautious.
              </p>
            </section>

            {history.years.length > 0 && (
              <section className="projection-section" aria-labelledby="dcf-history">
                <div className="content-section-heading">
                  <div>
                    <p className="section-label">HISTORY</p>
                    <h2 id="dcf-history">Free cash flow so far</h2>
                  </div>
                </div>
                <div className="table-scroll">
                  <table className="financial-table three-year-table dcf-history-table">
                    <thead>
                      <tr>
                        <th scope="col">Fiscal year</th>
                        {history.years.map((year) => <th scope="col" key={year.label}>{year.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th scope="row">Free cash flow</th>
                        {history.years.map((year) => <td key={year.label}>{formatMoney(year.freeCashFlow, currency, true)}</td>)}
                      </tr>
                      <tr className="dcf-history-growth">
                        <th scope="row">Growth</th>
                        {history.years.map((year) => (
                          <td key={year.label} className={year.growth === null ? "" : year.growth >= 0 ? "positive-value" : "negative-value"}>
                            {formatSignedPercent(year.growth)}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <p className="table-footnote">
                  {history.cagr
                    ? `Compound growth over fiscal ${history.cagr.from}–${history.cagr.to}: ${formatSignedPercent(history.cagr.rate)} a year. `
                    : ""}
                  Free cash flow swings with investment cycles, so the default growth uses revenue, which is steadier. TTM is the last twelve months, the starting point.
                </p>
              </section>
            )}

            <section className="projection-section" aria-labelledby="dcf-breakdown">
              <div className="content-section-heading">
                <div>
                  <p className="section-label">HOW THE VALUE ADDS UP</p>
                  <h2 id="dcf-breakdown">From cash flows to value per share</h2>
                </div>
              </div>
              <table className="model-steps dcf-breakdown">
                <tbody>
                  <tr><th scope="row">Present value of {PROJECTION_YEARS} years of free cash flow</th><td>{formatMoney(result.presentValueOfCashFlows, currency, true)}</td></tr>
                  <tr>
                    <th scope="row">Present value of the terminal value ({formatPercent(result.terminalShare, 0)} of the total)</th>
                    <td>{formatMoney(result.presentValueOfTerminal, currency, true)}</td>
                  </tr>
                  <tr className="model-steps-total"><th scope="row">Enterprise value</th><td>{formatMoney(result.enterpriseValue, currency, true)}</td></tr>
                  <tr><th scope="row">+ Cash &amp; short-term investments</th><td>{formatMoney(inputs.cash, currency, true)}</td></tr>
                  <tr><th scope="row">− Total debt</th><td>{formatMoney(inputs.debt, currency, true)}</td></tr>
                  <tr className="model-steps-total"><th scope="row">Equity value</th><td>{formatMoney(result.equityValue, currency, true)}</td></tr>
                  <tr><th scope="row">÷ Shares outstanding</th><td>{new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(inputs.shares ?? 0)}</td></tr>
                  <tr className="model-steps-total"><th scope="row">Intrinsic value per share</th><td>{formatMoney(result.valuePerShare, currency)}</td></tr>
                </tbody>
              </table>
            </section>

            <section className="projection-section" aria-labelledby="dcf-years">
              <div className="content-section-heading">
                <div>
                  <p className="section-label">YEAR BY YEAR</p>
                  <h2 id="dcf-years">Projected free cash flow</h2>
                </div>
              </div>
              <div className="table-scroll">
                <table className="financial-table three-year-table">
                  <thead>
                    <tr><th scope="col">Year</th><th scope="col">Free cash flow</th><th scope="col">Discount factor</th><th scope="col">Present value</th></tr>
                  </thead>
                  <tbody>
                    {result.years.map((row) => (
                      <tr key={row.year}>
                        <th scope="row">Year {row.year}</th>
                        <td>{formatMoney(row.freeCashFlow, currency, true)}</td>
                        <td>{row.discountFactor.toFixed(3)}</td>
                        <td>{formatMoney(row.presentValue, currency, true)}</td>
                      </tr>
                    ))}
                    <tr className="dcf-terminal-row">
                      <th scope="row">Terminal value</th>
                      <td>{formatMoney(result.terminalValue, currency, true)}</td>
                      <td>{result.years[result.years.length - 1].discountFactor.toFixed(3)}</td>
                      <td>{formatMoney(result.presentValueOfTerminal, currency, true)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="table-footnote">
                The discount factor is 1 ÷ (1 + discount rate)<sup>year</sup>: what one dollar received that year is worth today.
              </p>
            </section>

            <section className="projection-section" aria-labelledby="dcf-sensitivity">
              <div className="content-section-heading">
                <div>
                  <p className="section-label">SENSITIVITY</p>
                  <h2 id="dcf-sensitivity">Value per share by discount rate and growth</h2>
                </div>
              </div>
              <p className="projection-section-intro">
                The highlighted cell uses your inputs. Green cells are above the current price, red below. If small changes
                flip the answer, treat the estimate with caution.
              </p>
              <div className="table-scroll">
                <table className="financial-table sensitivity-table three-year-table">
                  <thead>
                    <tr>
                      <th scope="col">Discount ↓ / Growth 1–5 →</th>
                      {sensitivity.growthRates.map((rate) => <th scope="col" key={rate}>{formatPercent(rate)}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {sensitivity.discountRates.map((rate, rowIndex) => (
                      <tr key={rate}>
                        <th scope="row">{formatPercent(rate)}</th>
                        {sensitivity.values[rowIndex].map((value, columnIndex) => {
                          const tone = value === null || inputs.price === null ? "" : value >= inputs.price ? "positive-value" : "negative-value";
                          return (
                            <td key={columnIndex} className={`${tone}${rowIndex === 2 && columnIndex === 2 ? " sensitivity-base" : ""}`}>
                              {formatMoney(value, currency)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        <section className="projection-section" aria-labelledby="dcf-how">
          <div className="content-section-heading">
            <div>
              <p className="section-label">HOW IT WORKS</p>
              <h2 id="dcf-how">Discounted cash flow, step by step</h2>
            </div>
          </div>
          <ol className="three-year-steps">
            <li><strong>Project</strong> free cash flow for {PROJECTION_YEARS} years: one growth rate for years 1–{STAGE_YEARS}, another for years {STAGE_YEARS + 1}–{PROJECTION_YEARS}. With a year 1 forecast, year 1 is that figure and growth starts in year 2.</li>
            <li><strong>Discount</strong> each year to today: cash flow ÷ (1 + discount rate)<sup>year</sup>.</li>
            <li><strong>Terminal value</strong> for everything after year {PROJECTION_YEARS}: either year-{PROJECTION_YEARS} cash flow × (1 + g) ÷ (discount rate − g), or that cash flow × an exit multiple. It is discounted like year {PROJECTION_YEARS}.</li>
            <li><strong>Enterprise value</strong> is the sum of those present values. Add cash and subtract debt to get the <strong>equity value</strong>.</li>
            <li>Divide by shares outstanding for the <strong>intrinsic value per share</strong>, then compare it with the price.</li>
            <li>The <strong>reverse DCF</strong> runs it backwards: it finds the one growth rate for every projected year that makes the value equal today&apos;s price, with the other inputs unchanged.</li>
          </ol>
          <p className="projection-section-intro">
            The terminal value is usually most of the result, so the discount rate and terminal assumptions matter most;
            the sensitivity table shows how much.
          </p>
        </section>

        <p className="projection-disclaimer">
          A DCF is only as good as its assumptions. This is an educational tool, not investment advice.
        </p>
      </div>
    </div>
  );
}
