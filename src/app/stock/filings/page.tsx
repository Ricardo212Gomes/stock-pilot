import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../../components/app-shell";
import { QuoteHeader } from "../../components/quote-header";
import { StockNav } from "../../components/stock-nav";
import stocks from "@/data/us-stocks.json";
import { normalizeTicker } from "@/lib/fmp";
import {
  FILING_TYPES,
  filingMatches,
  getFilings,
  isEarningsRelease,
  pressReleaseUrl,
  type Filing,
  type FilingType,
} from "@/lib/sec-filings";
import { getQuote } from "@/lib/stock-overview";

export const metadata: Metadata = {
  title: "SEC filings — StockPilot",
  description: "A company's annual and quarterly reports, earnings releases and other SEC filings.",
};

const PAGE_SIZE = 30;
// Press-release lookups per page shown, newest first: one small request each, cached for a month.
const PRESS_RELEASE_LOOKUPS = 8;

type FilingsPageProps = {
  searchParams: Promise<{ symbol?: string | string[]; type?: string | string[]; page?: string | string[] }>;
};

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function formatDate(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`));
}

function periodLabel(filing: Filing): string | null {
  if (!filing.period) return null;
  if (/^10-K|^20-F|^40-F/.test(filing.form)) return `Year ended ${formatDate(filing.period)}`;
  if (/^10-Q/.test(filing.form)) return `Quarter ended ${formatDate(filing.period)}`;
  if (filing.period !== filing.filed) return `Event on ${formatDate(filing.period)}`;
  return null;
}

function href(symbol: string, type: FilingType, page = 1): string {
  const params = new URLSearchParams({ symbol });
  if (type !== "important") params.set("type", type);
  if (page > 1) params.set("page", String(page));
  return `/stock/filings?${params}`;
}

export default async function FilingsPage({ searchParams }: FilingsPageProps) {
  const params = await searchParams;
  const symbol = normalizeTicker(single(params.symbol)) ?? "AAPL";
  const rawType = single(params.type);
  const type: FilingType = FILING_TYPES.some((item) => item.id === rawType) ? (rawType as FilingType) : "important";
  const page = Math.max(1, Number.parseInt(single(params.page) ?? "1", 10) || 1);

  const [quote, result] = await Promise.all([getQuote(symbol), getFilings(symbol)]);
  const listedName = (stocks as [string, string, number][]).find(([listed]) => listed === symbol)?.[1];

  const matching = result.ok ? result.data.filings.filter((filing) => filingMatches(filing, type)) : [];
  const shown = matching.slice(0, page * PAGE_SIZE);
  // Link earnings releases straight to the press release where it can be found.
  const releases = new Map(await Promise.all(
    shown.filter(isEarningsRelease).slice(0, PRESS_RELEASE_LOOKUPS * page).map(async (filing) => [filing.accession, await pressReleaseUrl(filing)] as const),
  ));

  return (
    <AppShell contentClassName="dashboard-content" tickerValue={symbol} headerLabel={`${symbol} filings`}>
      {quote.ok ? (
        <QuoteHeader quote={quote.data} currency="USD" />
      ) : (
        <section className="quote-header"><h1>{listedName ? `${listedName} (${symbol})` : symbol}</h1></section>
      )}
      <StockNav symbol={symbol} active="filings" />

      <div className="statement-toolbar">
        <nav className="statement-tabs filing-types" aria-label="Filing type">
          {FILING_TYPES.map((item) => (
            <Link
              key={item.id}
              href={href(symbol, item.id)}
              className={item.id === type ? "statement-tab-active" : ""}
              aria-current={item.id === type ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      {!result.ok ? (
        <section className="empty-state" role="status">
          <span className="empty-state-icon" aria-hidden="true">!</span>
          <div>
            <h2>We couldn&apos;t load the filings</h2>
            <p>
              {result.reason === "not-found"
                ? `${symbol} isn't in the SEC's list of filers. Companies listed only abroad, and most funds, don't file with the SEC.`
                : "The SEC's EDGAR service didn't respond. Try again in a moment."}
            </p>
          </div>
        </section>
      ) : matching.length === 0 ? (
        <section className="empty-state empty-state-info" role="status">
          <span className="empty-state-icon" aria-hidden="true">i</span>
          <div>
            <h2>No filings of this type</h2>
            <p>{result.data.name || symbol} has no filings of this type among its latest 1,000.</p>
          </div>
        </section>
      ) : (
        <>
          <p className="earnings-summary">
            {matching.length} {matching.length === 1 ? "filing" : "filings"} from {result.data.name || symbol}, newest first.
          </p>
          <div className="table-scroll">
            <table className="financial-table filings-table">
              <thead>
                <tr>
                  <th scope="col">Filed</th>
                  <th scope="col">Form</th>
                  <th scope="col">Description</th>
                  <th scope="col">Links</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((filing) => {
                  const period = periodLabel(filing);
                  const release = releases.get(filing.accession);
                  return (
                    <tr key={filing.accession}>
                      <th scope="row">{formatDate(filing.filed)}</th>
                      <td><span className={`filing-form${isEarningsRelease(filing) ? " filing-form-earnings" : ""}`}>{filing.form}</span></td>
                      <td>
                        <span className="filing-description">{filing.description}</span>
                        {period && <small>{period}</small>}
                      </td>
                      <td className="filing-links">
                        {release && <a href={release} target="_blank" rel="noreferrer">Press release</a>}
                        <a href={filing.documentUrl} target="_blank" rel="noreferrer">Document</a>
                        <a href={filing.indexUrl} target="_blank" rel="noreferrer">All files</a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {shown.length < matching.length && (
            <p className="filings-more">
              <Link href={href(symbol, type, page + 1)} scroll={false}>Show more filings</Link>
            </p>
          )}
        </>
      )}

      <p className="news-footnote">
        Filings from the SEC&apos;s EDGAR database, updated a few times a day. Links open the documents on sec.gov.
      </p>
    </AppShell>
  );
}
