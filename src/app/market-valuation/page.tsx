import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../components/app-shell";
import { PercentileBar } from "./percentile-bar";
import { ValuationChart, type ChartMetric } from "./valuation-chart";
import { isDatabaseConfigured } from "@/lib/db";
import {
  MIN_ZONE_POINTS,
  ZONES,
  historyStats,
  loadSeries,
  loadSummaries,
  ndxToday,
  reading,
  sameMonth,
  sp500Today,
  yieldGap,
  type Reading,
  type TodayEstimate,
  type ValuationPoint,
  type ValuationSeries,
  type ValuationSummary,
} from "@/lib/market-valuation";

export const metadata: Metadata = {
  title: "Market valuation — StockPilot",
  description: "The S&P 500's and the Nasdaq-100's P/E, CAPE, earnings yield and the Buffett indicator against their history.",
};

const INDEXES = [
  { id: "sp500", label: "S&P 500" },
  { id: "ndx", label: "Nasdaq-100" },
] as const;

type PageProps = { searchParams: Promise<{ index?: string | string[] }> };

type Loaded =
  | { ok: true; series: ValuationSeries; summaries: Partial<Record<"sp500" | "ndx", ValuationSummary>> }
  | { ok: false; reason: "no-database" | "empty" | "failed" };

async function load(): Promise<Loaded> {
  if (!isDatabaseConfigured()) return { ok: false, reason: "no-database" };
  try {
    const [series, summaries] = await Promise.all([loadSeries(), loadSummaries()]);
    if (!series.sp500?.pe?.length && !series.ndx?.pe?.length) return { ok: false, reason: "empty" };
    return { ok: true, series, summaries };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

function formatDate(isoDate: string, month = false): string {
  const options: Intl.DateTimeFormatOptions = month ? { month: "short", year: "numeric" } : { month: "short", day: "numeric", year: "numeric" };
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(new Date(`${isoDate}T12:00:00Z`));
}

const fixed = (value: number, digits = 1) => value.toFixed(digits);
const signed = (value: number, digits = 1) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}`;

export default async function MarketValuationPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const requested = Array.isArray(params.index) ? params.index[0] : params.index;
  const index = INDEXES.find((item) => item.id === requested) ?? INDEXES[0];
  const loaded = await load();

  return (
    <AppShell contentClassName="dashboard-content" activeSection="market-valuation" dataSource="Data from Robert Shiller, Siblis Research and FRED">
      <section className="company-heading">
        <div>
          <p className="section-label">MARKETS</p>
          <div className="company-title-row">
            <h1>Market valuation</h1>
          </div>
          <p className="company-subtitle">
            {index.id === "sp500"
              ? "Is the market cheap or expensive? The S&P 500's price against its earnings, dividends and the economy, compared with a century and a half of its own history and with bond yields."
              : "Is the Nasdaq-100 cheap or expensive? Its price against its past and expected earnings, next to the S&P 500's."}
          </p>
        </div>
      </section>

      <nav className="statement-tabs market-map-tabs" aria-label="Market index">
        {INDEXES.map((item) => (
          <Link
            key={item.id}
            href={item.id === "sp500" ? "/market-valuation" : `/market-valuation?index=${item.id}`}
            className={item.id === index.id ? "statement-tab-active" : undefined}
            aria-current={item.id === index.id ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {!loaded.ok ? (
        <EmptyState reason={loaded.reason} />
      ) : index.id === "sp500" ? (
        <Sp500 series={loaded.series} summary={loaded.summaries.sp500} />
      ) : (
        <Ndx series={loaded.series} summary={loaded.summaries.ndx} />
      )}

      <HowToRead />
    </AppShell>
  );
}

function EmptyState({ reason }: { reason: "no-database" | "empty" | "failed" }) {
  const text = {
    "no-database": "Market valuation is stored in the database. Set DATABASE_URL, then run npm run db:setup and npm run market-valuation:update.",
    empty: "No valuation data has been stored yet. Run npm run market-valuation:update (GitHub Actions runs it every day).",
    failed: "The database didn't answer. Try again in a moment.",
  }[reason];
  return (
    <section className="empty-state" role="status">
      <span className="empty-state-icon" aria-hidden="true">!</span>
      <div>
        <h2>We couldn&apos;t show the market&apos;s valuation</h2>
        <p>{text}</p>
      </div>
    </section>
  );
}

// ---------- Today's reading ----------

function TodayCard({ title, estimate, item, earningsNote }: { title: string; estimate: TodayEstimate | null; item: Reading | null; earningsNote: string }) {
  const value = estimate?.value ?? item?.latest.value;
  if (value === undefined) return null;
  return (
    <section className="vix-card mv-today" aria-labelledby="mv-today-heading">
      <h2 id="mv-today-heading" className="visually-hidden">Today&apos;s reading</h2>
      {item?.zone && <p className="vix-zone-name">{item.zone.label}</p>}
      <p className="mv-value">
        <span className="vix-value-label">{title}</span> {fixed(value)}
      </p>
      <p className="mv-asof">
        {estimate ? (
          <>
            Estimate: the close on {formatDate(estimate.level.date)} over {earningsNote} {formatDate(estimate.earningsDate, true)}
            {estimate.provisional && " (still an estimate itself)"}.
          </>
        ) : (
          item && <>As of {formatDate(item.latest.date, true)}.</>
        )}
      </p>
      {item?.zone && item.percentile !== null && (
        <>
          <PercentileBar percentile={item.percentile} zone={item.zone} label={title} />
          <p className="vix-percentile">
            Higher than <strong>{Math.round(item.percentile)}%</strong> of months since {item.stats?.since.slice(0, 4)}. {item.zone.meaning}
          </p>
        </>
      )}
    </section>
  );
}

function ThenAndNow({ item, label, digits = 1, unit = "" }: { item: Reading; label: string; digits?: number; unit?: string }) {
  const stats = item.stats;
  const rows = [{ label: "Latest month", point: item.latest as ValuationPoint | null }, ...item.comparisons];
  return (
    <section className="vix-card vix-context" aria-labelledby="mv-context-heading">
      <h2 id="mv-context-heading">Then and now</h2>
      <table className="vix-compare-table">
        <caption className="visually-hidden">{label} at earlier dates</caption>
        <tbody>
          {rows.map(({ label: when, point }) => (
            <tr key={when}>
              <th scope="row">
                {when}
                {point && <small>{formatDate(point.date, true)}{point.provisional ? " · estimate" : ""}</small>}
              </th>
              <td>{point ? `${fixed(point.value, digits)}${unit}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {stats && (
        <dl className="vix-stats">
          <div><dt>Average since {stats.since.slice(0, 4)}</dt><dd>{fixed(stats.average, digits)}{unit}</dd></div>
          <div><dt>Low</dt><dd>{fixed(stats.low.value, digits)}{unit} <small>{formatDate(stats.low.date, true)}</small></dd></div>
          <div><dt>High</dt><dd>{fixed(stats.high.value, digits)}{unit} <small>{formatDate(stats.high.date, true)}</small></dd></div>
        </dl>
      )}
    </section>
  );
}

