"use client";

import {
  CartesianGrid,
  ErrorBar,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CaseField, CaseId, CaseInputs, JeremyYear } from "@/lib/jeremy-projection";
import { CAGR_FROM_INDEX } from "@/lib/jeremy-projection";
import { SheetInput, formatCell, toneOf, type CellFormat, type ScenarioTone } from "./projection-cells";

export type CaseSummary = {
  id: CaseId;
  label: string;
  tone: ScenarioTone;
  years: JeremyYear[] | null;
};

type CaseRow =
  | { kind: "value"; key: string; label: string; format: CellFormat; pick: (year: JeremyYear) => number | null; style?: "sub" | "strong" | "result"; signed?: boolean }
  // Growth rates start in the second year; the first year is the starting point.
  | { kind: "input"; field: CaseField; label: string; unit: "percent" | "multiple"; from: 0 | 1 };

// Jeremy's rows, in his order.
const ROWS: CaseRow[] = [
  { kind: "value", key: "revenue", label: "Revenue", format: "amount", pick: (year) => year.revenue },
  { kind: "input", field: "revenueGrowth", label: "Revenue growth", unit: "percent", from: 1 },
  { kind: "value", key: "netIncome", label: "Net income", format: "amount", pick: (year) => year.netIncome },
  { kind: "input", field: "netIncomeGrowth", label: "Net income growth", unit: "percent", from: 1 },
  { kind: "value", key: "netMargin", label: "Net income margin", format: "wholePercent", pick: (year) => year.netMargin, style: "sub" },
  { kind: "value", key: "eps", label: "EPS", format: "perShare", pick: (year) => year.eps, style: "strong" },
  { kind: "input", field: "peLow", label: "P/E low est.", unit: "multiple", from: 0 },
  { kind: "input", field: "peHigh", label: "P/E high est.", unit: "multiple", from: 0 },
  { kind: "value", key: "priceLow", label: "Share price low", format: "price", pick: (year) => year.priceLow, style: "result" },
  { kind: "value", key: "priceHigh", label: "Share price high", format: "price", pick: (year) => year.priceHigh, style: "result" },
  { kind: "value", key: "cagrLow", label: "CAGR low", format: "signedWholePercent", pick: (year) => year.cagrLow, style: "result", signed: true },
  { kind: "value", key: "cagrHigh", label: "CAGR high", format: "signedWholePercent", pick: (year) => year.cagrHigh, style: "result", signed: true },
];

