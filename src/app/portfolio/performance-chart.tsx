"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Currency } from "@/lib/fx";
import type { HistoryPoint } from "@/lib/portfolio";
import { useNarrow } from "../components/use-narrow";

type View = "return" | "value";
type RangeId = "1M" | "6M" | "YTD" | "1Y" | "ALL";

const VIEWS: { id: View; label: string }[] = [
  { id: "return", label: "Return" },
  { id: "value", label: "Value" },
];

const RANGES: { id: RangeId; label: string; days: number | null }[] = [
  { id: "1M", label: "1M", days: 30 },
  { id: "6M", label: "6M", days: 182 },
  { id: "YTD", label: "YTD", days: null },
  { id: "1Y", label: "1Y", days: 365 },
  { id: "ALL", label: "All", days: null },
];

// The plot's box is 300px with the x-axis band inside it; the end labels are spaced within what's left.
const HEIGHT = 300;
const TOP_MARGIN = 12;
const AXIS_HEIGHT = 30;
const PLOT_HEIGHT = HEIGHT - TOP_MARGIN - AXIS_HEIGHT;
const LABEL_SPACING = 16;
const DAY_MS = 86_400_000;

// The portfolio in the brand blue and what it's measured against in amber: chart-3, since chart-2 is the green
// this page uses for gains. The pair passes the palette checks for colour blindness in both themes.
const SERIES = {
  return: [
    { key: "you", label: "Your portfolio", short: "You", color: "var(--chart-1)" },
    { key: "benchmark", label: "S&P 500", short: "S&P 500", color: "var(--chart-3)" },
  ],
  value: [
    { key: "value", label: "Value", short: "Value", color: "var(--chart-1)" },
    { key: "cost", label: "Cost", short: "Cost", color: "var(--chart-3)" },
  ],
} as const;

type SeriesKey = (typeof SERIES)[View][number]["key"];
type Row = { t: number; date: string; you: number; benchmark?: number; value: number; cost: number };

function utc(date: string): number {
  return Date.parse(`${date}T12:00:00Z`);
}

function formatDate(t: number, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(t));
}

function signedPercent(value: number, digits = 1): string {
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

// Compact amounts use the same options as the server's, so "$20K" renders the same in both.
function money(value: number, currency: Currency, compact = false): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: compact ? "compact" : "standard",
    minimumFractionDigits: compact ? 0 : 2,
    maximumFractionDigits: compact ? 1 : 2,
  }).format(value);
}

function signedMoney(value: number, currency: Currency): string {
  return `${value > 0 ? "+" : ""}${money(value, currency)}`;
}

function tone(value: number | undefined): string {
  return value === undefined || Math.abs(value) < 1e-12 ? "" : value > 0 ? "positive-value" : "negative-value";
}

function rangeStart(range: RangeId, latest: string): string | null {
  if (range === "YTD") return `${latest.slice(0, 4)}-01-01`;
  const days = RANGES.find((option) => option.id === range)!.days;
  return days === null ? null : new Date(utc(latest) - days * DAY_MS).toISOString().slice(0, 10);
}

// The range's points, from the last close before it starts: the first point is the base its return is
// measured from.
function inRange(history: HistoryPoint[], start: string | null): HistoryPoint[] {
  if (!start) return history;
  const first = history.findIndex((point) => point.date >= start);
  return first === -1 ? history.slice(-2) : history.slice(Math.max(0, first - 1));
}

function niceStep(raw: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const residual = raw / magnitude;
  return (residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10) * magnitude;
}

// The data's range with a little room above and below, and round ticks inside it, so the lines fill the plot.
// The domain is set here, not by the chart, so the end labels can be spaced in pixels.
function valueScale(values: number[]): { domain: [number, number]; ticks: number[]; step: number } {
  let low = Math.min(...values);
  let high = Math.max(...values);
  if (high - low < 1e-9) {
    const pad = Math.abs(high) * 0.05 || 0.01;
    low -= pad;
    high += pad;
  }
  const room = (high - low) * 0.06;
  const domain: [number, number] = [low - room, high + room];
  const step = niceStep((domain[1] - domain[0]) / 4);
  const ticks: number[] = [];
  for (let tick = Math.ceil(domain[0] / step) * step; tick <= domain[1]; tick += step) ticks.push(Number(tick.toPrecision(12)));
  return { domain, ticks, step };
}