type Metric = { label: string; value: string; detail: string; zone?: Reading["zone"] };

function MetricCards({ metrics }: { metrics: Metric[] }) {
  return (
    <section className="mv-metrics" aria-label="Valuation measures">
      {metrics.map((metric) => (
        <div key={metric.label} className="vix-card mv-metric">
          <p className="mv-metric-label">{metric.label}</p>
          <p className="mv-metric-value">{metric.value}</p>
          {metric.zone && (
            <span className={`vix-zone-tag mv-zone-${metric.zone.id}`}>
              <span className="vix-zone-swatch" aria-hidden="true" />
              {metric.zone.label}
            </span>
          )}
          <p className="mv-metric-detail">{metric.detail}</p>
        </div>
      ))}
    </section>
  );
}

function percentileDetail(item: Reading, unit = "", digits = 1): string {
  const parts = [`${formatDate(item.latest.date, true)}${item.latest.provisional ? " (estimate)" : ""}`];
  if (item.stats) parts.push(`average ${fixed(item.stats.average, digits)}${unit} since ${item.stats.since.slice(0, 4)}`);
  // Said from the nearer end, so a low yield reads "lower than 99%" rather than "higher than 1%".
  if (item.percentile !== null) {
    parts.push(item.percentile >= 50 ? `higher than ${Math.round(item.percentile)}% of the history` : `lower than ${Math.round(100 - item.percentile)}% of the history`);
  }
  return parts.join(" · ");
}

