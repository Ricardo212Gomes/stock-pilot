"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MonthlyFlow } from "@/lib/insiders";

// The minimum is set so Node and browsers agree ("$20M", not "$20.0M" on one of them), or hydration fails.
function compactMoney(value: number): string {
  const text = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(Math.abs(value));
  return value < 0 ? `−${text}` : text;
}

function monthLabel(month: string, year = false): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", ...(year ? { year: "numeric" } : {}), timeZone: "UTC" }).format(new Date(`${month}-01T12:00:00Z`));
}

type ChartRow = { month: string; bought: number; sold: number };

function FlowTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  return (
    <div className="insider-chart-tooltip">
      <strong>{monthLabel(row.month, true)}</strong>
      <span><span className="insider-swatch insider-swatch-bought" />Bought {compactMoney(row.bought)}</span>
      <span><span className="insider-swatch insider-swatch-sold" />Sold {compactMoney(-row.sold)}</span>
    </div>
  );
}

// Dollars insiders bought (up) and sold (down) in the market each month: direction is position as well as colour.
export function InsiderChart({ months }: { months: MonthlyFlow[] }) {
  const data = months.map((flow) => ({ month: flow.month, bought: flow.bought, sold: -flow.sold }));
  const total = (key: "bought" | "sold") => months.reduce((sum, flow) => sum + flow[key], 0);
  return (
    <>
      <p className="insider-legend">
        <span><span className="insider-swatch insider-swatch-bought" />Bought</span>
        <span><span className="insider-swatch insider-swatch-sold" />Sold</span>
      </p>
      <div
        className="insider-chart-plot"
        role="img"
        aria-label={`Insider trades in the market over the last 12 months: ${compactMoney(total("bought"))} bought and ${compactMoney(total("sold"))} sold.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} stackOffset="sign" margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="25%">
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="month" axisLine={false} tickLine={false} tickMargin={8} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickFormatter={(month: string) => monthLabel(month)} />
            <YAxis axisLine={false} tickLine={false} width={64} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} tickFormatter={compactMoney} />
            <ReferenceLine y={0} stroke="var(--border-strong)" />
            <Tooltip content={<FlowTooltip />} cursor={{ fill: "var(--highlight)" }} />
            <Bar dataKey="bought" stackId="flow" fill="var(--positive)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            {/* Sales hang below zero, so their rounded end is the bottom. */}
            <Bar dataKey="sold" stackId="flow" fill="var(--negative)" radius={[0, 0, 4, 4]} maxBarSize={24} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  );
}