// Weekly ticks over two months or less; otherwise month starts, every 1, 2, 3, 6 or 12 months.
function timeTicks(first: number, last: number): { ticks: number[]; options: Intl.DateTimeFormatOptions } {
  if (last - first <= 62 * DAY_MS) {
    const ticks: number[] = [];
    for (let t = first; t <= last; t += 7 * DAY_MS) ticks.push(t);
    return { ticks, options: { month: "short", day: "numeric" } };
  }
  const months = (last - first) / (30.44 * DAY_MS);
  const every = [1, 2, 3, 6, 12].find((step) => months / step <= 6) ?? 12;
  const start = new Date(first);
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  while (every >= 3 && cursor.getUTCMonth() % every !== 0) cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  const ticks: number[] = [];
  for (; cursor.getTime() <= last; cursor.setUTCMonth(cursor.getUTCMonth() + every)) ticks.push(cursor.getTime());
  return { ticks, options: { month: "short", year: "2-digit" } };
}

// Moves two end labels apart when their lines end too close together, the higher one up.
function labelShifts(values: number[], domain: [number, number]): number[] {
  if (values.length < 2) return values.map(() => 0);
  const gap = (Math.abs(values[0] - values[1]) * PLOT_HEIGHT) / (domain[1] - domain[0]);
  if (gap >= LABEL_SPACING) return [0, 0];
  const push = (LABEL_SPACING - gap) / 2;
  return values[0] >= values[1] ? [-push, push] : [push, -push];
}

function EndLabel({ x, y, index, value, count, shift, text }: { x?: number; y?: number; index?: number; value?: number; count: number; shift: number; text: (value: number) => string }) {
  if (index !== count - 1 || x === undefined || y === undefined || value === undefined) return null;
  return (
    <text x={x + 6} y={y + shift} dy={4} className="portfolio-chart-label">
      {text(value)}
    </text>
  );
}

function Swatch({ color }: { color: string }) {
  return <i className="portfolio-swatch" style={{ background: color }} aria-hidden="true" />;
}

function ChartTooltip({ active, payload, view, currency }: { active?: boolean; payload?: { payload: Row }[]; view: View; currency: Currency }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div className="portfolio-chart-tooltip">
      <strong>{formatDate(row.t, { month: "short", day: "numeric", year: "numeric" })}</strong>
      {view === "return" ? (
        <>
          <span><Swatch color={SERIES.return[0].color} />You {signedPercent(row.you)}</span>
          {row.benchmark !== undefined && <span><Swatch color={SERIES.return[1].color} />S&amp;P 500 {signedPercent(row.benchmark)}</span>}
        </>
      ) : (
        <>
          <span><Swatch color={SERIES.value[0].color} />Value {money(row.value, currency)}</span>
          <span><Swatch color={SERIES.value[1].color} />Cost {money(row.cost, currency)}</span>
          <span>Gain {signedMoney(row.value - row.cost, currency)}</span>
        </>
      )}
    </div>
  );
}

