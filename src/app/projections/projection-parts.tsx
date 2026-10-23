"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ASSUMPTION_SPEC_BY_KEY, type AssumptionSpec } from "@/lib/valuation/assumptions";
import {
  formatMoney,
  formatPercent,
  formatSignedPercent,
  formatStep,
  fromInputValue,
  toInputValue,
} from "@/lib/valuation/format";
import type {
  ModelInfo,
  ModelResult,
  ProjectionRow,
  ScenarioRange,
  SensitivityGrid,
  Verdict,
} from "@/lib/valuation/models";

export type ValueSource = "data" | "ai" | "edited";
export type ModelRole = "primary" | "secondary" | "other";

const UNIT_SUFFIX: Record<AssumptionSpec["unit"], string> = {
  currency: "",
  percent: "%",
  years: "yrs",
  multiple: "×",
};

const SOURCE_LABEL: Record<ValueSource, string> = {
  data: "From filings",
  ai: "AI suggestion",
  edited: "Your value",
};

const ROLE_LABEL: Record<ModelRole, string> = {
  primary: "Recommended",
  secondary: "Cross-check",
  other: "Less suited",
};

export function AssumptionField({
  spec,
  value,
  currency,
  source,
  note,
  onChange,
}: {
  spec: AssumptionSpec;
  value: number | null;
  currency: string;
  source: ValueSource;
  note: string | undefined;
  onChange: (value: number | null) => void;
}) {
  // Remounted (via key) when values change from outside, so the draft can stay local.
  const [draft, setDraft] = useState(() => toInputValue(value, spec.unit));
  const parsed = fromInputValue(draft, spec.unit);
  const outOfRange = parsed !== null && (parsed < spec.min || parsed > spec.max);
  const inputId = `assumption-${spec.key}`;
  const suffix = spec.unit === "currency" ? currency : UNIT_SUFFIX[spec.unit];

  return (
    <div className={`assumption-field assumption-source-${source}`}>
      <div className="assumption-label-row">
        <label htmlFor={inputId}>{spec.label}</label>
        <span className="assumption-source">{SOURCE_LABEL[source]}</span>
      </div>
      <div className="assumption-input-wrap">
        <input
          id={inputId}
          type="text"
          inputMode="decimal"
          value={draft}
          aria-describedby={`${inputId}-short`}
          aria-invalid={outOfRange || undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            const next = fromInputValue(event.target.value, spec.unit);
            onChange(next === null ? null : Math.min(spec.max, Math.max(spec.min, next)));
          }}
        />
        <span className="assumption-suffix" aria-hidden="true">{suffix}</span>
      </div>
      <p className="assumption-short" id={`${inputId}-short`}>{spec.short}</p>
      {outOfRange && (
        <p className="assumption-warning" role="alert">
          Kept between {toInputValue(spec.min, spec.unit)} and {toInputValue(spec.max, spec.unit)}{UNIT_SUFFIX[spec.unit]}.
        </p>
      )}
      <details className="assumption-help">
        <summary>What is this?</summary>
        <p>{spec.help}</p>
        {note && <p className="assumption-note"><strong>{source === "ai" ? "Why AI chose this: " : "Where it comes from: "}</strong>{note}</p>}
      </details>
    </div>
  );
}

export function ModelCard({
  info,
  result,
  range,
  verdict,
  role,
  currency,
}: {
  info: ModelInfo;
  result: ModelResult;
  range: ScenarioRange;
  verdict: Verdict | null;
  role: ModelRole;
  currency: string;
}) {
  return (
    <article className={`model-card model-card-${role}${result.ok ? "" : " model-card-unavailable"}`}>
      <div className="model-card-top">
        <div>
          <span className={`model-role model-role-${role}`}>{ROLE_LABEL[role]}</span>
          <h3>{info.name}</h3>
          <p>{info.bestFor}</p>
        </div>
        <div className="model-card-value">
          {result.ok ? (
            <>
              <strong>{formatMoney(result.value, currency)}</strong>
              {verdict && (
                <small className={verdict.upside >= 0 ? "positive-value" : "negative-value"}>
                  {formatSignedPercent(verdict.upside)} vs price
                </small>
              )}
            </>
          ) : (
            <small>Not available</small>
          )}
        </div>
      </div>

      {result.ok ? (
        <dl className="model-card-stats">
          <div>
            <dt>Bear – bull range</dt>
            <dd>{formatMoney(range.bear, currency)} – {formatMoney(range.bull, currency)}</dd>
          </div>
          {verdict && (
            <div>
              <dt>Buy below</dt>
              <dd>{formatMoney(verdict.buyBelow, currency)}</dd>
            </div>
          )}
        </dl>
      ) : (
        <p className="model-card-reason">{result.reason}</p>
      )}

      <details className="model-explainer">
        <summary>How this model works</summary>
        <p>{info.idea}</p>
        <p className="model-formula"><code>{info.formula}</code></p>
        {result.ok && (
          <table className="model-steps">
            <caption className="visually-hidden">Calculation steps for {info.name}</caption>
            <tbody>
              {result.steps.map((step) => (
                <tr key={step.label}>
                  <th scope="row">{step.label}</th>
                  <td>{formatStep(step.value, step.kind, currency)}</td>
                </tr>
              ))}
              <tr className="model-steps-total">
                <th scope="row">Intrinsic value per share</th>
                <td>{formatMoney(result.value, currency)}</td>
              </tr>
            </tbody>
          </table>
        )}
        <p className="model-inputs">
          Uses: {info.inputs.map((key) => ASSUMPTION_SPEC_BY_KEY[key].label).join(", ")}.
        </p>
        <p className="model-caveat"><strong>Watch out: </strong>{info.caveat}</p>
      </details>
    </article>
  );
}

