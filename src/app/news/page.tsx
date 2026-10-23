import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { AppShell } from "../components/app-shell";
import { normalizeTicker } from "@/lib/fmp";
import {
  COMPANY_NEWS_DAYS,
  NEWS_CATEGORIES,
  getCompanyNews,
  getMarketNews,
  isNewsCategory,
  newsFailureMessage,
  paginate,
  type NewsCategory,
  type NewsItem,
} from "@/lib/finnhub-news";

export const metadata: Metadata = {
  title: "News — StockPilot",
  description: "Global market news and company headlines.",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

type NewsPageProps = {
  searchParams: Promise<{ symbol?: string | string[]; category?: string | string[]; page?: string | string[] }>;
};

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Rendered on the server, so times are shown in UTC rather than guessing the reader's zone.
function formatPublished(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const time = `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()} · ${time} UTC`;
}

// URLs count pages from 1, matching the "Page N of M" label; index 0 needs no parameter.
function pageHref(base: Record<string, string>, index: number): string {
  const params = new URLSearchParams(base);
  if (index > 0) params.set("page", String(index + 1));
  const query = params.toString();
  return query ? `/news?${query}` : "/news";
}

function NewsCard({ item, symbol }: { item: NewsItem; symbol: string | null }) {
  return (
    <article className="news-card">
      <div className="news-meta">
        {item.source && <span className="news-source">{item.source}</span>}
        <time dateTime={item.publishedAt}>{formatPublished(item.publishedAt)}</time>
      </div>
      <h2>
        {item.url ? (
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            {item.title} <span className="visually-hidden">(opens in a new tab)</span>
          </a>
        ) : item.title}
      </h2>
      {item.summary && <p>{item.summary}</p>}
      {item.tickers.length > 0 && (
        <ul className="news-tickers" aria-label="Companies mentioned">
          {item.tickers.map((ticker) => (
            <li key={ticker}>
              <Link
                href={`/news?symbol=${encodeURIComponent(ticker)}`}
                className={symbol && ticker === symbol.replace(/-/g, ".") ? "news-ticker-active" : ""}
              >
                {ticker}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <p className="news-notice" role="status">{children}</p>;
}

function NewsList({
  items,
  symbol,
  page,
  base,
  empty,
}: {
  items: NewsItem[];
  symbol: string | null;
  page: number;
  base: Record<string, string>;
  empty: ReactNode;
}) {
  if (items.length === 0) {
    return <section className="news-empty" role="status">{empty}</section>;
  }

  const current = paginate(items, page);
  return (
    <>
      <div className="news-list">
        {current.items.map((item) => <NewsCard key={item.id} item={item} symbol={symbol} />)}
      </div>
      {current.pageCount > 1 && (
        <nav className="news-pagination" aria-label="News pages">
          {current.page > 0 ? <Link href={pageHref(base, current.page - 1)}>← Newer</Link> : <span />}
          <span>Page {current.page + 1} of {current.pageCount}</span>
          {current.page < current.pageCount - 1 ? <Link href={pageHref(base, current.page + 1)}>Older →</Link> : <span />}
        </nav>
      )}
    </>
  );
}

function LoadError({ message }: { message: string }) {
  return (
    <section className="empty-state" role="status">
      <span className="empty-state-icon" aria-hidden="true">!</span>
      <div>
        <h2>We couldn&apos;t load the news</h2>
        <p>{message}</p>
      </div>
    </section>
  );
}

async function CompanyNews({ symbol, page }: { symbol: string; page: number }) {
  const result = await getCompanyNews(symbol);
  if (!result.ok) return <LoadError message={newsFailureMessage(result.reason, `news for ${symbol}`)} />;

  return (
    <NewsList
      items={result.items}
      symbol={symbol}
      page={page}
      base={{ symbol }}
      empty={(
        <>
          <h2>No recent news for {symbol}</h2>
          <p>
            Finnhub has no headlines for {symbol} from the last {COMPANY_NEWS_DAYS} days. Company news covers listed
            companies, so check the ticker. <Link href="/news">Browse market news</Link>.
          </p>
        </>
      )}
    />
  );
}

async function MarketNews({ category, page }: { category: NewsCategory; page: number }) {
  const result = await getMarketNews(category);
  const label = NEWS_CATEGORIES.find((option) => option.id === category)?.label ?? "Markets";

  return (
    <>
      <nav className="news-categories" aria-label="News categories">
        {NEWS_CATEGORIES.map((option) => (
          <Link
            key={option.id}
            href={option.id === "general" ? "/news" : `/news?category=${option.id}`}
            className={option.id === category ? "news-category-active" : ""}
            aria-current={option.id === category ? "page" : undefined}
          >
            {option.label}
          </Link>
        ))}
      </nav>
      {result.ok ? (
        <NewsList
          items={result.items}
          symbol={null}
          page={page}
          base={category === "general" ? {} : { category }}
          empty={(
            <>
              <h2>No {label.toLowerCase()} news right now</h2>
              <p>Finnhub has no recent headlines in this category. <Link href="/news">Back to market news</Link>.</p>
            </>
          )}
        />
      ) : (
        <LoadError message={newsFailureMessage(result.reason, `${label.toLowerCase()} news`)} />
      )}
    </>
  );
}

export default async function NewsPage({ searchParams }: NewsPageProps) {
  const params = await searchParams;
  const rawSymbol = single(params.symbol);
  const symbol = rawSymbol ? normalizeTicker(rawSymbol) : null;
  const rawCategory = single(params.category);
  const category: NewsCategory = isNewsCategory(rawCategory) ? rawCategory : "general";
  const rawPage = Number(single(params.page));
  const page = Number.isInteger(rawPage) && rawPage > 1 ? rawPage - 1 : 0;

  return (
    <AppShell contentClassName="dashboard-content" tickerValue={symbol ?? ""} activeSection="news">
      <section className="company-heading">
        <div>
          <p className="section-label">{symbol ? "COMPANY NEWS" : "GLOBAL NEWS"}</p>
          <div className="company-title-row">
            <h1>{symbol ? `${symbol} news` : "Market news"}</h1>
          </div>
          <p className="company-subtitle">
            {symbol
              ? `Headlines mentioning ${symbol} from the last ${COMPANY_NEWS_DAYS} days.`
              : "Global business, markets, deals, currency and crypto headlines. Search a ticker for company news."}
          </p>
        </div>
        {symbol && (
          <nav className="news-company-links" aria-label={`More on ${symbol}`}>
            <Link href={`/stock?symbol=${symbol}`}>Fundamentals</Link>
            <Link href={`/projections?symbol=${symbol}`}>Projections</Link>
            <Link href="/news">All news</Link>
          </nav>
        )}
      </section>

      {rawSymbol && !symbol && <Notice>That isn&apos;t a valid ticker, so this shows market news.</Notice>}
      {symbol ? <CompanyNews symbol={symbol} page={page} /> : <MarketNews category={category} page={page} />}

      <p className="news-footnote">
        News from Finnhub and its publishers. Articles open on the publisher&apos;s site. Times are in UTC. News is not investment advice.
      </p>
    </AppShell>
  );
}
