"use client";

import { useEffect, useRef, type ReactNode } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Area,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatSignedPercent } from "@/lib/valuation/format";
import type {
  HistoryYear,
  InputField,
  ProjectedYear,
  ProjectionMode,
  ScenarioId,
  ScenarioInputs,
} from "@/lib/plumas-projection";
import type { AnalystEstimate, EstimateRange } from "@/lib/stock-overview";
import { SheetInput, formatCell, toneOf, type CellFormat, type CellUnit, type ScenarioTone } from "./projection-cells";

export type ScenarioSummary = {
  id: ScenarioId;
  label: string;
  tone: ScenarioTone;
  years: ProjectedYear[] | null;
};

type SheetRow =
  | {
    kind: "value";
    key: string;
    label: string;
    format: CellFormat;
    reported: (year: HistoryYear) => number | null;
    projected: (year: ProjectedYear) => number | null;
    style?: "sub" | "strong" | "result";
    signed?: boolean;
    // Analysts' rows: the range and the number of analysts behind each average.
    spread?: (year: ProjectedYear) => { range: EstimateRange; analysts: number | null } | null;
  }
  | {
    kind: "input";
    field: InputField;
    label: string;
    hint?: string;
    unit: CellUnit;
    reported: (year: HistoryYear) => number | null;
  };

const none = () => null;

function value(key: string, label: string, format: CellFormat, reported: (year: HistoryYear) => number | null, projected: (year: ProjectedYear) => number | null, style?: "sub" | "strong" | "result"): SheetRow {
  return { kind: "value", key, label, format, reported, projected, style };
}

function input(field: InputField, label: string, unit: CellUnit, reported: (year: HistoryYear) => number | null = none, hint?: string): SheetRow {
  return { kind: "input", field, label, unit, reported, hint };
}

function cagr(key: "cagrLow" | "cagrMid" | "cagrHigh", label: string): SheetRow {
  return { kind: "value", key, label, format: "percent", reported: none, projected: (year) => year[key], style: "result", signed: true };
}

function consensus(key: string, label: string, format: CellFormat, pick: (estimate: AnalystEstimate) => EstimateRange, estimateFor: (year: number) => AnalystEstimate | null): SheetRow {
  const found = (year: ProjectedYear) => {
    const estimate = estimateFor(year.year);
    return estimate ? { range: pick(estimate), analysts: estimate.analysts } : null;
  };
  return { kind: "value", key, label, format, reported: none, projected: (year) => found(year)?.range.avg ?? null, style: "sub", spread: found };
}