// The portfolio's return against the S&P 500 (both with dividends, and not counting money put in or taken out
// as gains), or its value against what it cost, over a chosen period, with a month-by-month table under it.
export function PerformanceChart({ history, currency = "USD" }: { history: HistoryPoint[]; currency?: Currency }) {
  const narrow = useNarrow();
  const [view, setView] = useState<View>("return");
  const [range, setRange] = useState<RangeId>("ALL");
  const latest = history[history.length - 1].date;
  // Only periods shorter than the history.
  const ranges = RANGES.filter((option) => {
    const start = rangeStart(option.id, latest);
    return start === null || history[0].date < start;
  });
  const active = ranges.some((option) => option.id === range) ? range : "ALL";

  const rows = useMemo((): Row[] => {
    const points = inRange(history, rangeStart(active, latest));
    const base = points[0];
    return points.map((point) => ({
      t: utc(point.date),
      date: point.date,
      you: point.growth / base.growth - 1,
      benchmark: base.benchmark !== null && point.benchmark !== null ? point.benchmark / base.benchmark - 1 : undefined,
      value: point.value,
      cost: point.cost,
    }));
  }, [history, active, latest]);
  const months = useMemo(() => {
    const byMonth = new Map<string, Row>();
    for (const row of rows) byMonth.set(row.date.slice(0, 7), row);
    return [...byMonth.values()].reverse();
  }, [rows]);

  const first = rows[0];
  const end = rows[rows.length - 1];
  const series = SERIES[view].filter((item) => item.key !== "benchmark" || end.benchmark !== undefined);
  const values = view === "return"
    ? [0, ...rows.flatMap((row) => (row.benchmark === undefined ? [row.you] : [row.you, row.benchmark]))]
    : rows.flatMap((row) => [row.value, row.cost]);
  const { domain, ticks, step } = valueScale(values);
  const valueAt = (row: Row, key: SeriesKey) => row[key] as number;
  const shifts = labelShifts(series.map((item) => valueAt(end, item.key)), domain);
  const time = timeTicks(first.t, end.t);
  const format = (value: number) => (view === "return" ? signedPercent(value) : money(value, currency, true));
  const since = formatDate(first.t, { month: "short", day: "numeric", year: "numeric" });
  const description = view === "return"
    ? `Your portfolio's return since ${since}: ${signedPercent(end.you)}${end.benchmark !== undefined ? `, against ${signedPercent(end.benchmark)} for the S&P 500` : ""}.`
    : `Your portfolio's value since ${since}, from ${money(first.value, currency)} to ${money(end.value, currency)}, against a cost of ${money(end.cost, currency)}.`;

  return (
    <div className="portfolio-chart">
      <div className="portfolio-chart-toolbar">
        <p className="portfolio-chart-summary">
          {view === "return" ? (
            <>
              Since {since}: your portfolio <strong className={tone(end.you)}>{signedPercent(end.you)}</strong>
              {end.benchmark !== undefined && <>, the S&amp;P 500 <strong className={tone(end.benchmark)}>{signedPercent(end.benchmark)}</strong></>}, dividends included.
            </>
          ) : (
            <>
              Worth <strong>{money(end.value, currency)}</strong>, against <strong>{money(end.cost, currency)}</strong> paid for what you hold.
            </>
          )}
        </p>
        <div className="portfolio-chart-switches">
          <div className="chart-view-switch" role="group" aria-label="Chart">
            {VIEWS.map((option) => (
              <button key={option.id} type="button" className={view === option.id ? "chart-view-active" : ""} aria-pressed={view === option.id} onClick={() => setView(option.id)}>
                {option.label}
              </button>
            ))}
          </div>
          {ranges.length > 1 && (
            <div className="chart-view-switch" role="group" aria-label="Period">
              {ranges.map((option) => (
                <button key={option.id} type="button" className={active === option.id ? "chart-view-active" : ""} aria-pressed={active === option.id} onClick={() => setRange(option.id)}>
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="portfolio-legend" aria-hidden="true">
        {series.map((item) => (
          <span key={item.key}><Swatch color={item.color} />{item.label}</span>
        ))}
      </div>
      <div className="portfolio-chart-plot" role="img" aria-label={description}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: TOP_MARGIN, right: narrow ? 56 : 124, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={[first.t, end.t]}
              ticks={time.ticks}
              height={AXIS_HEIGHT}
              axisLine={false}
              tickLine={false}
              tickMargin={8}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              tickFormatter={(t: number) => formatDate(t, time.options)}
            />
            <YAxis
              domain={domain}
              ticks={ticks}
              axisLine={false}
              tickLine={false}
              width={narrow ? 48 : 60}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              tickFormatter={(value: number) => (view === "return" ? `${(value * 100).toFixed(step < 0.01 ? 1 : 0)}%` : money(value, currency, true))}
            />
            {view === "return" && <ReferenceLine y={0} stroke="var(--border-strong)" />}
            <Tooltip content={<ChartTooltip view={view} currency={currency} />} cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }} />
            {series.map((item, index) => (
              <Line
                key={item.key}
                dataKey={item.key}
                type={item.key === "cost" ? "stepAfter" : "linear"}
                stroke={item.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: item.color, stroke: "var(--card)", strokeWidth: 2 }}
                label={<EndLabel count={rows.length} shift={shifts[index]} text={(value) => (narrow ? format(value) : `${item.short} ${format(value)}`)} />}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="portfolio-chart-table">
        <summary>Month by month</summary>
        <div className="table-scroll">
          <table className="financial-table">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Value</th>
                <th scope="col">Cost</th>
                <th scope="col">You</th>
                <th scope="col">S&amp;P 500</th>
              </tr>
            </thead>
            <tbody>
              {months.map((row) => (
                <tr key={row.date}>
                  <th scope="row">{formatDate(row.t, { month: "short", year: "numeric" })}</th>
                  <td>{money(row.value, currency)}</td>
                  <td>{money(row.cost, currency)}</td>
                  <td className={tone(row.you)}>{signedPercent(row.you)}</td>
                  <td className={tone(row.benchmark)}>{row.benchmark === undefined ? "—" : signedPercent(row.benchmark)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
