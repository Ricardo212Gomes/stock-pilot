"use client";

import { useSyncExternalStore } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PriceTargets } from "@/lib/analyst-forecast";
import type { PricePoint } from "@/lib/technicals";

const DAY_MS = 86_400_000;
// Analysts' targets are for twelve months out.
const TARGET_DAYS = 365;

type ChartRow = { t: number; price?: number; high?: number; average?: number; low?: number };

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function dateLabel(t: number, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(t));
}

const TARGET_LINES = [
  { key: "high", label: "High" },
  { key: "average", label: "Average" },
  { key: "low", label: "Low" },
] as const;

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div className="forecast-chart-tooltip">
      <strong>{dateLabel(row.t, { month: "short", day: "numeric", year: "numeric" })}</strong>
      {row.price !== undefined ? (
        <span>Close {money(row.price)}</span>
      ) : (
        TARGET_LINES.map((line) => row[line.key] !== undefined && <span key={line.key}>{line.label} target {money(row[line.key]!)}</span>)
      )}
    </div>
  );
}

const NARROW = "(max-width: 640px)";

// Phones get short labels and a narrow margin, so the price keeps most of the width. The server renders the
// wide layout, and the chart switches after hydration.
function useNarrow(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(NARROW);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(NARROW).matches,
    () => false,
  );
}

// A label at the far end of each target line, naming it beside its value (the value alone on phones).
function EndLabel({ x, y, index, value, name, count, short }: { x?: number; y?: number; index?: number; value?: number; name: string; count: number; short: boolean }) {
  if (index !== count - 1 || x === undefined || y === undefined || value === undefined) return null;
  return (
    <text x={x + 6} y={y} dy={4} className="forecast-chart-label">
      {short ? `$${Math.round(value)}` : `${name} ${money(value)}`}
    </text>
  );
}

// The last year of closes, then a dashed line from the latest close to each of the analysts' high, average and
// low targets a year ahead.
export function PriceTargetChart({ closes, targets }: { closes: PricePoint[]; targets: PriceTargets }) {
  const narrow = useNarrow();
  const last = closes.at(-1)!;
  const start = Date.parse(`${last.date}T12:00:00Z`);
  const end = start + TARGET_DAYS * DAY_MS;
  const values = { high: targets.high ?? undefined, average: targets.consensus, low: targets.low ?? undefined };
  const data: ChartRow[] = [
    ...closes.slice(0, -1).map((point) => ({ t: Date.parse(`${point.date}T12:00:00Z`), price: point.close })),
    // The latest close starts every target line.
    { t: start, price: last.close, high: values.high && last.close, average: last.close, low: values.low && last.close },
    { t: end, ...values },
  ];
  const first = data[0].t;
  // A tick at the start of every third month across the chart.
  const ticks: number[] = [];
  for (const date = new Date(first); date.getTime() <= end; date.setUTCMonth(date.getUTCMonth() + 3)) {
    ticks.push(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }

  return (
    <div
      className="forecast-chart-plot"
      role="img"
      aria-label={`Price over the last year, ending at ${money(last.close)}, and analysts' targets a year out: ${TARGET_LINES.filter((line) => values[line.key] !== undefined).map((line) => `${line.label.toLowerCase()} ${money(values[line.key]!)}`).join(", ")}.`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: narrow ? 44 : 128, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            scale="time"
            domain={[first, end]}
            ticks={ticks.filter((tick) => tick >= first)}
            axisLine={false}
            tickLine={false}
            tickMargin={8}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={(t: number) => dateLabel(t, { month: "short", year: "2-digit" })}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={narrow ? 44 : 56}
            domain={["auto", "auto"]}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={(value: number) => `$${Math.round(value)}`}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }} />
          <Line dataKey="price" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "var(--chart-1)", stroke: "var(--card)", strokeWidth: 2 }} isAnimationActive={false} />
          {TARGET_LINES.filter((line) => values[line.key] !== undefined).map((line) => (
            <Line
              key={line.key}
              dataKey={line.key}
              stroke={line.key === "average" ? "var(--chart-1)" : "var(--muted-foreground)"}
              strokeWidth={line.key === "average" ? 2 : 1.5}
              strokeDasharray="5 4"
              connectNulls
              dot={false}
              activeDot={{ r: 4, fill: line.key === "average" ? "var(--chart-1)" : "var(--muted-foreground)", stroke: "var(--card)", strokeWidth: 2 }}
              label={<EndLabel name={line.label} count={data.length} short={narrow} />}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