function sheetRows(mode: ProjectionMode, withCost: boolean, withPe: boolean, estimates: Map<number, AnalystEstimate>): SheetRow[] {
  const reportedPe = withPe ? [value("pe", "P/E (reported)", "multiple", (year) => year.pe, none, "sub")] : [];
  const estimateFor = (year: number) => estimates.get(year) ?? null;
  const covered = (pick: (estimate: AnalystEstimate) => EstimateRange) => [...estimates.values()].some((estimate) => pick(estimate).avg !== null);
  const revenueConsensus = covered((estimate) => estimate.revenue)
    ? [consensus("revenueEstimate", "Analysts' revenue", "money", (estimate) => estimate.revenue, estimateFor)]
    : [];
  const epsConsensus = covered((estimate) => estimate.eps)
    ? [consensus("epsEstimate", "Analysts' EPS", "perShare", (estimate) => estimate.eps, estimateFor)]
    : [];
  if (mode === "simple") {
    return [
      value("revenue", "Revenue", "money", (year) => year.revenue, (year) => year.revenue),
      ...revenueConsensus,
      input("revenueGrowth", "Revenue growth", "percent", (year) => year.revenueGrowth),
      value("netIncome", "Net income", "money", (year) => year.netIncome, (year) => year.netIncome),
      input("netIncomeGrowth", "Net income growth", "percent", (year) => year.netIncomeGrowth),
      value("netMargin", "Net margin", "percent", (year) => year.netMargin, (year) => year.netMargin, "sub"),
      value("eps", "EPS", "perShare", (year) => year.eps, (year) => year.eps, "strong"),
      ...epsConsensus,
      ...reportedPe,
      input("peLow", "P/E low", "multiple"),
      input("peHigh", "P/E high", "multiple"),
      value("priceLow", "Price (P/E low)", "price", none, (year) => year.priceLow, "result"),
      value("priceHigh", "Price (P/E high)", "price", none, (year) => year.priceHigh, "result"),
      cagr("cagrLow", "CAGR low"),
      cagr("cagrHigh", "CAGR high"),
    ];
  }
  return [
    value("revenue", "Revenue", "money", (year) => year.revenue, (year) => year.revenue),
    ...revenueConsensus,
    input("revenueGrowth", "Revenue growth", "percent", (year) => year.revenueGrowth),
    ...(withCost ? [
      value("costOfRevenue", "Cost of revenue", "money", (year) => year.costOfRevenue, (year) => year.costOfRevenue),
      input("costGrowth", "Cost of revenue growth", "percent", (year) => year.costGrowth),
      value("grossProfit", "Gross profit", "money", (year) => year.grossProfit, (year) => year.grossProfit),
      value("grossMargin", "Gross margin", "percent", (year) => year.grossMargin, (year) => year.grossMargin, "sub"),
    ] : []),
    value("operatingExpenses", "Operating expenses", "money", (year) => year.operatingExpenses, (year) => year.operatingExpenses),
    input("opexGrowth", "Operating expenses growth", "percent", (year) => year.opexGrowth),
    value("operatingIncome", "Operating income", "money", (year) => year.operatingIncome, (year) => year.operatingIncome),
    value("operatingMargin", "Operating margin", "percent", (year) => year.operatingMargin, (year) => year.operatingMargin, "sub"),
    value("other", "Interest & other", "money", (year) => year.other, (year) => year.other),
    input("otherGrowth", "Interest & other growth", "percent", (year) => year.otherGrowth),
    value("netIncome", "Net income", "money", (year) => year.netIncome, (year) => year.netIncome),
    value("netMargin", "Net margin", "percent", (year) => year.netMargin, (year) => year.netMargin, "sub"),
    value("shares", "Shares", "shares", (year) => year.shares, (year) => year.shares),
    input("buybackYield", "Buyback yield", "percent", (year) => year.buybackYield, "Buybacks positive, dilution negative"),
    value("eps", "EPS", "perShare", (year) => year.eps, (year) => year.eps, "strong"),
    ...epsConsensus,
    ...reportedPe,
    input("peLow", "P/E low", "multiple"),
    input("peMid", "P/E mid", "multiple"),
    input("peHigh", "P/E high", "multiple"),
    value("priceLow", "Price (low)", "price", none, (year) => year.priceLow, "result"),
    value("priceMid", "Price (mid)", "price", none, (year) => year.priceMid, "result"),
    value("priceHigh", "Price (high)", "price", none, (year) => year.priceHigh, "result"),
    value("marketCapMid", "Market cap (mid)", "money", none, (year) => year.marketCapMid),
    cagr("cagrLow", "CAGR low"),
    cagr("cagrMid", "CAGR mid"),
    cagr("cagrHigh", "CAGR high"),
  ];
}

