"use client";

import { useMemo, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { vixZone, type VixPoint } from "@/lib/vix";

type Range = "1M" | "6M" | "1Y" | "5Y";

const RANGES: { id: Range; months: number }[] = [
  { id: "1M", months: 1 },
  { id: "6M", months: 6 },
  { id: "1Y", months: 12 },
  { id: "5Y", months: 60 },
];

// Where fear and extreme fear begin, labelled above their lines; the gauge's other edges sit too close
// together to label.
const THRESHOLDS = [
  { value: 20, label: "20 · Fear" },
  { value: 30, label: "30 · Extreme fear" },
];

function formatDate(isoDate: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${isoDate}T12:00:00Z`));
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: { payload: VixPoint }[] }) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;
  return (
    <div className="vix-chart-tooltip">
      <span>{formatDate(point.date, { month: "short", day: "numeric", year: "numeric" })}</span>
      <strong>{point.close.toFixed(2)}</strong>
      <span>{vixZone(point.close).label}</span>
    </div>
  );
}

// Daily VIX closes, oldest first; the last is today's reading.
export function VixChart({ history }: { history: VixPoint[] }) {
  const [range, setRange] = useState<Range>("1Y");

  const data = useMemo(() => {
    const last = history.at(-1);
    if (!last) return [];
    const from = new Date(`${last.date}T12:00:00Z`);
    from.setUTCMonth(from.getUTCMonth() - RANGES.find((item) => item.id === range)!.months);
    const start = from.toISOString().slice(0, 10);
    return history.filter((point) => point.date >= start);
  }, [history, range]);

  const longRange = range === "1Y" || range === "5Y";
  // Ticks every 10 (20 a step past 60), so the fear thresholds at 20 and 30 sit on gridlines.
  const peak = Math.max(35, ...data.map((point) => point.close));
  const step = peak > 60 ? 20 : 10;
  const top = Math.ceil(peak / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, index) => index * step);
  const first = data[0];
  const last = data.at(-1);

  return (
    <section className="vix-card vix-chart" aria-labelledby="vix-chart-heading">
      <div className="vix-chart-heading">
        <h2 id="vix-chart-heading">VIX history</h2>
        <div className="chart-view-switch" role="group" aria-label="Time range">
          {RANGES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={range === item.id ? "chart-view-active" : ""}
              aria-pressed={range === item.id}
              onClick={() => setRange(item.id)}
            >
              {item.id}
            </button>
          ))}
        </div>
      </div>
      <div
        className="vix-chart-plot"
        role="img"
        aria-label={first && last ? `VIX daily closes from ${first.date} (${first.close.toFixed(2)}) to ${last.date} (${last.close.toFixed(2)})` : "VIX history"}
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="date"
              axisLine={false}
              tickLine={false}
              minTickGap={48}
              tickMargin={10}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              tickFormatter={(date: string) => formatDate(date, longRange ? { month: "short", year: "2-digit" } : { month: "short", day: "numeric" })}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              width={40}
              domain={[0, top]}
              ticks={ticks}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            />
            {THRESHOLDS.map((threshold) => (
              <ReferenceLine
                key={threshold.value}
                y={threshold.value}
                stroke="var(--border-strong)"
                label={{
                  value: threshold.label,
                  position: "insideBottomLeft",
                  fill: "var(--muted-foreground)",
                  fontSize: 12,
                  // A halo in the card colour keeps the label readable where the line runs through it.
                  stroke: "var(--card)",
                  strokeWidth: 4,
                  paintOrder: "stroke",
                }}
              />
            ))}
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--border-strong)", strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey="close"
              name="VIX"
              stroke="var(--chart-1)"
              strokeWidth={2}
              fill="var(--chart-1)"
              fillOpacity={0.1}
              dot={false}
              activeDot={{ r: 4, fill: "var(--chart-1)", stroke: "var(--card)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
