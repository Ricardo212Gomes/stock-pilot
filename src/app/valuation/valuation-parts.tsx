import type { ReactNode } from "react";
import Link from "next/link";
import { normalizeTicker } from "@/lib/fmp";
import { providerFailureMessage } from "@/lib/fmp-messages";
import { getHeaderQuote } from "@/lib/stock-overview";
import { PROJECTION_GUIDE, type ProjectionFit } from "@/lib/projection-fit";
import { STOCK_TYPES, type Classification } from "@/lib/valuation/classify";
import { CompanyHeader } from "../components/company-header";
import { StockNav } from "../components/stock-nav";
import { VALUATION_TOOLS, valuationTool, type ValuationTool } from "./tools";

export type ValuationSearchParams = Promise<{ symbol?: string | string[] }>;

export async function readSymbol(searchParams: ValuationSearchParams): Promise<string | null> {
  const { symbol } = await searchParams;
  return typeof symbol === "string" ? normalizeTicker(symbol) : null;
}

// Above every valuation tool for a company: its header and tabs, with Valuation open and the four
// tools as its sub-tabs, then what this tool does.
export async function ValuationHeader({ symbol, tool, children }: { symbol: string; tool: ValuationTool; children: ReactNode }) {
  const quote = await getHeaderQuote(symbol);
  return (
    <>
      <CompanyHeader symbol={symbol} quote={quote} />
      <StockNav symbol={symbol} active="valuation" />
      <div className="statement-toolbar">
        <nav className="statement-tabs" aria-label="Valuation tools">
          {VALUATION_TOOLS.map((item) => (
            <Link
              key={item.id}
              href={`${item.path}?symbol=${encodeURIComponent(symbol)}`}
              className={item.id === tool ? "statement-tab-active" : ""}
              aria-current={item.id === tool ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <p className="valuation-tool-intro">{children}</p>
    </>
  );
}

// Shown before a ticker is chosen.
export function ToolStart({ tool, title, children }: { tool: ValuationTool; title: string; children: ReactNode }) {
  return (
    <section className="projection-start">
      <p className="section-label">{valuationTool(tool).label.toUpperCase()}</p>
      <h1>{title}</h1>
      <p>{children}</p>
    </section>
  );
}

// Shown when the statements came from SEC filings instead of FMP.
export function SecSourceNote({ source }: { source: "fmp" | "sec" }) {
  if (source !== "sec") return null;
  return (
    <p className="news-footnote">
      FMP couldn&apos;t provide this company (its free plan doesn&apos;t cover every company and has a daily limit), so
      the figures come from its SEC filings and the quote from Finnhub.
    </p>
  );
}

export function LoadError({ symbol, reason }: { symbol: string; reason: Parameters<typeof providerFailureMessage>[0] | "no-data" }) {
  return (
    <section className="empty-state" role="status">
      <span className="empty-state-icon" aria-hidden="true">!</span>
      <div>
        <h2>We couldn&apos;t load this company</h2>
        <p>
          {reason === "no-data"
            ? `No annual financial statements were found for ${symbol}. Check the ticker or your FMP plan access.`
            : providerFailureMessage(reason, "the financial statements")}
        </p>
      </div>
    </section>
  );
}

// Which of the two projections suits the company, and what each is best for.
export function ProjectionFitCard({
  symbol,
  current,
  fit,
  classification,
}: {
  symbol: string;
  current: ValuationTool;
  fit: ProjectionFit;
  classification: Classification;
}) {
  const best = valuationTool(fit.tool);
  return (
    <section className="projection-fit" aria-labelledby="projection-fit-heading">
      <div className="projection-fit-verdict">
        <p className="section-label" id="projection-fit-heading">WHICH PROJECTION FITS {symbol}?</p>
        <p className="projection-fit-answer">
          <span className="model-role model-role-primary">Best fit</span>
          <strong>{best.label}</strong>
          {fit.tool === current
            ? <span className="projection-fit-here">This page</span>
            : <Link href={`${best.path}?symbol=${encodeURIComponent(symbol)}`}>Open {best.label} →</Link>}
        </p>
        <p className="projection-fit-reason">
          <strong>{STOCK_TYPES[classification.type].label}.</strong> {classification.reasons[0]} {fit.reason}
        </p>
      </div>
      <dl className="projection-fit-guide">
        {(Object.keys(PROJECTION_GUIDE) as (keyof typeof PROJECTION_GUIDE)[]).map((tool) => (
          <div key={tool} className={tool === fit.tool ? "projection-fit-match" : undefined}>
            <dt>
              {tool === current ? valuationTool(tool).label : <Link href={`${valuationTool(tool).path}?symbol=${encodeURIComponent(symbol)}`}>{valuationTool(tool).label}</Link>}
            </dt>
            <dd><strong>Best for {PROJECTION_GUIDE[tool].bestFor.toLowerCase()}.</strong> {PROJECTION_GUIDE[tool].how}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
