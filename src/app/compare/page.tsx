import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "../components/app-shell";
import { CompanyLogo } from "../components/company-logo";
import { TickerSearch } from "../components/ticker-search";
import { providerFailureMessage } from "@/lib/fmp-messages";
import {
  bestIndex,
  getComparedStock,
  MAX_COMPARED,
  METRIC_SECTIONS,
  parseSymbols,
  type ComparedStockResult,
  type MetricDefinition,
} from "@/lib/stock-comparison";
import { formatMoney, formatPercent, formatSignedPercent } from "@/lib/valuation/format";

export const metadata: Metadata = {
  title: "Compare stocks — StockPilot",
  description: "Valuation, expected growth and margins for up to five stocks side by side.",
};

const EXAMPLES = [
  ["AAPL", "MSFT", "GOOGL"],
  ["KO", "PEP"],
  ["NVDA", "AMD"],
];

type ComparePageProps = {
  searchParams: Promise<{ symbols?: string | string[]; add?: string | string[] }>;
};

function compareHref(symbols: string[]): string {
  return symbols.length > 0 ? `/compare?symbols=${symbols.join(",")}` : "/compare";
}

function formatValue(value: number | null, metric: MetricDefinition): string {
  if (value === null) return "—";
  if (metric.kind === "multiple") return `${value.toFixed(1)}×`;
  return metric.kind === "growth" ? formatSignedPercent(value) : formatPercent(value);
}

function formatTypical({ kind, typical: [low, high] }: MetricDefinition): string {
  if (kind === "multiple") return `${low}–${high}×`;
  // 0.045 → 4.5, 0.08 → 8
  const pct = (value: number) => String(Math.round(value * 1000) / 10);
  return `${pct(low)}–${pct(high)}%`;
}

function StockHeading({ result }: { result: ComparedStockResult }) {
  const { symbol } = result.ok ? result.data : result;
  if (!result.ok) {
    return (
      <div className="compare-stock">
        <strong>{symbol}</strong>
        <small title={providerFailureMessage(result.reason, "the quote")}>Couldn&apos;t load</small>
      </div>
    );
  }

  const { data } = result;
  return (
    <div className="compare-stock">
      <Link className="compare-stock-link" href={`/stock?symbol=${encodeURIComponent(symbol)}`}>
        <span className="earnings-logo-box"><CompanyLogo symbol={symbol} /></span>
        <strong>{symbol}</strong>
      </Link>
      <small className="compare-stock-name" title={data.name}>{data.name}</small>
      <small>
        {formatMoney(data.price, "USD")}
        {data.marketCap !== null && <> · {formatMoney(data.marketCap, "USD", true)}</>}
      </small>
      <small>
        {data.currentYear === null
          ? "No estimates"
          : `Est. FY${data.currentYear}${data.nextYear !== null ? ` · FY${data.nextYear}` : ""}`}
      </small>
    </div>
  );
}