function SummaryCard({ summary }: { summary: ValuationSummary | undefined }) {
  if (!summary) return null;
  return (
    <section className="vix-card mv-summary" aria-labelledby="mv-summary-heading">
      <h2 id="mv-summary-heading">AI summary</h2>
      <p>{summary.text}</p>
      <p className="mv-summary-meta">
        Written by {summary.model} on {formatDate(summary.createdAt.slice(0, 10))} from the numbers on this page. Not investment advice.
      </p>
    </section>
  );
}

function bands(points: ValuationPoint[] | undefined) {
  const stats = points ? historyStats(points) : null;
  return stats ? { average: stats.average, deviation: stats.deviation, since: stats.since } : undefined;
}

// ---------- The S&P 500 ----------

function Sp500({ series, summary }: { series: ValuationSeries; summary: ValuationSummary | undefined }) {
  const today = sp500Today(series);
  const pe = reading(series.sp500?.pe, "pe", today?.value);
  const cape = reading(series.sp500?.cape, "cape");
  const dividend = reading(series.sp500?.dividend_yield, "dividend_yield");
  const gapPoints = yieldGap(series.sp500?.earnings_yield, series.sp500?.ten_year);
  const gap = reading(gapPoints, "gap");
  const buffett = reading(series.us?.buffett, "buffett");

  const metrics: Metric[] = [];
  if (pe) metrics.push({ label: "Trailing P/E, monthly", value: fixed(pe.latest.value), detail: percentileDetail(reading(series.sp500?.pe, "pe")!) });
  if (cape) metrics.push({ label: "CAPE (Shiller P/E)", value: fixed(cape.latest.value), zone: cape.zone, detail: percentileDetail(cape) });
  if (gap) metrics.push({ label: "Earnings yield − 10-year yield", value: `${signed(gap.latest.value)} pts`, detail: percentileDetail(gap, " pts") });
  if (dividend) metrics.push({ label: "Dividend yield", value: `${fixed(dividend.latest.value, 2)}%`, detail: percentileDetail(dividend, "%", 2) });
  if (buffett) metrics.push({ label: "Buffett indicator (US)", value: `${fixed(buffett.latest.value, 0)}%`, zone: buffett.zone, detail: percentileDetail(buffett, "%", 0) });

  const chart: ChartMetric[] = [
    { id: "pe", label: "P/E", unit: "", digits: 1, lines: [{ key: "pe", label: "Trailing P/E", points: series.sp500?.pe ?? [] }], bands: bands(series.sp500?.pe), note: "Spikes like 2009's come from earnings collapsing in a recession, not from prices soaring. CAPE smooths them out." },
    { id: "cape", label: "CAPE", unit: "", digits: 1, lines: [{ key: "cape", label: "CAPE", points: series.sp500?.cape ?? [] }], bands: bands(series.sp500?.cape) },
    {
      id: "yields",
      label: "Earnings yield vs 10Y",
      unit: "%",
      digits: 2,
      lines: [
        { key: "ey", label: "Earnings yield (E/P)", points: series.sp500?.earnings_yield ?? [] },
        { key: "ten", label: "10-year Treasury yield", points: series.sp500?.ten_year ?? [] },
      ],
      note: "Below the 10-year yield, stocks earn less on their price than bonds pay. That was usual from the late 1960s to 2001; since then it happened in 2002–03 and 2008–09, when earnings collapsed, and again since 2023.",
    },
    { id: "dividend", label: "Dividend yield", unit: "%", digits: 2, lines: [{ key: "dy", label: "Dividend yield", points: series.sp500?.dividend_yield ?? [] }], bands: bands(series.sp500?.dividend_yield) },
    { id: "buffett", label: "Buffett indicator", unit: "%", digits: 0, lines: [{ key: "buffett", label: "Stock market value / GDP", points: series.us?.buffett ?? [] }], bands: bands(series.us?.buffett), note: "The value of all US corporate shares, not only the S&P 500's, against GDP, quarterly." },
  ].filter((item) => item.lines[0].points.length > 0);

  return (
    <>
      <div className="vix-top">
        <TodayCard title="P/E" estimate={today} item={pe} earningsNote="Shiller's trailing twelve months' earnings to" />
        {pe && <ThenAndNow item={reading(series.sp500?.pe, "pe")!} label="The S&P 500's P/E" />}
      </div>
      <MetricCards metrics={metrics} />
      <ValuationChart title="S&P 500 history" metrics={chart} />
      <SummaryCard summary={summary} />
      <p className="news-footnote">
        S&amp;P 500 price, earnings, dividends, the 10-year rate and CAPE from Robert Shiller&apos;s dataset, monthly since
        1871 (prices are each month&apos;s average close; the latest months&apos; earnings are estimates and get revised).
        Today&apos;s close from FRED. The Buffett indicator from FRED (market value of US corporate equities over GDP).
      </p>
    </>
  );
}