export function ProjectionSheet({
  mode,
  scenarioLabel,
  history,
  years,
  inputs,
  estimates,
  currency,
  withCost,
  onChange,
  onFill,
}: {
  mode: ProjectionMode;
  scenarioLabel: string;
  history: HistoryYear[];
  years: ProjectedYear[];
  inputs: ScenarioInputs;
  // Analysts' consensus for each projected year, in the same order.
  estimates: (AnalystEstimate | null)[];
  currency: string;
  withCost: boolean;
  onChange: (field: InputField, index: number, value: number) => void;
  onFill: (field: InputField) => void;
}) {
  const byYear = new Map(years.flatMap((year, index) => (estimates[index] ? [[year.year, estimates[index]!] as const] : [])));
  const rows = sheetRows(mode, withCost, history.some((year) => year.pe !== null), byYear);
  const firstYear = years[0]?.year;
  const scroller = useRef<HTMLDivElement>(null);

  // On a narrow screen, start at the last reported year so the projected boxes are in view.
  useEffect(() => {
    const element = scroller.current;
    const lastReported = element?.querySelectorAll<HTMLElement>("thead th.sheet-reported");
    const label = element?.querySelector<HTMLElement>("thead tr:last-child th");
    if (!element || !lastReported?.length || !label || element.scrollWidth <= element.clientWidth) return;
    element.scrollLeft = lastReported[lastReported.length - 1].offsetLeft - label.offsetWidth;
  }, []);

  return (
    <div className="table-scroll projection-sheet-scroll" ref={scroller}>
      <table className="financial-table projection-sheet">
        <caption className="visually-hidden">
          {scenarioLabel} scenario: reported fiscal years, then projected years with editable inputs
        </caption>
        <thead>
          <tr className="sheet-groups">
            <td />
            {history.length > 0 && <th scope="colgroup" colSpan={history.length}>Reported</th>}
            <th scope="colgroup" colSpan={years.length} className="sheet-first-projected">Projected</th>
          </tr>
          <tr>
            <th scope="col">Fiscal year</th>
            {history.map((year) => <th scope="col" key={year.year} className="sheet-reported">{year.year}</th>)}
            {years.map((year, index) => (
              <th scope="col" key={year.year} className={index === 0 ? "sheet-first-projected" : undefined}>{year.year}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            if (row.kind === "input") {
              const values = inputs[row.field];
              return (
                <tr key={row.field} className="sheet-row-input">
                  <th scope="row">
                    <span className="sheet-label">
                      <span>
                        {row.label}
                        {row.hint && <small>{row.hint}</small>}
                      </span>
                      <button
                        type="button"
                        className="sheet-fill"
                        onClick={() => onFill(row.field)}
                        title={`Use ${firstYear}'s value in every year`}
                        aria-label={`Use ${firstYear}'s ${row.label.toLowerCase()} in every year`}
                      >
                        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 8h8.5M7.5 5l3 3-3 3M13.5 3.5v9" /></svg>
                      </button>
                    </span>
                  </th>
                  {history.map((year) => (
                    <td key={year.year} className="sheet-reported">{row.reported === none ? "" : formatCell(row.reported(year), row.unit, currency)}</td>
                  ))}
                  {years.map((year, index) => (
                    <td key={year.year} className={index === 0 ? "sheet-first-projected" : undefined}>
                      <SheetInput
                        value={values[index]}
                        unit={row.unit}
                        label={`${row.label}, ${year.year}, ${scenarioLabel} scenario`}
                        onChange={(next) => onChange(row.field, index, next)}
                      />
                    </td>
                  ))}
                </tr>
              );
            }
            return (
              <tr key={row.key} className={row.style ? `sheet-row-${row.style}` : undefined}>
                <th scope="row">{row.label}</th>
                {history.map((year) => (
                  <td key={year.year} className="sheet-reported">{row.reported === none ? "" : formatCell(row.reported(year), row.format, currency)}</td>
                ))}
                {years.map((year, index) => {
                  const projected = row.projected(year);
                  const spread = row.spread?.(year);
                  return (
                    <td
                      key={year.year}
                      className={`${index === 0 ? "sheet-first-projected " : ""}${row.signed ? toneOf(projected) : ""}`}
                      title={spread ? `Low ${formatCell(spread.range.low, row.format, currency)}, high ${formatCell(spread.range.high, row.format, currency)}${spread.analysts ? `, ${spread.analysts} analysts` : ""}` : undefined}
                    >
                      {row.projected === none ? "" : row.signed ? formatSignedPercent(projected) : formatCell(projected, row.format, currency)}
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

function range(low: number | null, high: number | null, currency: string): string {
  return low === null || high === null ? "—" : `${formatCell(low, "price", currency)}–${formatCell(high, "price", currency)}`;
}

export function ScenarioCards({
  scenarios,
  selected,
  lastYear,
  currency,
  onSelect,
}: {
  scenarios: ScenarioSummary[];
  selected: ScenarioId;
  lastYear: number;
  currency: string;
  onSelect: (id: ScenarioId) => void;
}) {
  return (
    <div className="scenario-cards" role="group" aria-label="Scenarios: pick one to edit">
      {scenarios.map(({ id, label, tone, years }) => {
        const last = years?.[years.length - 1] ?? null;
        return (
          <button
            key={id}
            type="button"
            className={`scenario-card scenario-tone-${tone}`}
            aria-pressed={id === selected}
            onClick={() => onSelect(id)}
          >
            <span className="scenario-card-name"><span className="scenario-dot" aria-hidden="true" />{label}</span>
            <span className="scenario-card-label">Price target {lastYear}</span>
            <strong className="scenario-card-price">{range(last?.priceLow ?? null, last?.priceHigh ?? null, currency)}</strong>
            <span className="scenario-card-cagr">
              {last && last.cagrLow !== null && last.cagrHigh !== null ? (
                <>
                  CAGR <span className={toneOf(last.cagrLow)}>{formatSignedPercent(last.cagrLow)}</span> to{" "}
                  <span className={toneOf(last.cagrHigh)}>{formatSignedPercent(last.cagrHigh)}</span>
                </>
              ) : "CAGR —"}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// The middle of each year's price range: the mid P/E in Advanced mode, halfway between low and high in Simple.
export function midPrice(year: ProjectedYear): number | null {
  if (year.priceMid !== null) return year.priceMid;
  return year.priceLow !== null && year.priceHigh !== null ? (year.priceLow + year.priceHigh) / 2 : null;
}

type ChartPoint = Record<string, number | string | [number, number] | null>;

export function ScenarioChart({
  scenarios,
  selected,
  price,
  currency,
}: {
  scenarios: ScenarioSummary[];
  selected: ScenarioId;
  price: number | null;
  currency: string;
}) {
  const plotted = scenarios.filter((scenario) => scenario.years?.some((year) => midPrice(year) !== null));
  const chosen = plotted.find(({ id }) => id === selected);
  if (plotted.length === 0) return null;
  const startPrice = price !== null && price > 0 ? price : null;
  const years = plotted[0].years!;
  const data: ChartPoint[] = [
    ...(startPrice === null ? [] : [{
      label: "Today",
      ...Object.fromEntries(plotted.map(({ id }) => [id, startPrice])),
      band: [startPrice, startPrice] as [number, number],
    }]),
    ...years.map((year, index) => {
      const selectedYear = chosen?.years?.[index];
      return {
        label: String(year.year),
        ...Object.fromEntries(plotted.map(({ id, years: rows }) => [id, rows ? midPrice(rows[index]) : null])),
        band: selectedYear && selectedYear.priceLow !== null && selectedYear.priceHigh !== null
          ? [selectedYear.priceLow, selectedYear.priceHigh] as [number, number]
          : null,
      };
    }),
  ];
  const format = (value: number) => formatCell(value, "price", currency);

  return (
    <div className="projection-chart scenario-chart" role="img" aria-label={`Mid price path of each scenario from today's price, with the ${chosen?.label ?? "selected"} scenario's low to high range shaded`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickMargin={10} />
          <YAxis axisLine={false} tickLine={false} width={64} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickFormatter={format} />
          <Tooltip
            formatter={(value: unknown) => (Array.isArray(value) ? `${format(value[0])} – ${format(value[1])}` : typeof value === "number" ? format(value) : "—")}
            contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 13 }}
            labelStyle={{ color: "var(--foreground)", fontWeight: 600 }}
          />
          {/* From the worst case to the best, like the cards, rather than alphabetically. */}
          <Legend wrapperStyle={{ fontSize: 13 }} itemSorter={(item) => plotted.findIndex(({ id }) => id === item.dataKey)} />
          {chosen && (
            <Area
              type="linear"
              dataKey="band"
              name={`${chosen.label} range`}
              stroke="none"
              fill={`var(--${chosen.tone})`}
              fillOpacity={0.14}
              isAnimationActive={false}
              legendType="none"
            />
          )}
          {startPrice !== null && <ReferenceLine y={startPrice} stroke="var(--muted-foreground)" strokeDasharray="4 4" />}
          {plotted.map(({ id, label, tone }) => (
            <Line
              key={id}
              type="linear"
              dataKey={id}
              name={label}
              stroke={`var(--${tone})`}
              strokeWidth={id === selected ? 3 : 1.5}
              dot={{ r: id === selected ? 3 : 2 }}
              isAnimationActive={false}
            />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ScenarioComparison({
  scenarios,
  selected,
  mode,
  base,
  currency,
  onSelect,
}: {
  scenarios: ScenarioSummary[];
  selected: ScenarioId;
  mode: ProjectionMode;
  // The last reported year, which revenue growth is measured from.
  base: { year: number; revenue: number | null };
  currency: string;
  onSelect: (id: ScenarioId) => void;
}) {
  const last = (summary: ScenarioSummary) => summary.years?.[summary.years.length - 1] ?? null;
  const lastYear = scenarios.find((summary) => summary.years)?.years?.at(-1)?.year;
  const rows: { label: string; cell: (year: ProjectedYear) => ReactNode }[] = [
    { label: `Revenue ${lastYear ?? ""}`, cell: (year) => formatCell(year.revenue, "money", currency) },
    {
      label: "Revenue growth / yr",
      cell: (year) => (base.revenue !== null && base.revenue > 0 ? formatSignedPercent((year.revenue / base.revenue) ** (1 / (year.year - base.year)) - 1) : "—"),
    },
    { label: "Net margin", cell: (year) => formatCell(year.netMargin, "percent", currency) },
    { label: "EPS", cell: (year) => formatCell(year.eps, "perShare", currency) },
    ...(mode === "advanced" ? [{ label: "Mid price", cell: (year: ProjectedYear) => formatCell(year.priceMid, "price", currency) }] : []),
    { label: "Price range", cell: (year) => range(year.priceLow, year.priceHigh, currency) },
    {
      label: "CAGR range",
      cell: (year) => (year.cagrLow === null || year.cagrHigh === null ? "—" : (
        <span className="projection-range">
          <span className={toneOf(year.cagrLow)}>{formatSignedPercent(year.cagrLow)}</span>
          <span aria-hidden="true">to</span>
          <span className={toneOf(year.cagrHigh)}>{formatSignedPercent(year.cagrHigh)}</span>
        </span>
      )),
    },
  ];

  return (
    <div className="table-scroll">
      <table className="financial-table scenario-comparison">
        <caption className="visually-hidden">Every scenario in fiscal {lastYear}</caption>
        <thead>
          <tr>
            <th scope="col">In {lastYear}</th>
            {scenarios.map(({ id, label, tone }) => (
              <th scope="col" key={id} className={`scenario-tone-${tone}${id === selected ? " scenario-column-selected" : ""}`}>
                <button type="button" className="scenario-row-button" aria-pressed={id === selected} onClick={() => onSelect(id)}>
                  <span className="scenario-dot" aria-hidden="true" />{label}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row">{row.label}</th>
              {scenarios.map((summary) => {
                const year = last(summary);
                return <td key={summary.id} className={summary.id === selected ? "scenario-column-selected" : undefined}>{year ? row.cell(year) : "—"}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