function CompareTable({ results, symbols }: { results: ComparedStockResult[]; symbols: string[] }) {
  return (
    <div className="table-scroll compare-scroll">
      <table className="financial-table compare-table">
        <caption className="visually-hidden">Comparison of {symbols.join(", ")}</caption>
        <thead>
          <tr>
            <th scope="col">Metric</th>
            {results.map((result, index) => (
              <th key={symbols[index]} scope="col"><StockHeading result={result} /></th>
            ))}
            <th scope="col" className="compare-typical">
              <span className="stat-term" title="Where many established companies sit, from Jeremy Lefebvre's comparison sheet. A yardstick, not a target.">Typical</span>
            </th>
          </tr>
        </thead>
        {METRIC_SECTIONS.map((section) => (
          <tbody key={section.label}>
            <tr className="compare-section-row">
              <th scope="colgroup" colSpan={results.length + 2}>{section.label}</th>
            </tr>
            {section.metrics.map((metric) => {
              const values = results.map((result) => (result.ok ? result.data.metrics[metric.id] : null));
              const best = bestIndex(values, metric.kind);
              return (
                <tr key={metric.id}>
                  <th scope="row"><span className="stat-term" title={metric.help}>{metric.label}</span></th>
                  {values.map((value, index) => {
                    const tone = metric.kind === "growth" && value !== null ? (value >= 0 ? "positive-value" : "negative-value") : "";
                    return (
                      <td key={symbols[index]} className={`${tone}${index === best ? " compare-best" : ""}`}>
                        {formatValue(value, metric)}
                        {index === best && <span className="visually-hidden"> (best)</span>}
                      </td>
                    );
                  })}
                  <td className="compare-typical">{formatTypical(metric)}</td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function Footnotes({ results }: { results: ComparedStockResult[] }) {
  const loaded = results.flatMap((result) => (result.ok ? [result.data] : []));
  const withoutEstimates = loaded.filter((stock) => stock.currentYear === null).map((stock) => stock.symbol);
  const fromFilings = loaded.filter((stock) => stock.statementSource === "sec").map((stock) => stock.symbol);
  const list = (symbols: string[]) => symbols.join(", ");

  return (
    <div className="news-footnote compare-footnote">
      <p>
        The best value in each row is underlined: the lowest multiple, or the highest growth or margin. &ldquo;This
        year&rdquo; is the fiscal year after the last annual report, and expected figures are analysts&apos; consensus
        from Financial Modeling Prep. TTM growth comes from Finnhub, which can take a few days to pick up a new
        report. A dash means the figure isn&apos;t available, or would be a multiple of (or growth from) a loss.
      </p>
      {withoutEstimates.length > 0 && (
        <p>
          No analyst estimates for {list(withoutEstimates)}: FMP&apos;s free plan doesn&apos;t include them for every
          company, so the forward P/E, forward P/S and expected growth rows are blank.
        </p>
      )}
      {fromFilings.length > 0 && <p>Reported figures for {list(fromFilings)} come from SEC filings.</p>}
    </div>
  );
}

export default async function ComparePage({ searchParams }: ComparePageProps) {
  const params = await searchParams;
  const symbols = parseSymbols(params.symbols);
  // The search adds a ticker as `add`; fold it into the list so the address stays shareable.
  if (params.add !== undefined) {
    redirect(compareHref(parseSymbols([...symbols, ...[params.add].flat()])));
  }

  const results = await Promise.all(symbols.map((symbol) => getComparedStock(symbol)));
  const full = symbols.length >= MAX_COMPARED;

  return (
    <AppShell contentClassName="dashboard-content" activeSection="compare" headerLabel={symbols.length > 0 ? `Compare · ${symbols.join(", ")}` : undefined}>
      <section className="company-heading">
        <div>
          <p className="section-label">WORKSPACE</p>
          <div className="company-title-row">
            <h1>Compare stocks</h1>
          </div>
          <p className="company-subtitle">
            Valuation, expected growth and margins for up to {MAX_COMPARED} stocks side by side, next to the range many
            established companies trade at.
          </p>
        </div>
      </section>

      <div className="compare-toolbar">
        {full ? (
          <p className="compare-full">Comparing the maximum of {MAX_COMPARED}. Remove one to add another.</p>
        ) : (
          <TickerSearch
            action="/compare"
            name="add"
            params={symbols.length > 0 ? { symbols: symbols.join(",") } : {}}
            buttonLabel="Add"
            placeholder={symbols.length > 0 ? "Add a company or ticker" : "Company or ticker to compare"}
          />
        )}
        {symbols.length > 0 && (
          <ul className="compare-chips" aria-label="Stocks being compared">
            {symbols.map((symbol) => (
              <li key={symbol}>
                <span>{symbol}</span>
                <Link
                  href={compareHref(symbols.filter((item) => item !== symbol))}
                  aria-label={`Remove ${symbol}`}
                  title={`Remove ${symbol}`}
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                    <path d="m3 3 6 6M9 3 3 9" />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {symbols.length === 0 && (
          <div className="home-chips">
            <span>Try</span>
            {EXAMPLES.map((example) => (
              <Link key={example.join()} href={compareHref(example)}>
                <strong>{example.join(" · ")}</strong>
              </Link>
            ))}
          </div>
        )}
      </div>

      {symbols.length === 0 ? (
        <section className="empty-state empty-state-info" role="status">
          <span className="empty-state-icon" aria-hidden="true">⇆</span>
          <div>
            <h2>Pick two or more stocks</h2>
            <p>Add companies one at a time with the search above, or start from one of the examples.</p>
          </div>
        </section>
      ) : (
        <>
          <CompareTable results={results} symbols={symbols} />
          <Footnotes results={results} />
        </>
      )}
    </AppShell>
  );
}