export type FootballFieldRow = {
  id: string;
  name: string;
  role: ModelRole;
  range: ScenarioRange;
};

export function FootballField({
  rows,
  price,
  currency,
}: {
  rows: FootballFieldRow[];
  price: number | null;
  currency: string;
}) {
  const values = rows.flatMap((row) => [row.range.bear, row.range.base, row.range.bull])
    .filter((value): value is number => value !== null && value > 0);
  if (price !== null && price > 0) values.push(price);
  if (values.length === 0 || rows.length === 0) return null;

  const min = Math.min(...values) * 0.9;
  const max = Math.max(...values) * 1.05;
  const position = (value: number) => `${((value - min) / (max - min)) * 100}%`;

  return (
    <div className="football-field" role="img" aria-label="Range of intrinsic value estimates by model compared with the current price">
      {rows.map((row) => {
        const low = Math.min(row.range.bear ?? row.range.base ?? 0, row.range.base ?? Infinity);
        const high = Math.max(row.range.bull ?? row.range.base ?? 0, row.range.base ?? 0);
        return (
          <div className="football-row" key={row.id}>
            <span className={`football-name football-name-${row.role}`}>{row.name}</span>
            <div className="football-track">
              <span
                className={`football-bar football-bar-${row.role}`}
                style={{ left: position(Math.max(low, min)), width: `calc(${position(high)} - ${position(Math.max(low, min))})` }}
              />
              {row.range.base !== null && (
                <span className="football-base" style={{ left: position(row.range.base) }} />
              )}
              {price !== null && price > 0 && (
                <span className="football-price" style={{ left: position(price) }} />
              )}
            </div>
            <span className="football-value">{formatMoney(row.range.base, currency)}</span>
          </div>
        );
      })}
      <div className="football-legend" aria-hidden="true">
        <span><i className="football-legend-bar" /> Bear to bull range</span>
        <span><i className="football-legend-base" /> Base case</span>
        {price !== null && price > 0 && (
          <span><i className="football-legend-price" /> Current price {formatMoney(price, currency)}</span>
        )}
      </div>
    </div>
  );
}

const projectionSeries = [
  { key: "epsPerShare", label: "EPS", color: "var(--chart-1)" },
  { key: "fcfPerShare", label: "Free cash flow", color: "var(--chart-2)" },
  { key: "dividendPerShare", label: "Dividend", color: "var(--chart-3)" },
] as const;

export function ProjectionChart({ rows, currency }: { rows: ProjectionRow[]; currency: string }) {
  const series = projectionSeries.filter(({ key }) => rows.some((row) => (row[key] ?? 0) > 0));
  if (series.length === 0) return null;
  const data = rows.map((row) => ({ ...row, label: row.year === 0 ? "Today" : `Y${row.year}` }));

  return (
    <div className="projection-chart" role="img" aria-label="Projected per-share earnings, free cash flow and dividends">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickMargin={10} />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={72}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={(value: number) => formatMoney(value, currency, true)}
          />
          <Tooltip
            formatter={(value: unknown) => (typeof value === "number" ? formatMoney(value, currency) : "—")}
            contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6 }}
          />
          <Legend wrapperStyle={{ fontSize: 13 }} />
          {series.map(({ key, label, color }) => (
            <Line key={key} type="monotone" dataKey={key} name={label} stroke={color} strokeWidth={2} dot={{ r: 2 }} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ProjectionTable({ rows, currency }: { rows: ProjectionRow[]; currency: string }) {
  const columns = [
    { key: "revenuePerShare", label: "Revenue / share" },
    { key: "epsPerShare", label: "EPS" },
    { key: "fcfPerShare", label: "FCF / share" },
    { key: "dividendPerShare", label: "Dividend / share" },
  ] as const;

  return (
    <div className="table-scroll">
      <table className="financial-table">
        <thead>
          <tr>
            <th scope="col">Year</th>
            {columns.map((column) => <th scope="col" key={column.key}>{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.year}>
              <th scope="row">{row.year === 0 ? "Today" : `Year ${row.year}`}</th>
              {columns.map((column) => <td key={column.key}>{formatMoney(row[column.key], currency)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SensitivityTable({
  grid,
  price,
  currency,
}: {
  grid: SensitivityGrid;
  price: number | null;
  currency: string;
}) {
  return (
    <div className="table-scroll">
      <table className="financial-table sensitivity-table">
        <caption className="visually-hidden">DCF value per share by discount rate and terminal growth</caption>
        <thead>
          <tr>
            <th scope="col">Discount rate ↓ / Terminal growth →</th>
            {grid.terminalGrowths.map((growth) => <th scope="col" key={growth}>{formatPercent(growth)}</th>)}
          </tr>
        </thead>
        <tbody>
          {grid.discountRates.map((discountRate, rowIndex) => (
            <tr key={discountRate}>
              <th scope="row">{formatPercent(discountRate)}</th>
              {grid.values[rowIndex].map((value, columnIndex) => {
                const isBase = rowIndex === 2 && columnIndex === 2;
                const tone = value === null || price === null ? "" : value >= price ? "positive-value" : "negative-value";
                return (
                  <td key={columnIndex} className={`${tone}${isBase ? " sensitivity-base" : ""}`}>
                    {formatMoney(value, currency)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
