import type { ReactNode } from "react";
import Link from "next/link";
import { normalizeTicker } from "@/lib/fmp";
import { providerFailureMessage } from "@/lib/fmp-messages";
import { listedName } from "@/lib/listed-companies";
import { PROJECTION_GUIDE, type ProjectionFit } from "@/lib/projection-fit";
import { STOCK_TYPES, type Classification } from "@/lib/valuation/classify";
import { valuationTool, type ValuationTool } from "./tools";

export type ValuationSearchParams = Promise<{ symbol?: string | string[] }>;

export async function readSymbol(searchParams: ValuationSearchParams): Promise<string | null> {
  const { symbol } = await searchParams;
  return typeof symbol === "string" ? normalizeTicker(symbol) : null;
}

export function ToolBreadcrumb({ symbol, tool }: { symbol: string; tool: ValuationTool }) {
  return (
    <div className="breadcrumb">
      <Link href={`/stock?symbol=${encodeURIComponent(symbol)}`}>{symbol}</Link><span>/</span><span>{valuationTool(tool).label}</span>
    </div>
  );
}

export function ToolHeading({ symbol, tool, children }: { symbol: string; tool: ValuationTool; children: ReactNode }) {
  return (
    <section className="company-heading">
      <div>
        <p className="section-label">{valuationTool(tool).label.toUpperCase()}</p>
        <div className="company-title-row">
          <h1>{listedName(symbol) ? `${listedName(symbol)} (${symbol})` : symbol}</h1>
        </div>
        <p className="company-subtitle">{children}</p>
      </div>
    </section>
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