// ---------- The Nasdaq-100 ----------

function Ndx({ series, summary }: { series: ValuationSeries; summary: ValuationSummary | undefined }) {
  const today = ndxToday(series);
  const forwardToday = ndxToday(series, "pe_forward");
  const pe = reading(series.ndx?.pe, "pe");
  const forward = reading(series.ndx?.pe_forward, "pe_forward");
  const cape = reading(series.ndx?.cape, "cape");
  const snapshots = series.ndx?.pe ?? [];
  const since = snapshots[0]?.date;
  const sp500AtSnapshots = snapshots.flatMap((point) => {
    const match = sameMonth(series.sp500?.pe, point.date);
    return match ? [{ ...match, date: point.date }] : [];
  });
  const sp500Latest = series.sp500?.pe?.at(-1);

  const metrics: Metric[] = [];
  if (forwardToday && forward) {
    metrics.push({
      label: "Forward P/E today",
      value: fixed(forwardToday.value),
      detail: `Estimate: ${fixed(forward.latest.value)} in the ${formatDate(forward.latest.date, true)} snapshot, moved with the index to the close on ${formatDate(forwardToday.level.date)}`,
    });
  }
  if (pe) metrics.push({ label: "Trailing P/E, latest snapshot", value: fixed(pe.latest.value), detail: percentileDetail(pe) });
  if (cape) metrics.push({ label: "CAPE", value: fixed(cape.latest.value), detail: percentileDetail(cape) });
  if (sp500Latest) metrics.push({ label: "S&P 500 trailing P/E", value: fixed(sp500Latest.value), detail: `${formatDate(sp500Latest.date, true)}${sp500Latest.provisional ? " (estimate)" : ""} · for comparison` });

  const chart: ChartMetric[] = [
    {
      id: "pe",
      label: "P/E",
      unit: "",
      digits: 1,
      lines: [
        { key: "ndx", label: "Nasdaq-100 trailing P/E", points: snapshots },
        { key: "spx", label: "S&P 500 trailing P/E", points: sp500AtSnapshots },
      ],
    },
    { id: "forward", label: "Forward P/E", unit: "", digits: 1, lines: [{ key: "fpe", label: "Forward P/E", points: series.ndx?.pe_forward ?? [] }] },
    { id: "cape", label: "CAPE", unit: "", digits: 1, lines: [{ key: "cape", label: "CAPE", points: series.ndx?.cape ?? [] }] },
  ].filter((item) => item.lines[0].points.length > 0);

  return (
    <>
      <div className="vix-top">
        <TodayCard title="P/E" estimate={today} item={pe} earningsNote="the earnings implied by the snapshot of" />
        <section className="vix-card vix-context" aria-labelledby="mv-ndx-history-heading">
          <h2 id="mv-ndx-history-heading">A short history so far</h2>
          <p className="mv-text">
            Siblis Research&apos;s free data has {snapshots.length} snapshots of the Nasdaq-100&apos;s valuation
            {since ? `, starting ${formatDate(since, true)}` : ""}. That&apos;s too short to call a level cheap or expensive
            (the zones need {MIN_ZONE_POINTS / 12} years of months), so this tab compares it with the S&amp;P 500 instead.
            Each new snapshot is kept, so the history grows.
          </p>
          {pe?.stats && (
            <dl className="vix-stats">
              <div><dt>Average P/E since {formatDate(pe.stats.since, true)}</dt><dd>{fixed(pe.stats.average)}</dd></div>
              <div><dt>Low</dt><dd>{fixed(pe.stats.low.value)} <small>{formatDate(pe.stats.low.date, true)}</small></dd></div>
              <div><dt>High</dt><dd>{fixed(pe.stats.high.value)} <small>{formatDate(pe.stats.high.date, true)}</small></dd></div>
            </dl>
          )}
          {pe && sp500Latest && (
            <p className="vix-percentile">
              The Nasdaq-100 trades at <strong>{fixed(pe.latest.value / (sameMonth(series.sp500?.pe, pe.latest.date)?.value ?? sp500Latest.value), 2)}×</strong> the S&amp;P 500&apos;s P/E.
            </p>
          )}
        </section>
      </div>
      <MetricCards metrics={metrics} />
      <ValuationChart title="Nasdaq-100 snapshots" metrics={chart} />
      <SummaryCard summary={summary} />
      <p className="news-footnote">
        Nasdaq-100 trailing and forward P/E and CAPE from Siblis Research&apos;s free data, month-end snapshots. Today&apos;s
        estimate divides the latest close (FRED) by the earnings each snapshot implies. The S&amp;P 500 from Robert
        Shiller&apos;s dataset.
      </p>
    </>
  );
}

