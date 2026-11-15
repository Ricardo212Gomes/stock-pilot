"use client";

import { useMemo, useState } from "react";
import { ASSUMPTION_SPEC_BY_KEY, type Assumptions } from "@/lib/valuation/assumptions";
import {
  computeDcf,
  FADE,
  PROJECTION_YEARS,
  stockCompShare,
  TERMINAL_SHARE_WARNING,
  type DcfOptions,
  type FcfBase,
  type FcfBasis,
  type TerminalMethod,
} from "@/lib/valuation/dcf";
import { formatMoney, formatMultiple, formatPercent, formatSignedPercent } from "@/lib/valuation/format";
import { dcfSensitivity, type SensitivityAxis } from "@/lib/valuation/models";
import { NumberInput } from "./calculator-input";
import { AssumptionField, SensitivityTable, type ValueSource } from "./projection-parts";

// The Intrinsic Value page's Detailed DCF (see docs/valuation.md): the DCF's own inputs, its checks, the ten years,
// the step from cash flows to value per share, free cash flow history and the sensitivity grid. It works on the
// page's assumptions, so everything here moves the DCF card, the blended value and the reverse DCF too.

const STAGE_LABEL = { forecast: "Your forecast", growth: "High growth", fade: "Fading" } as const;

export function DcfPanel({
  assumptions,
  currency,
  options,
  onOptions,
  fcf,
  basis,
  stockCompAsCost,
  onStartingFcf,
  multipleSource,
  multipleNote,
  onMultiple,
  defaultOpen,
  version,
}: {
  // Bumped when values change from outside (reset, autofill), so the inputs show them.
  version: number;
  assumptions: Assumptions;
  currency: string;
  options: DcfOptions;
  onOptions: (options: DcfOptions) => void;
  fcf: FcfBase;
  basis: FcfBasis;
  stockCompAsCost: boolean;
  onStartingFcf: (basis: FcfBasis, stockCompAsCost: boolean) => void;
  multipleSource: ValueSource;
  multipleNote: string | undefined;
  onMultiple: (value: number | null) => void;
  defaultOpen: boolean;
}) {
  const [axis, setAxis] = useState<SensitivityAxis>("terminal");
  const result = useMemo(() => computeDcf(assumptions, options), [assumptions, options]);
  const sensitivity = useMemo(() => dcfSensitivity(assumptions, options, axis), [assumptions, options, axis]);
  const compShare = stockCompShare(fcf);
  const price = assumptions.currentPrice;
  const latestYear = fcf.history[0]?.fiscalYear;
  const highGrowthYears = Math.min(assumptions.growthYears ?? 5, PROJECTION_YEARS);

  const setTerminal = (terminalMethod: TerminalMethod) => onOptions({ ...options, terminalMethod });

  return (
    <details className="projection-section dcf-panel" id="detailed-dcf" open={defaultOpen}>
      <summary className="dcf-panel-summary">
        <span>
          <span className="section-label">DETAILED DCF</span>
          <span className="dcf-panel-title">Ten years of free cash flow, step by step</span>
        </span>
        <span className="dcf-panel-value">
          {result.ok ? formatMoney(result.dcf.value, currency) : "Not available"}
          {result.ok && price !== null && price > 0 && <small>{formatSignedPercent(result.dcf.value / price - 1)} vs price</small>}
        </span>
      </summary>

      <p className="projection-section-intro">
        Free cash flow per share grows at your rate for {highGrowthYears} year{highGrowthYears === 1 ? "" : "s"}
        {highGrowthYears < PROJECTION_YEARS
          ? `, then the growth above terminal growth shrinks by ${formatPercent(FADE, 0)} a year until year ${PROJECTION_YEARS}`
          : ""}
        . A terminal value covers the years after, and everything is discounted at your discount rate. The cash flow is
        after interest, so it belongs to shareholders and no debt is subtracted.
      </p>

      <div className="dcf-panel-inputs">
        <fieldset className="dcf-panel-choice">
          <legend>Starting free cash flow</legend>
          <label>
            <input type="radio" name="dcf-basis" checked={basis === "reported"} onChange={() => onStartingFcf("reported", stockCompAsCost)} />
            As reported: operating cash flow less capital spending
          </label>
          <label>
            <input type="radio" name="dcf-basis" checked={basis === "smoothed"} onChange={() => onStartingFcf("smoothed", stockCompAsCost)} />
            Smoothed: less the 3-year average capital spending
          </label>
          <label className="dcf-panel-check">
            <input type="checkbox" checked={stockCompAsCost} onChange={(event) => onStartingFcf(basis, event.target.checked)} />
            Count stock-based pay as a cost
          </label>
          <p className="assumption-short">
            {compShare !== null && compShare > 0.005
              ? `Stock-based pay was ${formatPercent(compShare)} of free cash flow${latestYear ? ` in fiscal ${latestYear}` : ""}. Operating cash flow adds it back as if it were free, though it dilutes shareholders.`
              : "The filings show no meaningful stock-based pay."}{" "}
            {fcf.averageYears ? "A cyclical company starts from the average across the years shown." : ""}
          </p>
        </fieldset>

        <div className="dcf-panel-choice">
          <label className="dcf-panel-label" htmlFor="dcf-first-year">Year 1 free cash flow per share</label>
          <NumberInput
            key={`first-year-${version}`}
            id="dcf-first-year"
            label="Year 1 free cash flow per share"
            value={options.firstYearFcf}
            unit="currency"
            currency={currency}
            onChange={(firstYearFcf) => onOptions({ ...options, firstYearFcf })}
          />
          <p className="assumption-short">
            Optional: a forecast for next year, such as guidance or an analyst estimate, when it will differ a lot from
            the last year. Blank grows today&apos;s.
          </p>
        </div>

        <fieldset className="dcf-panel-choice">
          <legend>Terminal value</legend>
          <label>
            <input type="radio" name="dcf-terminal" checked={options.terminalMethod === "growth"} onChange={() => setTerminal("growth")} />
            Perpetual growth at {formatPercent(assumptions.terminalGrowth)}
          </label>
          <label>
            <input type="radio" name="dcf-terminal" checked={options.terminalMethod === "multiple"} onChange={() => setTerminal("multiple")} />
            Exit multiple of year {PROJECTION_YEARS} free cash flow
          </label>
          {options.terminalMethod === "multiple" && (
            <AssumptionField
              key={`multiple-${version}`}
              spec={ASSUMPTION_SPEC_BY_KEY.terminalMultiple}
              value={assumptions.terminalMultiple}
              currency={currency}
              source={multipleSource}
              note={multipleNote}
              onChange={onMultiple}
            />
          )}
        </fieldset>
      </div>

      {!result.ok ? (
        <p className="model-card-reason">{result.reason}</p>
      ) : (
        <>
          <ul className="dcf-checks">
            <li className={result.dcf.terminalShare > TERMINAL_SHARE_WARNING ? "dcf-check-warning" : undefined}>
              <strong>{formatPercent(result.dcf.terminalShare)}</strong> of the value is the terminal value.{" "}
              {result.dcf.terminalShare > TERMINAL_SHARE_WARNING
                ? `Above ${formatPercent(TERMINAL_SHARE_WARNING, 0)}, the estimate leans on the years nobody can forecast: check the growth and the terminal assumptions.`
                : "60–75% is ordinary."}
            </li>
            <li>
              {options.terminalMethod === "growth" ? (
                <>
                  Growing {formatPercent(assumptions.terminalGrowth)} forever values year {PROJECTION_YEARS} at{" "}
                  <strong>{formatMultiple(result.dcf.impliedMultiple)}</strong> its free cash flow; mature companies trade at
                  about 12–20×.
                </>
              ) : (
                <>
                  An exit multiple of {formatMultiple(result.dcf.impliedMultiple)} amounts to{" "}
                  <strong>{formatPercent(result.dcf.impliedGrowth)}</strong> growth forever; long-run growth is about 2–3%.
                </>
              )}
            </li>
            {result.dcf.reinvestment !== null && (
              <li className={result.dcf.reinvestment > 1 ? "dcf-check-warning" : undefined}>
                Growing {formatPercent(result.dcf.impliedGrowth)} a year forever means reinvesting{" "}
                <strong>{formatPercent(result.dcf.reinvestment)}</strong> of earnings at your{" "}
                {formatPercent(assumptions.returnOnEquity)} return on equity (growth ÷ ROE).
                {result.dcf.reinvestment > 1 ? " That's more than the business earns." : ""}
              </li>
            )}
          </ul>

          <div className="table-scroll">
            <table className="financial-table dcf-years">
              <caption className="visually-hidden">Projected free cash flow per share and its present value</caption>
              <thead>
                <tr>
                  <th scope="col">Year</th>
                  <th scope="col" className="portfolio-optional">Stage</th>
                  <th scope="col">Growth</th>
                  <th scope="col">Free cash flow</th>
                  <th scope="col" className="portfolio-optional">Discount factor</th>
                  <th scope="col">Present value</th>
                </tr>
              </thead>
              <tbody>
                {result.dcf.years.map((row) => (
                  <tr key={row.year}>
                    <th scope="row">{row.year}</th>
                    <td className="portfolio-optional">{STAGE_LABEL[row.stage]}</td>
                    <td>{row.growth === null ? "—" : formatPercent(row.growth)}</td>
                    <td>{formatMoney(row.fcf, currency)}</td>
                    <td className="portfolio-optional">{row.discountFactor.toFixed(3)}</td>
                    <td>{formatMoney(row.presentValue, currency)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Terminal</th>
                  <td className="portfolio-optional">{options.terminalMethod === "growth" ? "Perpetual growth" : "Exit multiple"}</td>
                  <td>{options.terminalMethod === "growth" ? formatPercent(assumptions.terminalGrowth) : formatMultiple(assumptions.terminalMultiple)}</td>
                  <td>{formatMoney(result.dcf.terminalValue, currency)}</td>
                  <td className="portfolio-optional">{result.dcf.years[result.dcf.years.length - 1].discountFactor.toFixed(3)}</td>
                  <td>{formatMoney(result.dcf.presentValueOfTerminal, currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <dl className="dcf-bridge">
            <div>
              <dt>Present value of years 1–{PROJECTION_YEARS}</dt>
              <dd>{formatMoney(result.dcf.presentValueOfYears, currency)}</dd>
            </div>
            <div>
              <dt>+ Present value of the terminal value</dt>
              <dd>{formatMoney(result.dcf.presentValueOfTerminal, currency)}</dd>
            </div>
            <div className="dcf-bridge-total">
              <dt>= Intrinsic value per share</dt>
              <dd>{formatMoney(result.dcf.value, currency)}</dd>
            </div>
            {price !== null && price > 0 && (
              <div>
                <dt>Against today&apos;s {formatMoney(price, currency)}</dt>
                <dd className={result.dcf.value >= price ? "positive-value" : "negative-value"}>{formatSignedPercent(result.dcf.value / price - 1)}</dd>
              </div>
            )}
          </dl>

          <div className="dcf-panel-heading">
            <h3>How the value changes with two inputs</h3>
            <div className="chart-view-switch" role="group" aria-label="Sensitivity columns">
              {([["terminal", options.terminalMethod === "multiple" ? "Exit multiple" : "Terminal growth"], ["growth", "High growth"]] as const).map(([id, label]) => (
                <button key={id} type="button" className={axis === id ? "chart-view-active" : ""} aria-pressed={axis === id} onClick={() => setAxis(id)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <p className="projection-section-intro">
            The highlighted cell uses your inputs. Green cells are above the current price, red cells below. If small
            changes flip the answer, treat the estimate with extra caution.
          </p>
          <SensitivityTable grid={sensitivity} price={price} currency={currency} />
        </>
      )}

      {fcf.history.length > 0 && (
        <>
          <h3 className="dcf-panel-subheading">Free cash flow so far, per share</h3>
          <div className="table-scroll">
            <table className="financial-table dcf-history">
              <caption className="visually-hidden">Free cash flow per share by fiscal year</caption>
              <thead>
                <tr>
                  <th scope="col">Fiscal year</th>
                  <th scope="col">As reported</th>
                  <th scope="col" className="portfolio-optional">Smoothed</th>
                  <th scope="col" className="portfolio-optional">Stock-based pay</th>
                  <th scope="col">Reported less stock-based pay</th>
                </tr>
              </thead>
              <tbody>
                {fcf.history.map((row) => (
                  <tr key={row.fiscalYear}>
                    <th scope="row">{row.fiscalYear}</th>
                    <td>{formatMoney(row.reported, currency)}</td>
                    <td className="portfolio-optional">{formatMoney(row.smoothed, currency)}</td>
                    <td className="portfolio-optional">{formatMoney(row.stockComp, currency)}</td>
                    <td>{formatMoney(row.reported === null ? null : row.reported - (row.stockComp ?? 0), currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </details>
  );
}
