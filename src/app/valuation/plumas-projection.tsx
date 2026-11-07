"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { SparkIcon } from "../components/spark-icon";
import { NumberInput } from "./calculator-input";
import { autofillPlumasProjection } from "./actions";
import { formatCell, type ScenarioTone } from "./projection-cells";
import {
  ProjectionSheet,
  ScenarioCards,
  ScenarioChart,
  ScenarioComparison,
  type ScenarioSummary,
} from "./plumas-projection-parts";
import {
  VIEW_KEY,
  parseSavedProjection,
  parseView,
  projectionKey,
  readSaved,
  subscribeSaved,
  writeSaved,
  type ProjectionView,
  type SavedProjection,
} from "./saved-projection";
import {
  SCENARIOS,
  fitToEstimates,
  hasCostOfRevenue,
  netIncomeRatio,
  projectScenario,
  scenariosFor,
  type InputField,
  type ProjectionDefaults,
  type ScenarioCount,
  type ScenarioId,
  type StartingPoint,
} from "@/lib/plumas-projection";

const TONES: Record<ScenarioCount, ScenarioTone[]> = {
  3: ["negative", "chart-1", "positive"],
  5: ["negative", "chart-3", "chart-1", "chart-6", "positive"],
};

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function PlumasProjection({ symbol, defaults }: { symbol: string; defaults: ProjectionDefaults }) {
  const { currency, base, history, notes } = defaults;
  const key = projectionKey(symbol, base.year);
  // The server renders the starting values; a projection saved in this browser replaces them.
  const savedText = useSyncExternalStore(subscribeSaved, () => readSaved(key), () => null);
  const viewText = useSyncExternalStore(subscribeSaved, () => readSaved(VIEW_KEY), () => null);
  const saved = useMemo(() => parseSavedProjection(savedText), [savedText]);
  const view = useMemo(() => parseView(viewText), [viewText]);
  const scenarios = saved?.scenarios ?? defaults.scenarios;
  const ai = saved?.ai ?? null;
  const mode = view.mode ?? defaults.mode;

  const [start, setStart] = useState<StartingPoint>(defaults.start);
  const [startVersion, setStartVersion] = useState(0);
  const [picked, setPicked] = useState<ScenarioId>("base");
  const [aiError, setAiError] = useState<string | null>(null);
  const [isAutofilling, startAutofill] = useTransition();

  const visible = scenariosFor(view.count);
  const selected = visible.some(({ id }) => id === picked) ? picked : "base";
  const projections = useMemo(
    () => Object.fromEntries(SCENARIOS.map(({ id }) => [id, projectScenario(mode, base, start, scenarios[id])])) as
      Record<ScenarioId, ReturnType<typeof projectScenario>>,
    [mode, base, start, scenarios],
  );
  const summaries: ScenarioSummary[] = visible.map(({ id, label }, index) => {
    const result = projections[id];
    return { id, label, tone: TONES[view.count][index], years: result.ok ? result.years : null };
  });
  const current = summaries.find(({ id }) => id === selected)!;
  const projection = projections[selected];
  const withCost = hasCostOfRevenue(base);
  const lastYear = defaults.years[defaults.years.length - 1];
  const ttmPe = start.price !== null && defaults.ttmEps !== null && defaults.ttmEps > 0 ? start.price / defaults.ttmEps : null;
  const marketCap = start.price !== null && start.shares !== null ? start.price * start.shares : null;
  const ratio = netIncomeRatio(base);
  const canSimple = base.netIncome !== null && base.netIncome > 0;
  const estimated = defaults.years.flatMap((year, index) => {
    const estimate = defaults.estimates[index];
    return estimate && (estimate.revenue.avg !== null || estimate.eps.avg !== null) ? [{ year, estimate }] : [];
  });
  // Price ÷ analysts' EPS for the first projected year they cover.
  const forward = estimated.find(({ estimate }) => (estimate.eps.avg ?? 0) > 0);
  const forwardPe = forward && start.price !== null ? start.price / forward.estimate.eps.avg! : null;

  function save(next: Partial<SavedProjection>) {
    writeSaved(key, JSON.stringify({ scenarios, ai, ...next }));
  }

  function setView(next: Partial<ProjectionView>) {
    writeSaved(VIEW_KEY, JSON.stringify({ ...view, ...next }));
  }

  function setValue(field: InputField, index: number, value: number) {
    const inputs = scenarios[selected];
    save({ scenarios: { ...scenarios, [selected]: { ...inputs, [field]: inputs[field].map((item, position) => (position === index ? value : item)) } } });
  }

  function fillRow(field: InputField) {
    const inputs = scenarios[selected];
    save({ scenarios: { ...scenarios, [selected]: { ...inputs, [field]: inputs[field].map(() => inputs[field][0]) } } });
  }

  function copyBase() {
    save({ scenarios: { ...scenarios, [selected]: structuredClone(scenarios.base) } });
  }

  function applyEstimates() {
    save({ scenarios: { ...scenarios, [selected]: fitToEstimates(base, start, scenarios[selected], defaults.estimates) } });
  }

  function reset() {
    writeSaved(key, null);
    setStart(defaults.start);
    setStartVersion((version) => version + 1);
    setAiError(null);
  }

  function runAutofill() {
    setAiError(null);
    startAutofill(async () => {
      try {
        const response = await autofillPlumasProjection(symbol);
        if (!response.ok) {
          setAiError(response.error);
          return;
        }
        // Built on what's saved now, in case a box was edited while the AI was working.
        const latest = parseSavedProjection(readSaved(key))?.scenarios ?? defaults.scenarios;
        const next = { ...latest };
        const rationale: Partial<Record<ScenarioId, string>> = {};
        for (const { id } of SCENARIOS) {
          const suggestion = response.scenarios[id];
          if (!suggestion) continue;
          next[id] = { ...next[id], ...suggestion.inputs };
          if (suggestion.rationale) rationale[id] = suggestion.rationale;
        }
        writeSaved(key, JSON.stringify({ scenarios: next, ai: { summary: response.summary, rationale } } satisfies SavedProjection));
      } catch {
        setAiError("The autofill failed to run. Please try again.");
      }
    });
  }

  return (
    <div className="plumas-projection">
      <section className="projection-toolbar" aria-label="Starting point and view">
        <dl className="projection-stats">
          <div>
            <dt><label htmlFor="projection-price">Price today</label></dt>
            <dd>
              <NumberInput
                key={`price-${startVersion}`}
                id="projection-price"
                label="Share price today"
                value={start.price}
                unit="currency"
                currency={currency}
                onChange={(price) => setStart((previous) => ({ ...previous, price }))}
              />
            </dd>
          </div>
          <div>
            <dt><label htmlFor="projection-shares" title={notes.shares}>Shares outstanding</label></dt>
            <dd>
              <NumberInput
                key={`shares-${startVersion}`}
                id="projection-shares"
                label="Shares outstanding today, in millions"
                value={start.shares}
                unit="shares"
                currency={currency}
                onChange={(shares) => setStart((previous) => ({ ...previous, shares }))}
              />
            </dd>
          </div>
          <div>
            <dt>Market cap</dt>
            <dd>{formatCell(marketCap, "money", currency)}</dd>
          </div>
          <div>
            <dt>P/E (TTM)</dt>
            <dd>{ttmPe === null ? "—" : ttmPe.toFixed(1)}</dd>
          </div>
          {forward && (
            <div>
              <dt title={`Today's price ÷ analysts' average EPS for fiscal ${forward.year}`}>P/E ({forward.year} est.)</dt>
              <dd>{forwardPe === null ? "—" : forwardPe.toFixed(1)}</dd>
            </div>
          )}
        </dl>

        <div className="projection-controls">
          <div className="chart-view-switch" role="group" aria-label="Projection detail">
            {(["simple", "advanced"] as const).map((option) => (
              <button
                key={option}
                type="button"
                className={mode === option ? "chart-view-active" : ""}
                aria-pressed={mode === option}
                onClick={() => setView({ mode: option })}
              >
                {option === "simple" ? "Simple" : "Advanced"}
              </button>
            ))}
          </div>
          <div className="chart-view-switch" role="group" aria-label="Number of scenarios">
            {([3, 5] as const).map((count) => (
              <button
                key={count}
                type="button"
                className={view.count === count ? "chart-view-active" : ""}
                aria-pressed={view.count === count}
                onClick={() => setView({ count })}
              >
                {count} scenarios
              </button>
            ))}
          </div>
          <button className="ai-analysis-button" type="button" onClick={runAutofill} disabled={isAutofilling}>
            <SparkIcon />
            <span>{isAutofilling ? "Thinking…" : "Autofill with AI"}</span>
          </button>
          <button className="assumptions-reset" type="button" onClick={reset}>Reset</button>
        </div>

        <p className="projection-status" role="status">
          {isAutofilling
            ? `AI is reviewing ${symbol}'s history and filling every scenario…`
            : saved
              ? "Your projection is saved in this browser. Reset goes back to the starting values."
              : "Boxed cells are inputs, one per year. They start from the filings, and everything updates as you type."}
        </p>
        {aiError && <p className="ai-analysis-error" role="alert">{aiError}</p>}
        {ai?.summary && <p className="projection-ai-note"><strong>AI outlook: </strong>{ai.summary}</p>}
      </section>

      <ScenarioCards scenarios={summaries} selected={selected} lastYear={lastYear} currency={currency} onSelect={setPicked} />

      <section className={`projection-sheet-card scenario-tone-${current.tone}`} aria-labelledby="projection-sheet-heading">
        <div className="projection-sheet-heading">
          <div>
            <p className="section-label">{mode === "simple" ? "SIMPLE" : "ADVANCED"} · YEAR BY YEAR</p>
            <h2 id="projection-sheet-heading"><span className="scenario-dot" aria-hidden="true" />{current.label} scenario</h2>
          </div>
          <div className="projection-sheet-actions">
            {estimated.length > 0 && (
              <button
                className="assumptions-reset"
                type="button"
                onClick={applyEstimates}
                title={`Fit ${estimated.map(({ year }) => year).join(", ")} to the analysts' revenue and EPS`}
              >
                Use analysts&apos; estimates
              </button>
            )}
            {selected !== "base" && (
              <button className="assumptions-reset" type="button" onClick={copyBase}>Copy Base inputs</button>
            )}
          </div>
        </div>
        {ai?.rationale[selected] && <p className="projection-ai-note"><strong>Why AI chose these: </strong>{ai.rationale[selected]}</p>}
        {projection.ok ? (
          <>
            <ProjectionSheet
              mode={mode}
              scenarioLabel={current.label}
              history={history}
              years={projection.years}
              inputs={scenarios[selected]}
              estimates={defaults.estimates}
              currency={currency}
              withCost={withCost}
              onChange={setValue}
              onFill={fillRow}
            />
            <p className="table-footnote">
              Reported years show what the company did; the boxes are this scenario&apos;s inputs for each projected
              year, and the arrow beside a row copies {defaults.years[0]}&apos;s value to every year. CAGR is the yearly
              return from today&apos;s price, before dividends.
              {estimated.length > 0 && " Analysts' rows are the consensus average; point at one for the range and the number of analysts."}
            </p>
          </>
        ) : (
          <div className="projection-notice">
            <p>{projection.reason}</p>
            {mode === "simple" && !canSimple && base.operatingIncome !== null && (
              <button className="assumptions-reset" type="button" onClick={() => setView({ mode: "advanced" })}>Switch to Advanced</button>
            )}
          </div>
        )}
      </section>

      {summaries.some(({ years }) => years) && (
        <section className="projection-section" aria-labelledby="projection-compare-heading">
          <div className="content-section-heading">
            <div>
              <p className="section-label">ALL SCENARIOS</p>
              <h2 id="projection-compare-heading">Bear, base and bull side by side</h2>
            </div>
          </div>
          <p className="projection-section-intro">
            The line is each scenario&apos;s mid price, from today&apos;s{start.price === null ? "" : ` ${formatCell(start.price, "perShare", currency)}`} (the
            dashed line); the shaded band is the {current.label.toLowerCase()} scenario&apos;s low to high range. Pick a scenario to edit it above.
          </p>
          <ScenarioChart scenarios={summaries} selected={selected} price={start.price} currency={currency} />
          <ScenarioComparison scenarios={summaries} selected={selected} mode={mode} base={base} currency={currency} onSelect={setPicked} />
        </section>
      )}

      <section className="projection-section" aria-labelledby="projection-how-heading">
        <div className="content-section-heading">
          <div>
            <p className="section-label">HOW IT WORKS</p>
            <h2 id="projection-how-heading">From revenue to share price</h2>
          </div>
        </div>
        {mode === "simple" ? (
          <ol className="three-year-steps">
            <li><strong>Revenue</strong> and <strong>net income</strong> each grow from fiscal {base.year} at their own rate for each year; the <strong>net margin</strong> is one over the other.</li>
            <li><strong>EPS</strong> is net income ÷ today&apos;s shares outstanding, the same count in every year.</li>
            <li><strong>Price</strong> is EPS × the low and the high P/E.</li>
            <li><strong>CAGR</strong> is (price ÷ today&apos;s price)<sup>1/years</sup> − 1, counting {defaults.years[0]} as one year away and {lastYear} as five.</li>
          </ol>
        ) : (
          <ol className="three-year-steps">
            <li><strong>Revenue</strong>, {withCost ? <><strong>cost of revenue</strong>, </> : null}<strong>operating expenses</strong> and <strong>interest &amp; other</strong> each grow from fiscal {base.year} at their own rate for each year.</li>
            <li>{withCost ? <><strong>Gross profit</strong> is revenue − cost of revenue, and <strong>operating income</strong> is gross profit − operating expenses.</> : <><strong>Operating income</strong> is revenue − operating expenses.</>}</li>
            <li><strong>Net income</strong> is (operating income + interest &amp; other) × {percent(ratio.value)}, {ratio.fromFilings ? `fiscal ${base.year}'s ratio of net income to pretax income` : "a 21% tax rate"}.</li>
            <li><strong>Shares</strong> start from today&apos;s count and fall each year by the buyback yield (or rise, with dilution). <strong>EPS</strong> is net income ÷ shares.</li>
            <li><strong>Price</strong> is EPS × the low, mid and high P/E, and <strong>market cap (mid)</strong> is the mid price × shares.</li>
            <li><strong>CAGR</strong> is (price ÷ today&apos;s price)<sup>1/years</sup> − 1, counting {defaults.years[0]} as one year away and {lastYear} as five.</li>
          </ol>
        )}
        <h3 className="projection-subheading">Where the starting values come from</h3>
        <ul className="projection-notes">
          <li><strong>Revenue growth: </strong>{notes.revenueGrowth}</li>
          {mode === "simple" ? (
            <li><strong>Net income growth: </strong>{notes.netIncomeGrowth}</li>
          ) : (
            <>
              <li><strong>Costs: </strong>{notes.costs}</li>
              <li><strong>Interest &amp; other: </strong>{notes.other}</li>
              <li><strong>Net income: </strong>{notes.netIncome}</li>
              <li><strong>Buyback yield: </strong>{notes.buybackYield}</li>
            </>
          )}
          <li><strong>P/E: </strong>{notes.pe}</li>
          <li><strong>Scenarios: </strong>{notes.scenarios}</li>
          <li><strong>Shares outstanding: </strong>{notes.shares}</li>
          <li>
            <strong>Analysts&apos; estimates: </strong>
            {estimated.length > 0
              ? `the consensus for fiscal ${estimated[0].year}${estimated.length > 1 ? `–${estimated[estimated.length - 1].year}` : ""} from Financial Modeling Prep. Use analysts' estimates fits the selected scenario to them: revenue growth to their revenue, and net income (Simple) or operating expenses (Advanced) to their EPS, keeping the gross margin; other years and the P/E range stay as they are.`
              : "none are available for these years on the current data plan."}
          </li>
        </ul>
      </section>

      <p className="projection-disclaimer">
        Projections depend entirely on the inputs above. They are an educational tool, not investment advice.
      </p>
    </div>
  );
}