// ---------- How to read it ----------

function HowToRead() {
  return (
    <section className="vix-card vix-zones" aria-labelledby="mv-read-heading">
      <h2 id="mv-read-heading">How to read it</h2>
      <dl className="mv-glossary">
        <div><dt>Trailing P/E</dt><dd>The index&apos;s price over the last twelve months&apos; earnings, as reported (GAAP). Headlines often quote &quot;operating&quot; earnings, which leave out one-off costs, so their P/E is lower.</dd></div>
        <div><dt>Forward P/E</dt><dd>The price over the earnings analysts expect for the next twelve months. Lower than the trailing P/E when earnings are expected to grow.</dd></div>
        <div><dt>CAPE</dt><dd>Robert Shiller&apos;s cyclically adjusted P/E: the price over the average of ten years of inflation-adjusted earnings, so one bad or great year doesn&apos;t swing it.</dd></div>
        <div><dt>Earnings yield vs 10-year yield</dt><dd>The earnings yield (E/P) is the P/E turned upside down. Below the 10-year Treasury yield, stocks earn less on their price than safe bonds pay.</dd></div>
        <div><dt>Buffett indicator</dt><dd>The value of all US corporate shares over the country&apos;s GDP. It has trended up over the decades, partly because US companies earn more abroad, so compare it with recent decades too.</dd></div>
      </dl>
      <div className="table-scroll">
        <table className="financial-table vix-zone-table">
          <thead>
            <tr>
              <th scope="col">Zone</th>
              <th scope="col">Percentile of its history</th>
              <th scope="col">What it means</th>
            </tr>
          </thead>
          <tbody>
            {ZONES.map((zone) => (
              <tr key={zone.id}>
                <th scope="row">
                  <span className={`vix-zone-tag mv-zone-${zone.id}`}>
                    <span className="vix-zone-swatch" aria-hidden="true" />
                    {zone.label}
                  </span>
                </th>
                <td>{zone.from} to {zone.to}</td>
                <td>{zone.meaning}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mv-text">
        High valuations have been followed by lower returns over the next ten years, but they say little about the next
        few months: markets have stayed expensive for years. Not investment advice.
      </p>
    </section>
  );
}

