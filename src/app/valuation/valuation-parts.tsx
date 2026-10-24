import type { ReactNode } from "react";
import Link from "next/link";
import { normalizeTicker } from "@/lib/fmp";
import { providerFailureMessage } from "@/lib/fmp-messages";
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
          <h1>{symbol}</h1>
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
