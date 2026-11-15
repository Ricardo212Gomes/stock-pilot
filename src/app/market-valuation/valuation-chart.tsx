"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ValuationPoint } from "@/lib/market-valuation";

export type ChartLine = { key: string; label: string; points: ValuationPoint[] };

export type ChartMetric = {
  id: string;
  label: string;
  // Appended to values: "" for ratios, "%" for yields.
  unit: string;
  digits: number;
  lines: ChartLine[];
  // The first line's average and one standard deviation either side, over its whole history.
  bands?: { average: number; deviation: number; since: string };
  note?: string;
};

type Range = "10Y" | "30Y" | "All";
const RANGES: { id: Range; years: number | null }[] = [
  { id: "10Y", years: 10 },
  { id: "30Y", years: 30 },
  { id: "All", years: null },
];

// Lines in chart order; the first is the metric itself.
const COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-2)"];

type Row = { date: string; provisional?: boolean } & Record<string, number | string | boolean | undefined>;

function formatDate(isoDate: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${isoDate}T12:00:00Z`));
}

function ChartTooltip({ active, payload, metric }: { active?: boolean; payload?: { payload: Row }[]; metric: ChartMetric }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div className="vix-chart-tooltip">
      <span>{formatDate(row.date, { month: "short", year: "numeric" })}</span>
      {metric.lines.map((line) =>
        typeof row[line.key] === "number" ? (
          <span key={line.key}>
            {metric.lines.length > 1 && `${line.label} `}
            <strong>{(row[line.key] as number).toFixed(metric.digits)}{metric.unit}</strong>
          </span>
        ) : null,
      )}
      {row.provisional && <span>Earnings still an estimate</span>}
    </div>
  );
}

export function ValuationChart({ metrics, title }: { metrics: ChartMetric[]; title: string }) {
  const [metricId, setMetricId] = useState(metrics[0]?.id);
  const [range, setRange] = useState<Range>("30Y");
  const metric = metrics.find((item) => item.id === metricId) ?? metrics[0];

  // The lines joined by date; a short history (under ten years) shows whole, without the range switch.
  const { rows, short } = useMemo(() => {
    if (!metric) return { rows: [] as Row[], short: true };
    const byDate = new Map<string, Row>();
    for (const line of metric.lines) {
      for (const point of line.points) {
        const row = byDate.get(point.date) ?? { date: point.date };
        row[line.key] = point.value;
        if (point.provisional && line === metric.lines[0]) row.provisional = true;
        byDate.set(point.date, row);
      }
    }
    const all = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
    const first = metric.lines[0]?.points[0]?.date;
    const last = all.at(-1)?.date;
    const isShort = !first || !last || Number(last.slice(0, 4)) - Number(first.slice(0, 4)) < 10;
    const years = RANGES.find((item) => item.id === range)?.years;
    if (isShort || !years || !last) return { rows: isShort && first ? all.filter((row) => row.date >= first) : all, short: isShort };
    const start = `${Number(last.slice(0, 4)) - years}${last.slice(4)}`;
    return { rows: all.filter((row) => row.date >= start), short: isShort };
  }, [metric, range]);

  if (!metric) return null;
  const spanYears = rows.length ? Number(rows.at(-1)!.date.slice(0, 4)) - Number(rows[0].date.slice(0, 4)) : 0;
  const values = rows.flatMap((row) => metric.lines.map((line) => row[line.key]).filter((value): value is number => typeof value === "number"));
  const bands = metric.bands;
  const lines = bands
    ? [
        { value: bands.average, label: `Average ${bands.average.toFixed(metric.digits)}${metric.unit}` },
        { value: bands.average + bands.deviation, label: "+1 SD" },
        ...(bands.average - bands.deviation > 0 ? [{ value: bands.average - bands.deviation, label: "−1 SD" }] : []),
      ]
    : [];
  const low = Math.min(...values, ...lines.map((line) => line.value));
  const high = Math.max(...values, ...lines.map((line) => line.value));
  // From zero, or below it when a yield goes negative; the top is left to the chart, which rounds it to a tidy tick.
  const domain: [number, "auto"] = [low < 0 ? Math.floor(low) : 0, "auto"];
  const firstRow = rows[0];
  const lastRow = rows.at(-1);

  return (
    <section className="vix-card vix-chart mv-chart" aria-labelledby="mv-chart-heading">
      <div className="vix-chart-heading">
        <h2 id="mv-chart-heading">{title}</h2>
        {!short && (
          <div className="chart-view-switch" role="group" aria-label="Time range">
            {RANGES.map((item) => (
              <button key={item.id} type="button" className={range === item.id ? "chart-view-active" : ""} aria-pressed={range === item.id} onClick={() => setRange(item.id)}>
                {item.id}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="chart-view-switch mv-metric-switch" role="group" aria-label="Measure">
        {metrics.map((item) => (
          <button key={item.id} type="button" className={metric.id === item.id ? "chart-view-active" : ""} aria-pressed={metric.id === item.id} onClick={() => setMetricId(item.id)}>
            {item.label}
          </button>
        ))}
      </div>
      {metric.lines.length > 1 && (
        <ul className="mv-legend">
          {metric.lines.map((line, index) => (
            <li key={line.key}>
              <span className="mv-legend-swatch" style={{ background: COLORS[index] }} aria-hidden="true" />
              {line.label}
            </li>
          ))}
        </ul>
      )}
      <div
        className="vix-chart-plot"
        role="img"
        aria-label={
          firstRow && lastRow
            ? `${metric.label} from ${firstRow.date} to ${lastRow.date}${bands ? `, against its average of ${bands.average.toFixed(metric.digits)}${metric.unit}` : ""}`
            : metric.label
        }
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              minTickGap={48}
              tickMargin={10}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              tickFormatter={(date: string) => formatDate(date, spanYears > 4 ? { year: "numeric" } : { month: "short", year: "2-digit" })}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={48}
              domain={domain}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              allowDecimals={high - low < 6}
              tickFormatter={(value: number) => `${Number(value.toFixed(1))}${metric.unit}`}
            />
            {metric.unit === "%" && low < 0 && <ReferenceLine y={0} stroke="var(--border-strong)" />}
            {lines.map((line) => (
              <ReferenceLine
                key={line.label}
                y={line.value}
                stroke="var(--border-strong)"
                strokeDasharray={line.label.startsWith("Average") ? undefined : "4 4"}
                label={{
                  value: line.label,
                  position: "insideBottomLeft",
                  fill: "var(--muted-foreground)",
                  fontSize: 12,
                  stroke: "var(--card)",
                  strokeWidth: 4,
                  paintOrder: "stroke",
                }}
              />
            ))}
            <Tooltip content={<ChartTooltip metric={metric} />} cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }} />
            {metric.lines.map((line, index) => (
              <Line
                key={line.key}
                type="monotone"
                dataKey={line.key}
                name={line.label}
                stroke={COLORS[index]}
                strokeWidth={2}
                dot={short ? { r: 3, fill: COLORS[index], strokeWidth: 0 } : false}
                activeDot={{ r: 4, fill: COLORS[index], stroke: "var(--card)", strokeWidth: 2 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {metric.note && <p className="mv-chart-note">{metric.note}</p>}
    </section>
  );
}
