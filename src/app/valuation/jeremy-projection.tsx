"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { NumberInput } from "./calculator-input";
import { CaseTable, JeremyChart, type CaseSummary } from "./jeremy-projection-parts";
import { formatCell, toneOf, type ScenarioTone } from "./projection-cells";
import { jeremyKey, parseSavedJeremy, readSaved, subscribeSaved, writeSaved, type SavedJeremy } from "./saved-projection";
import {
  CASES,
  JEREMY_YEARS,
  projectCase,
  type CaseField,
  type CaseId,
  type JeremyDefaults,
  type JeremyStart,
} from "@/lib/jeremy-projection";

const TONES: Record<CaseId, ScenarioTone> = { bull: "positive", base: "chart-1", bear: "negative" };

export function JeremyProjection({ symbol, defaults }: { symbol: string; defaults: JeremyDefaults }) {
  const { currency, notes } = defaults;
  const key = jeremyKey(symbol, defaults.start.year);
  // The server renders the starting values; a projection saved in this browser replaces them.
  const savedText = useSyncExternalStore(subscribeSaved, () => readSaved(key), () => null);
  const saved = useMemo(() => parseSavedJeremy(savedText), [savedText]);
  const cases = saved?.cases ?? defaults.cases;
  const edits = saved?.start ?? { revenue: null, netIncome: null, shares: null };
  const start: JeremyStart = {
    ...defaults.start,
    revenue: edits.revenue ?? defaults.start.revenue,
    netIncome: edits.netIncome ?? defaults.start.netIncome,
    shares: edits.shares ?? defaults.start.shares,
  };

  const [entryPrice, setEntryPrice] = useState<number | null>(null);
  const [version, setVersion] = useState(0);
  // Three cases of five years: cheap enough to work out on every render.
  const projections = Object.fromEntries(CASES.map(({ id }) => [id, projectCase(start, cases[id], entryPrice)])) as
    Record<CaseId, ReturnType<typeof projectCase>>;
  const summaries: CaseSummary[] = CASES.map(({ id, label }) => {
    const result = projections[id];
    return { id, label, tone: TONES[id], years: result.ok ? result.years : null };
  });
  const lastYear = defaults.start.year + JEREMY_YEARS - 1;
  const from = entryPrice !== null && entryPrice > 0 ? entryPrice : start.price;
  const marketCap = start.price !== null && start.shares !== null ? start.price * start.shares : null;

  function save(next: Partial<SavedJeremy>) {
    writeSaved(key, JSON.stringify({ cases, start: edits, ...next } satisfies SavedJeremy));
  }

  function setValue(id: CaseId, field: CaseField, index: number, value: number) {
    const inputs = cases[id];
    save({ cases: { ...cases, [id]: { ...inputs, [field]: inputs[field].map((item, position) => (position === index ? value : item)) } } });
  }

  // Growth rates copy the second year's value forward; the P/E range copies the first year's.
  function fillRow(id: CaseId, field: CaseField) {
    const inputs = cases[id];
    const source = field === "peLow" || field === "peHigh" ? 0 : 1;
    save({ cases: { ...cases, [id]: { ...inputs, [field]: inputs[field].map((item, index) => (index > source ? inputs[field][source] : item)) } } });
  }

  function setStart(field: keyof SavedJeremy["start"], value: number | null) {
    save({ start: { ...edits, [field]: value } });
  }

  function reset() {
    writeSaved(key, null);
    setEntryPrice(null);
    setVersion((current) => current + 1);
  }

  return (
    <div className="jeremy-projection">
      <section className="projection-toolbar" aria-label="Starting point">
        <dl className="projection-stats">
          <div>
            <dt>Stock price</dt>
            <dd>{formatCell(start.price, "perShare", currency)}</dd>
          </div>
          <div>
            <dt>Market cap</dt>
            <dd>{formatCell(marketCap, "money", currency)}</dd>
          </div>
          <div>
            <dt><label htmlFor="jeremy-shares" title={notes.shares}>Shares outstanding</label></dt>
            <dd>
              <NumberInput
                key={`shares-${version}`}
                id="jeremy-shares"
                label="Shares outstanding today, in millions"
                value={start.shares}
                unit="shares"
                currency={currency}
                onChange={(value) => setStart("shares", value)}
              />
            </dd>
          </div>
          <div className="jeremy-stat-wide">
            <dt><label htmlFor="jeremy-revenue">Fiscal {start.year} revenue</label></dt>
            <dd>
              <NumberInput
                key={`revenue-${version}`}
                id="jeremy-revenue"
                label={`Fiscal ${start.year} revenue, in millions`}
                value={start.revenue}
                unit="millions"
                currency={currency}
                onChange={(value) => setStart("revenue", value)}
              />
            </dd>
          </div>
          <div className="jeremy-stat-wide">
            <dt><label htmlFor="jeremy-net-income">Fiscal {start.year} net income</label></dt>
            <dd>
              <NumberInput
                key={`net-income-${version}`}
                id="jeremy-net-income"
                label={`Fiscal ${start.year} net income, in millions`}
                value={start.netIncome}
                unit="millions"
                currency={currency}
                onChange={(value) => setStart("netIncome", value)}
              />
            </dd>
          </div>
        </dl>
        <div className="projection-controls">
          <button className="assumptions-reset" type="button" onClick={reset}>Reset</button>
        </div>
        <p className="projection-status" role="status">
          {notes.start}
          {saved ? " Your projection is saved in this browser; Reset goes back to the starting values." : " Boxed cells are inputs, and everything updates as you type."}
        </p>
      </section>

      {CASES.map(({ id, label }) => {
        const result = projections[id];
        const last = result.ok ? result.years[result.years.length - 1] : null;
        return (
          <section key={id} className={`projection-sheet-card scenario-tone-${TONES[id]}`} aria-labelledby={`jeremy-${id}-heading`}>
            <div className="projection-sheet-heading">
              <h2 id={`jeremy-${id}-heading`}><span className="scenario-dot" aria-hidden="true" />{label}</h2>
              {last && last.priceLow !== null && last.priceHigh !== null && (
                <p className="jeremy-case-target">
                  Price target {lastYear}: <strong>{formatCell(last.priceLow, "price", currency)}–{formatCell(last.priceHigh, "price", currency)}</strong>
                  {last.cagrLow !== null && last.cagrHigh !== null && (
                    <>
                      {" · CAGR "}
                      <span className={toneOf(last.cagrLow)}>{formatCell(last.cagrLow, "signedWholePercent", currency)}</span> to{" "}
                      <span className={toneOf(last.cagrHigh)}>{formatCell(last.cagrHigh, "signedWholePercent", currency)}</span>
                    </>
                  )}
                </p>
              )}
            </div>
            {result.ok ? (
              <CaseTable
                caseLabel={label}
                startLabel={defaults.startSource === "consensus" ? "Consensus" : "Reported"}
                years={result.years}
                inputs={cases[id]}
                currency={currency}
                onChange={(field, index, value) => setValue(id, field, index, value)}
                onFill={(field) => fillRow(id, field)}
              />
            ) : (
              <p className="projection-notice">{result.reason}</p>
            )}
          </section>
        );
      })}

      {summaries.some(({ years }) => years) && (
        <section className="projection-section" aria-labelledby="jeremy-chart-heading">
          <div className="content-section-heading jeremy-chart-heading">
            <div>
              <p className="section-label">PRICE PROJECTIONS</p>
              <h2 id="jeremy-chart-heading">Bull, base and bear, year by year</h2>
            </div>
            <div className="jeremy-entry">
              <div>
                <span className="jeremy-entry-label">Current price (live)</span>
                <strong>{formatCell(start.price, "perShare", currency)}</strong>
              </div>
              <div>
                <label className="jeremy-entry-label" htmlFor="jeremy-entry-price">Adjust entry price</label>
                <NumberInput
                  key={`entry-${version}`}
                  id="jeremy-entry-price"
                  label="Entry price for the CAGR"
                  value={entryPrice}
                  unit="currency"
                  currency={currency}
                  onChange={setEntryPrice}
                />
              </div>
              <button
                className="assumptions-reset"
                type="button"
                onClick={() => {
                  setEntryPrice(null);
                  setVersion((current) => current + 1);
                }}
              >
                Reset
              </button>
            </div>
          </div>
          <JeremyChart cases={summaries} from={from} fromLabel={entryPrice !== null && entryPrice > 0 ? "Entry" : "Current"} currency={currency} />
          <p className="table-footnote">
            Each line runs through the middle of a case&apos;s price range and the bars span its low and high targets.
            Point at a year for the ranges and their CAGR, measured from the {entryPrice !== null && entryPrice > 0 ? "entry" : "current"} price
            {from === null ? "" : ` of ${formatCell(from, "perShare", currency)}`}; an entry price changes the CAGR rows above too.
          </p>
        </section>
      )}

      <section className="projection-section" aria-labelledby="jeremy-how-heading">
        <div className="content-section-heading">
          <div>
            <p className="section-label">HOW IT WORKS</p>
            <h2 id="jeremy-how-heading">From this year&apos;s consensus to the share price</h2>
          </div>
        </div>
        <ol className="three-year-steps">
          <li><strong>Fiscal {start.year}</strong> is the starting point, from {defaults.startSource === "consensus" ? "analysts' consensus for the year in progress" : "the last annual report"}; type over its revenue and net income above to change it.</li>
          <li>From {start.year + 1}, <strong>revenue</strong> and <strong>net income</strong> each grow at their own rate for each year, rounded to whole units each year; the <strong>net income margin</strong> is one over the other.</li>
          <li><strong>EPS</strong> is net income ÷ today&apos;s shares outstanding, the same count in every year.</li>
          <li><strong>Share price</strong> is EPS × the low and the high P/E.</li>
          <li><strong>CAGR</strong> is (price ÷ today&apos;s price)<sup>1/years</sup> − 1, counting {start.year} as year 0, so it starts in {start.year + 2}. It leaves out dividends.</li>
        </ol>
        <h3 className="projection-subheading">Where the starting values come from</h3>
        <ul className="projection-notes">
          <li><strong>Growth: </strong>{notes.growth}</li>
          <li><strong>P/E: </strong>{notes.pe}</li>
          <li><strong>Cases: </strong>{notes.cases}</li>
          <li><strong>Shares outstanding: </strong>{notes.shares}</li>
        </ul>
        <p className="projection-section-intro">
          This follows Jeremy Lefebvre&apos;s (1000xStocks) projection: from the same inputs it gives the same revenue, net
          income, EPS, prices and CAGRs as his sheet.
        </p>
      </section>

      <p className="projection-disclaimer">
        Projections depend entirely on the inputs above. They are an educational tool, not investment advice.
      </p>
    </div>
  );
}