export function CaseTable({
  caseLabel,
  startLabel,
  years,
  inputs,
  currency,
  onChange,
  onFill,
}: {
  caseLabel: string;
  // "Consensus" or "Reported": where the first column comes from.
  startLabel: string;
  years: JeremyYear[];
  inputs: CaseInputs;
  currency: string;
  onChange: (field: CaseField, index: number, value: number) => void;
  onFill: (field: CaseField) => void;
}) {
  return (
    <div className="table-scroll">
      <table className="financial-table projection-sheet jeremy-sheet">
        <caption className="visually-hidden">{caseLabel}: the starting year, then four projected years with editable inputs</caption>
        <thead>
          <tr className="sheet-groups">
            <td />
            <th scope="col">{startLabel}</th>
            <th scope="colgroup" colSpan={years.length - 1} className="sheet-first-projected">Projected</th>
          </tr>
          <tr>
            <th scope="col">Year</th>
            {years.map((year, index) => (
              <th scope="col" key={year.year} className={index === 1 ? "sheet-first-projected" : undefined}>{year.year}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((row) => {
            if (row.kind === "input") {
              const fillYear = years[row.from]?.year;
              return (
                <tr key={row.field} className="sheet-row-input">
                  <th scope="row">
                    <span className="sheet-label">
                      <span>{row.label}</span>
                      <button
                        type="button"
                        className="sheet-fill"
                        onClick={() => onFill(row.field)}
                        title={`Use ${fillYear}'s value in every year after it`}
                        aria-label={`Use ${fillYear}'s ${row.label.toLowerCase()} in every year after it`}
                      >
                        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 8h8.5M7.5 5l3 3-3 3M13.5 3.5v9" /></svg>
                      </button>
                    </span>
                  </th>
                  {years.map((year, index) => (
                    <td key={year.year} className={index === 1 ? "sheet-first-projected" : undefined}>
                      {index < row.from ? "" : (
                        <SheetInput
                          value={inputs[row.field][index]}
                          unit={row.unit}
                          label={`${row.label}, ${year.year}, ${caseLabel}`}
                          onChange={(next) => onChange(row.field, index, next)}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              );
            }
            return (
              <tr key={row.key} className={row.style ? `sheet-row-${row.style}` : undefined}>
                <th scope="row">{row.label}</th>
                {years.map((year, index) => {
                  const value = row.pick(year);
                  return (
                    <td key={year.year} className={`${index === 1 ? "sheet-first-projected " : ""}${row.signed ? toneOf(value) : ""}`}>
                      {row.signed && index < CAGR_FROM_INDEX ? "" : formatCell(value, row.format, currency)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type Range = { low: number; high: number; cagrLow: number | null; cagrHigh: number | null };
type ChartPoint = { label: string } & Record<string, number | [number, number] | Range | string>;

export function JeremyChart({
  cases,
  from,
  fromLabel,
  currency,
}: {
  cases: CaseSummary[];
  // The price the CAGR runs from: the entry price when set, else today's.
  from: number | null;
  fromLabel: string;
  currency: string;
}) {
  const plotted = cases.filter((item) => item.years?.some((year) => year.priceLow !== null && year.priceHigh !== null));
  if (plotted.length === 0) return null;
  const years = plotted[0].years!;
  // Each case's line runs through the middle of its range; the bars span its low and high targets.
  const data: ChartPoint[] = years.map((year, index) => {
    const point: ChartPoint = { label: String(year.year) };
    for (const { id, years: rows } of plotted) {
      const { priceLow: low, priceHigh: high, cagrLow, cagrHigh } = rows![index];
      if (low === null || high === null) continue;
      const mid = (low + high) / 2;
      point[id] = mid;
      point[`${id}Error`] = [mid - low, high - mid];
      point[`${id}Range`] = { low, high, cagrLow, cagrHigh };
    }
    return point;
  });
  const price = (value: number) => formatCell(value, "price", currency);
  const order: string[] = plotted.map(({ id }) => id);

  return (
    <div className="projection-chart jeremy-chart" role="img" aria-label={`Price range of each case by year, from ${fromLabel.toLowerCase()} price`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickMargin={10} padding={{ left: 24, right: 24 }} />
          <YAxis axisLine={false} tickLine={false} width={64} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickFormatter={price} />
          <Tooltip
            cursor={{ stroke: "var(--border-strong)" }}
            content={({ active, payload, label }) => {
              const point = payload?.[0]?.payload as ChartPoint | undefined;
              if (!active || !point) return null;
              return (
                <div className="jeremy-tooltip">
                  <strong>{label}</strong>
                  {plotted.map(({ id, label: caseLabel, tone }) => {
                    const range = point[`${id}Range`] as Range | undefined;
                    if (!range) return null;
                    return (
                      <span key={id} className={`scenario-tone-${tone}`}>
                        <span className="scenario-dot" aria-hidden="true" />
                        {caseLabel}: {price(range.low)}–{price(range.high)}
                        {range.cagrLow !== null && range.cagrHigh !== null
                          ? ` (${formatCell(range.cagrLow, "signedWholePercent", currency)} to ${formatCell(range.cagrHigh, "signedWholePercent", currency)} CAGR)`
                          : ""}
                      </span>
                    );
                  })}
                </div>
              );
            }}
          />
          <Legend wrapperStyle={{ fontSize: 13 }} itemSorter={(item) => order.indexOf(String(item.dataKey))} />
          {from !== null && from > 0 && (
            <ReferenceLine
              y={from}
              stroke="var(--muted-foreground)"
              strokeDasharray="6 4"
              label={{ value: `${fromLabel} ${price(from)}`, position: "insideBottomLeft", fill: "var(--muted-foreground)", fontSize: 12 }}
            />
          )}
          {plotted.map(({ id, label, tone }) => (
            <Line key={id} type="monotone" dataKey={id} name={label} stroke={`var(--${tone})`} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false}>
              <ErrorBar dataKey={`${id}Error`} width={6} strokeWidth={1.5} stroke={`var(--${tone})`} direction="y" />
            </Line>
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
