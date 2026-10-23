"use client";

import { useId, useMemo, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  LabelList,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartSeries, ValueFormat } from "@/lib/financial-statements";

type ChartType = "area" | "bar" | "line";

// Red (chart-4) comes last so a profit line never reads as a loss: revenue is blue, net income green.
const COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-5)", "var(--chart-2)", "var(--chart-6)", "var(--chart-4)"];
const CHART_TYPES: { id: ChartType; label: string }[] = [
  { id: "area", label: "Area" },
  { id: "bar", label: "Bars" },
  { id: "line", label: "Line" },
];

// Series that share a unit share an axis: amounts, per-share figures and ratios, or percentages.
function axisGroup(format: ValueFormat): "amount" | "perShare" | "percent" {
  if (format === "money" || format === "shares") return "amount";
  if (format === "percent" || format === "growth") return "percent";
  return "perShare";
}

function formatValue(value: number, format: ValueFormat): string {
  switch (axisGroup(format)) {
    case "amount":
      return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    default:
      return value.toFixed(2);
  }
}

export function StatementChart({
  title,
  series,
  defaults,
  labels,
  headingLevel = 2,
}: {
  title: string;
  series: ChartSeries[];
  defaults: string[];
  labels: string[];
  // h3 when the chart sits under a page heading with other charts.
  headingLevel?: 2 | 3;
}) {
  const headingId = useId();
  const Heading = headingLevel === 3 ? "h3" : "h2";
  const [selected, setSelected] = useState<string[]>(defaults.length > 0 ? defaults : series.slice(0, 1).map((item) => item.id));
  const [chartType, setChartType] = useState<ChartType>("area");

  const data = useMemo(
    () => labels.map((label, index) => Object.fromEntries([["label", label], ...series.map((item) => [item.id, item.values[index]])])),
    [labels, series],
  );

  const active = series.filter((item) => selected.includes(item.id));
  const leftGroup = active[0] ? axisGroup(active[0].format) : "amount";
  const leftFormat = active.find((item) => axisGroup(item.format) === leftGroup)?.format ?? "money";
  const rightFormat = active.find((item) => axisGroup(item.format) !== leftGroup)?.format ?? null;

  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.length > 1 ? current.filter((value) => value !== id) : current
        : [...current, id],
    );
  }

  if (series.length === 0) return null;

  return (
    <section className="statement-chart" aria-labelledby={headingId}>
      <div className="statement-chart-heading">
        <Heading id={headingId}>{title}</Heading>
        <div className="chart-view-switch" role="group" aria-label="Chart type">
          {CHART_TYPES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={chartType === option.id ? "chart-view-active" : ""}
              aria-pressed={chartType === option.id}
              onClick={() => setChartType(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="statement-chart-plot" role="img" aria-label={`${title}: ${active.map((item) => item.label).join(", ")}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 24, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 5" vertical={false} />
            <XAxis
              dataKey="label"
              axisLine={false}
              tickLine={false}
              // Room for the value labels on the first and last points.
              padding={{ left: 32, right: 32 }}
              tick={{ fill: "var(--muted-foreground)", fontSize: 13 }}
              tickMargin={10}
            />
            <YAxis
              yAxisId="left"
              axisLine={false}
              tickLine={false}
              width={64}
              tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
              tickFormatter={(value: number) => formatValue(value, leftFormat)}
            />
            {rightFormat && (
              <YAxis
                yAxisId="right"
                orientation="right"
                axisLine={false}
                tickLine={false}
                width={56}
                tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                tickFormatter={(value: number) => formatValue(value, rightFormat)}
              />
            )}
            <Tooltip
              formatter={(value: unknown, name: unknown) => {
                const item = series.find((candidate) => candidate.label === name);
                return typeof value === "number" && item ? formatValue(value, item.format) : "—";
              }}
              contentStyle={{ background: "var(--card)", borderColor: "var(--border)", borderRadius: 6 }}
              labelStyle={{ color: "var(--foreground)", fontWeight: 600 }}
              itemStyle={{ color: "var(--foreground)", fontSize: 13 }}
            />
            {active.map((item) => {
              const color = COLORS[series.indexOf(item) % COLORS.length];
              const common = {
                dataKey: item.id,
                name: item.label,
                yAxisId: axisGroup(item.format) === leftGroup ? "left" : "right",
                isAnimationActive: false,
              };
              const labels = (
                <LabelList
                  dataKey={item.id}
                  position="top"
                  offset={8}
                  fontSize={12}
                  fill="var(--muted-foreground)"
                  formatter={(value: unknown) => (typeof value === "number" ? formatValue(value, item.format) : "")}
                />
              );
              if (chartType === "bar") {
                return <Bar key={item.id} {...common} fill={color} radius={[3, 3, 0, 0]} maxBarSize={44}>{labels}</Bar>;
              }
              if (chartType === "line") {
                return <Line key={item.id} {...common} type="linear" stroke={color} strokeWidth={2} dot={{ r: 3 }} connectNulls>{labels}</Line>;
              }
              return (
                <Area key={item.id} {...common} type="linear" stroke={color} strokeWidth={2} fill={color} fillOpacity={0.18} connectNulls>
                  {labels}
                </Area>
              );
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="statement-chart-legend" role="group" aria-label="Series shown">
        {series.map((item, index) => {
          const on = selected.includes(item.id);
          return (
            <button key={item.id} type="button" aria-pressed={on} className={on ? "" : "statement-legend-off"} onClick={() => toggle(item.id)}>
              <span className="statement-legend-dot" style={{ background: COLORS[index % COLORS.length] }} aria-hidden="true" />
              {item.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
