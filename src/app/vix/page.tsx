import type { Metadata } from "next";
import { AppShell } from "../components/app-shell";
import { VixChart } from "./vix-chart";
import { VixGauge } from "./vix-gauge";
import { providerFailureMessage } from "@/lib/fmp-messages";
import { chartHistory, getVix, VIX_ZONES, vixScore, vixStats, vixZone, type VixData, type VixZone } from "@/lib/vix";

export const metadata: Metadata = {
  title: "VIX fear gauge — StockPilot",
  description: "The VIX volatility index as a fear and greed gauge, with its history.",
};

function formatDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${isoDate}T12:00:00Z`));
}

function signed(value: number, digits = 2): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function ZoneTag({ zone }: { zone: VixZone }) {
  return (
    <span className={`vix-zone-tag vix-zone-${zone.id}`}>
      <span className="vix-zone-swatch" aria-hidden="true" />
      {zone.label}
    </span>
  );
}

function zoneRange(zone: VixZone): string {
  if (zone.from === null) return `Below ${zone.to}`;
  if (zone.to === null) return `${zone.from} and above`;
  return `${zone.from} to ${zone.to}`;
}

export default async function VixPage() {
  const result = await getVix();

  return (
    <AppShell contentClassName="dashboard-content" activeSection="vix" dataSource="VIX data from Cboe and Financial Modeling Prep">
      <section className="company-heading">
        <div>
          <p className="section-label">MARKETS</p>
          <div className="company-title-row">
            <h1>VIX fear gauge</h1>
          </div>
          <p className="company-subtitle">
            The VIX measures how much the S&amp;P 500 options market expects prices to swing over the next 30 days. When
            it&apos;s high, investors are paying up for protection (fear); when it&apos;s low, they&apos;re relaxed (greed).
          </p>
        </div>
      </section>

      {!result.ok ? (
        <section className="empty-state" role="status">
          <span className="empty-state-icon" aria-hidden="true">!</span>
          <div>
            <h2>We couldn&apos;t load the VIX</h2>
            <p>{providerFailureMessage(result.reason, "the VIX")} Cboe&apos;s free history didn&apos;t respond either.</p>
          </div>
        </section>
      ) : (
        <VixBody data={result.data} />
      )}
    </AppShell>
  );
}

function VixBody({ data }: { data: VixData }) {
  const { quote } = data;
  const zone = vixZone(quote.value);
  const stats = vixStats(data);
  const percentile = stats.yearPercentile;

  return (
    <>
      <div className="vix-top">
        <section className="vix-card vix-reading" aria-labelledby="vix-reading-heading">
          <h2 id="vix-reading-heading" className="visually-hidden">Today&apos;s reading</h2>
          <VixGauge score={vixScore(quote.value)} zone={zone} value={quote.value} />
          <div className="vix-hero">
            <p className="vix-zone-name">{zone.label}</p>
            <p className="vix-value">
              <span className="vix-value-label">VIX</span> {quote.value.toFixed(2)}
              {quote.change !== null && (
                <span className="vix-change">
                  {signed(quote.change)}
                  {quote.changePercent !== null && ` (${signed(quote.changePercent * 100)}%)`}
                </span>
              )}
            </p>
            <p className="vix-asof">
              {quote.source === "fmp" ? "Latest" : "Close"} on {formatDate(quote.date)}
              {quote.dayLow !== null && quote.dayHigh !== null && ` · day's range ${quote.dayLow.toFixed(2)}–${quote.dayHigh.toFixed(2)}`}
            </p>
            <p className="vix-meaning">{zone.meaning}</p>
          </div>
        </section>

        <section className="vix-card vix-context" aria-labelledby="vix-context-heading">
          <h2 id="vix-context-heading">Then and now</h2>
          <table className="vix-compare-table">
            <caption className="visually-hidden">The VIX at earlier dates</caption>
            <tbody>
              {stats.comparisons.map(({ label, point }) => (
                <tr key={label}>
                  <th scope="row">
                    {label}
                    {point && <small>{formatDate(point.date)}</small>}
                  </th>
                  <td>{point ? point.close.toFixed(2) : "—"}</td>
                  <td>{point && <ZoneTag zone={vixZone(point.close)} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="vix-stats">
            {stats.yearLow !== null && stats.yearHigh !== null && (
              <div><dt>52-week range</dt><dd>{stats.yearLow.toFixed(2)} – {stats.yearHigh.toFixed(2)}</dd></div>
            )}
            {stats.yearAverage !== null && <div><dt>1-year average</dt><dd>{stats.yearAverage.toFixed(2)}</dd></div>}
            {stats.longRunAverage !== null && stats.longRunSince && (
              <div><dt>Average since {stats.longRunSince.slice(0, 4)}</dt><dd>{stats.longRunAverage.toFixed(2)}</dd></div>
            )}
          </dl>
          {percentile !== null && (
            <p className="vix-percentile">
              Today&apos;s reading is higher than <strong>{Math.round(percentile * 100)}%</strong> of the past year&apos;s closes.
            </p>
          )}
        </section>
      </div>

      <VixChart history={chartHistory(data.history, quote.date)} />

      <section className="vix-card vix-zones" aria-labelledby="vix-zones-heading">
        <h2 id="vix-zones-heading">How to read the gauge</h2>
        <div className="table-scroll">
          <table className="financial-table vix-zone-table">
            <thead>
              <tr>
                <th scope="col">Zone</th>
                <th scope="col">VIX</th>
                <th scope="col">What it usually means</th>
              </tr>
            </thead>
            <tbody>
              {[...VIX_ZONES].reverse().map((item) => (
                <tr key={item.id} className={item.id === zone.id ? "vix-zone-row-current" : ""} aria-current={item.id === zone.id ? "true" : undefined}>
                  <th scope="row"><ZoneTag zone={item} /></th>
                  <td>{zoneRange(item)}</td>
                  <td>{item.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="news-footnote">
        {quote.source === "fmp" ? "Latest value from Financial Modeling Prep" : "FMP's quote wasn't available, so this is Cboe's latest close"};{" "}
        {data.historySource === "cboe" ? "daily history from Cboe since 1990" : "Cboe's history wasn't available, so the daily history comes from FMP (five years)"}.
        The zones are common rules of thumb, not a formula. The VIX shows how nervous the market is, not where it&apos;s going
        next: spikes have often come near market lows, and long calm stretches near highs.
      </p>
    </>
  );
}
