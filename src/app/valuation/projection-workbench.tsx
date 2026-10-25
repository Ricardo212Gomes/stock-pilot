"use client";

import { useMemo, useState, useTransition } from "react";
import {
  ASSUMPTION_GROUPS,
  ASSUMPTION_SPECS,
  type AssumptionKey,
  type Assumptions,
} from "@/lib/valuation/assumptions";
import { STOCK_TYPES, type Classification } from "@/lib/valuation/classify";
import type { DefaultAssumptions } from "@/lib/valuation/defaults";
import { formatMoney, formatPercent, formatSignedPercent } from "@/lib/valuation/format";
import {
  MODEL_INFO,
  MODEL_ORDER,
  blendedValue,
  dcfSensitivity,
  impliedGrowth,
  projectionRows,
  runAllModels,
  scenarioRange,
  verdict,
  type ModelId,
} from "@/lib/valuation/models";
import { SparkIcon } from "../components/spark-icon";
import { autofillAssumptions } from "./actions";
import {
  AssumptionField,
  FootballField,
  ModelCard,
  ProjectionChart,
  ProjectionTable,
  SensitivityTable,
  type ModelRole,
  type ValueSource,
} from "./projection-parts";

type Sources = Record<AssumptionKey, ValueSource>;

const ALL_DATA_SOURCES = Object.fromEntries(
  ASSUMPTION_SPECS.map((spec) => [spec.key, "data"]),
) as Sources;

const VERDICT_HELP = {
  "Below buy price": "The price is below the estimate even after your margin of safety.",
  "Undervalued, thin margin": "The price is below the estimate, but not by as much as your margin of safety asks for.",
  "Above estimate": "The price is higher than these assumptions justify. The market may expect more growth, or the stock may be expensive.",
} as const;

export function ProjectionWorkbench({
  symbol,
  companyName,
  currency,
  classification,
  defaults,
  priceNotice,
}: {
  symbol: string;
  companyName: string | null;
  currency: string;
  classification: Classification;
  defaults: DefaultAssumptions;
  priceNotice: string | null;
}) {
  const [assumptions, setAssumptions] = useState<Assumptions>(defaults.assumptions);
  const [sources, setSources] = useState<Sources>(ALL_DATA_SOURCES);
  const [aiNotes, setAiNotes] = useState<Partial<Record<AssumptionKey, string>>>({});
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [fieldVersion, setFieldVersion] = useState(0);
  const [isAutofilling, startAutofill] = useTransition();

  const typeInfo = STOCK_TYPES[classification.type];
  const roleOf = (id: ModelId): ModelRole =>
    typeInfo.primary.includes(id) ? "primary" : typeInfo.secondary.includes(id) ? "secondary" : "other";
  const orderedModels = [...MODEL_ORDER].sort((left, right) => {
    const rank = { primary: 0, secondary: 1, other: 2 };
    return rank[roleOf(left)] - rank[roleOf(right)];
  });

  const results = useMemo(() => runAllModels(assumptions), [assumptions]);
  const ranges = useMemo(
    () => Object.fromEntries(MODEL_ORDER.map((id) => [id, scenarioRange(id, assumptions)])) as Record<ModelId, ReturnType<typeof scenarioRange>>,
    [assumptions],
  );
  const blended = useMemo(
    () => blendedValue(results, typeInfo.primary, typeInfo.secondary),
    [results, typeInfo],
  );
  const blendedVerdict = blended ? verdict(blended.value, assumptions) : null;
  const marketGrowth = useMemo(() => impliedGrowth(assumptions), [assumptions]);
  const sensitivity = useMemo(() => dcfSensitivity(assumptions), [assumptions]);
  const projection = useMemo(() => projectionRows(assumptions), [assumptions]);
  const dcfAvailable = results.dcf.ok;

  function updateAssumption(key: AssumptionKey, value: number | null) {
    setAssumptions((current) => ({ ...current, [key]: value }));
    setSources((current) => ({ ...current, [key]: "edited" }));
  }

  function resetToData() {
    setAssumptions(defaults.assumptions);
    setSources(ALL_DATA_SOURCES);
    setAiNotes({});
    setAiSummary(null);
    setAiError(null);
    setFieldVersion((version) => version + 1);
  }

  function runAutofill() {
    setAiError(null);
    startAutofill(async () => {
      try {
        const result = await autofillAssumptions(symbol);
        if (!result.ok) {
          setAiError(result.error);
          return;
        }
        const keys = Object.keys(result.suggestions) as AssumptionKey[];
        setAssumptions((current) => {
          const next = { ...current };
          for (const key of keys) next[key] = result.suggestions[key]?.value ?? current[key];
          return next;
        });
        setSources((current) => {
          const next = { ...current };
          for (const key of keys) next[key] = "ai";
          return next;
        });
        setAiNotes(Object.fromEntries(keys.map((key) => [key, result.suggestions[key]?.rationale ?? ""])));
        setAiSummary(result.summary || null);
        setFieldVersion((version) => version + 1);
      } catch {
        setAiError("The autofill failed to run. Please try again.");
      }
    });
  }

  const footballRows = orderedModels
    .filter((id) => results[id].ok && roleOf(id) !== "other")
    .map((id) => ({ id, name: MODEL_INFO[id].name, role: roleOf(id), range: ranges[id] }));

  return (
    <>
      <section className="company-heading">
        <div>
          <p className="section-label">INTRINSIC VALUE</p>
          <div className="company-title-row">
            <h1>{companyName ? `${companyName} (${symbol})` : symbol}</h1>
            <span className="access-badge">{typeInfo.label.toUpperCase()}</span>
          </div>
          <p className="company-subtitle">
            Intrinsic value estimates from {MODEL_ORDER.length} valuation models, built on its annual filings.
          </p>
        </div>
      </section>

      <ol className="projection-guide" aria-label="How to use this page">
        <li>
          <strong>Check the stock type.</strong>
          <span>Different businesses need different models. We picked the ones that fit.</span>
        </li>
        <li>
          <strong>Adjust the assumptions.</strong>
          <span>Every field starts from the filings. Open “What is this?” for an explanation, or let AI suggest values.</span>
        </li>
        <li>
          <strong>Compare value with price.</strong>
          <span>Look at the range across models and scenarios, not a single number.</span>
        </li>
      </ol>

      <section className="stock-type-card" aria-labelledby="stock-type-heading">
        <div>
          <p className="section-label">WHAT KIND OF STOCK IS THIS?</p>
          <h2 id="stock-type-heading">{typeInfo.label}</h2>
          <p>{typeInfo.description}</p>
          <ul className="stock-type-reasons">
            {classification.reasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>
        </div>
        <div className="stock-type-models">
          <p className="section-label">BEST MODELS FOR IT</p>
          <ul>
            {typeInfo.primary.map((id) => <li key={id}><span className="model-role model-role-primary">Recommended</span> {MODEL_INFO[id].name}</li>)}
            {typeInfo.secondary.map((id) => <li key={id}><span className="model-role model-role-secondary">Cross-check</span> {MODEL_INFO[id].name}</li>)}
          </ul>
          <p>{typeInfo.whyModels}</p>
        </div>
      </section>

      <section className="projection-summary" aria-labelledby="projection-summary-heading">
        <div className="projection-summary-figures">
          <div className="projection-summary-main">
            <p className="section-label" id="projection-summary-heading">BLENDED INTRINSIC VALUE</p>
            <strong>{blended ? formatMoney(blended.value, currency) : "—"}</strong>
            <small>
              {blended
                ? `Weighted average of ${blended.used.map((id) => MODEL_INFO[id].name).join(", ")}. Recommended models count twice.`
                : "None of the recommended models can run with these inputs. Check the starting values."}
            </small>
          </div>
          <dl className="projection-summary-stats">
            <div>
              <dt>Current price</dt>
              <dd>{formatMoney(assumptions.currentPrice, currency)}</dd>
            </div>
            <div>
              <dt>Upside / downside</dt>
              <dd className={blendedVerdict ? (blendedVerdict.upside >= 0 ? "positive-value" : "negative-value") : ""}>
                {formatSignedPercent(blendedVerdict?.upside ?? null)}
              </dd>
            </div>
            <div>
              <dt>Buy below ({formatPercent(assumptions.marginOfSafety, 0)} margin)</dt>
              <dd>{formatMoney(blendedVerdict?.buyBelow ?? null, currency)}</dd>
            </div>
          </dl>
        </div>
        {blendedVerdict && (
          <p className={`projection-verdict projection-verdict-${blendedVerdict.label === "Above estimate" ? "above" : "below"}`}>
            <strong>{blendedVerdict.label}.</strong> {VERDICT_HELP[blendedVerdict.label]}
          </p>
        )}
        {priceNotice && <p className="projection-notice" role="status">{priceNotice} Type a price in the starting point to compare.</p>}
      </section>

      <div className="projection-layout">
        <aside className="assumptions-panel" aria-labelledby="assumptions-heading">
          <div className="assumptions-heading">
            <div>
              <p className="section-label">ASSUMPTIONS</p>
              <h2 id="assumptions-heading">Your inputs</h2>
            </div>
            <button className="assumptions-reset" type="button" onClick={resetToData}>Reset</button>
          </div>

          <div className="autofill-box">
            <button className="ai-analysis-button" type="button" onClick={runAutofill} disabled={isAutofilling}>
              <SparkIcon />
              <span>{isAutofilling ? "Thinking…" : "Autofill with AI"}</span>
            </button>
            <p>
              AI reviews the filings and suggests every forward-looking assumption, with a reason for each.
              Starting values always stay as reported.
            </p>
            {isAutofilling && <p className="ai-analysis-status" role="status">Reviewing {symbol}&apos;s history…</p>}
            {aiError && <p className="ai-analysis-error" role="alert">{aiError}</p>}
            {aiSummary && <p className="autofill-summary" aria-live="polite"><strong>AI outlook: </strong>{aiSummary}</p>}
          </div>

          {ASSUMPTION_GROUPS.map((group) => (
            <fieldset className="assumption-group" key={group.id}>
              <legend>{group.title}</legend>
              <p className="assumption-group-description">{group.description}</p>
              {ASSUMPTION_SPECS.filter((spec) => spec.group === group.id).map((spec) => (
                <AssumptionField
                  key={`${spec.key}-${fieldVersion}`}
                  spec={spec}
                  value={assumptions[spec.key]}
                  currency={currency}
                  source={sources[spec.key]}
                  note={sources[spec.key] === "ai" ? aiNotes[spec.key] : defaults.notes[spec.key]}
                  onChange={(value) => updateAssumption(spec.key, value)}
                />
              ))}
            </fieldset>
          ))}
        </aside>

        <div className="projection-results">
          <section className="projection-section" aria-labelledby="models-heading">
            <div className="content-section-heading">
              <div>
                <p className="section-label">VALUATION MODELS</p>
                <h2 id="models-heading">Intrinsic value per share</h2>
              </div>
            </div>
            <p className="projection-section-intro">
              Each model looks at the business from a different angle. Recommended models suit this type of
              company best; cross-checks help you spot an assumption that is off. The range shows bear and bull
              cases, which move growth, the discount rate, margins and the exit multiple against or in favour of
              the stock.
            </p>
            <div className="model-grid">
              {orderedModels.map((id) => (
                <ModelCard
                  key={id}
                  info={MODEL_INFO[id]}
                  result={results[id]}
                  range={ranges[id]}
                  verdict={(() => {
                    const result = results[id];
                    return result.ok ? verdict(result.value, assumptions) : null;
                  })()}
                  role={roleOf(id)}
                  currency={currency}
                />
              ))}
            </div>
          </section>

          {footballRows.length > 0 && (
            <section className="projection-section" aria-labelledby="football-heading">
              <div className="content-section-heading">
                <div>
                  <p className="section-label">AT A GLANCE</p>
                  <h2 id="football-heading">Estimates compared with the price</h2>
                </div>
              </div>
              <p className="projection-section-intro">
                Analysts call this a football field chart. It shows the recommended and cross-check models. When most
                bars sit to the right of the price line, the assumptions point to an undervalued stock; bars to the
                left point the other way.
              </p>
              <FootballField rows={footballRows} price={assumptions.currentPrice} currency={currency} />
            </section>
          )}

          {dcfAvailable && (
            <section className="projection-section" aria-labelledby="reverse-heading">
              <div className="content-section-heading">
                <div>
                  <p className="section-label">REVERSE DCF</p>
                  <h2 id="reverse-heading">What growth does the price assume?</h2>
                </div>
              </div>
              <p className="reverse-dcf-answer">
                {marketGrowth === null
                  ? "Enter a current price to see the growth the market is pricing in."
                  : (
                    <>
                      At {formatMoney(assumptions.currentPrice, currency)}, the market is pricing in about{" "}
                      <strong>{formatPercent(marketGrowth)}</strong> free cash flow growth a year for{" "}
                      {assumptions.growthYears} years, with your discount rate and terminal growth. You assume{" "}
                      <strong>{formatPercent(assumptions.growthRate)}</strong>.
                    </>
                  )}
              </p>
              <p className="projection-section-intro">
                Instead of guessing growth, a reverse DCF asks what the current price already expects. If that
                number looks hard to achieve, the stock leaves little room for disappointment.
              </p>
            </section>
          )}

          <section className="projection-section" aria-labelledby="projection-heading">
            <div className="content-section-heading">
              <div>
                <p className="section-label">PROJECTIONS</p>
                <h2 id="projection-heading">Per-share figures, year by year</h2>
              </div>
            </div>
            <p className="projection-section-intro">
              How the starting values grow under your assumptions. Revenue grows at the revenue growth rate,
              earnings and free cash flow at the earnings growth rate, and dividends at the dividend growth rate.
            </p>
            <ProjectionChart rows={projection} currency={currency} />
            <ProjectionTable rows={projection} currency={currency} />
          </section>

          {dcfAvailable && (
            <section className="projection-section" aria-labelledby="sensitivity-heading">
              <div className="content-section-heading">
                <div>
                  <p className="section-label">SENSITIVITY</p>
                  <h2 id="sensitivity-heading">How the DCF changes with two key inputs</h2>
                </div>
              </div>
              <p className="projection-section-intro">
                The highlighted cell uses your inputs. Green cells are above the current price, red cells below.
                If small changes flip the answer, treat the estimate with extra caution.
              </p>
              <SensitivityTable grid={sensitivity} price={assumptions.currentPrice} currency={currency} />
            </section>
          )}

          <p className="projection-disclaimer">
            Intrinsic value estimates depend entirely on the assumptions above and on reported data, which can be
            incomplete. They are an educational tool, not investment advice.
          </p>
        </div>
      </div>
    </>
  );
}
