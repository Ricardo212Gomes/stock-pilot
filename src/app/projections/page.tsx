import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../components/app-shell";
import { normalizeTicker } from "@/lib/fmp";
import { providerFailureMessage } from "@/lib/fmp-messages";
import { loadProjectionData } from "./data";
import { ProjectionWorkbench } from "./projection-workbench";

export const metadata: Metadata = {
  title: "Stock projections — StockPilot",
  description: "Estimate a company's intrinsic value with DCF, dividend, earnings and residual income models.",
};

type ProjectionsPageProps = {
  searchParams: Promise<{ symbol?: string | string[] }>;
};

export default async function ProjectionsPage({ searchParams }: ProjectionsPageProps) {
  const params = await searchParams;
  const rawSymbol = Array.isArray(params.symbol) ? null : params.symbol;
  const symbol = rawSymbol ? normalizeTicker(rawSymbol) : null;
  const loaded = symbol ? await loadProjectionData(symbol) : null;

  return (
    <AppShell contentClassName="dashboard-content" tickerValue={symbol ?? ""} activeSection="projections">
      {symbol && (
        <div className="breadcrumb">
          <Link href={`/stock?symbol=${symbol}`}>{symbol}</Link><span>/</span><span>Projections</span>
        </div>
      )}

      {!symbol || !loaded ? (
        <section className="projection-start">
          <p className="section-label">STOCK PROJECTIONS</p>
          <h1>What is a company actually worth?</h1>
          <p>
            Search for a ticker above to estimate its intrinsic value: the price its future cash, earnings or
            dividends justify today. StockPilot picks the valuation models that suit the type of company,
            fills in assumptions from its filings, and explains every number along the way.
          </p>
        </section>
      ) : !loaded.ok ? (
        <section className="empty-state" role="status">
          <span className="empty-state-icon" aria-hidden="true">!</span>
          <div>
            <h2>We couldn&apos;t load this company</h2>
            <p>
              {loaded.reason === "no-data"
                ? `No annual financial statements were found for ${symbol}. Check the ticker or your FMP plan access.`
                : providerFailureMessage(loaded.reason, "the financial statements")}
            </p>
          </div>
        </section>
      ) : (
        <ProjectionWorkbench
          symbol={symbol}
          companyName={loaded.data.profile?.companyName ?? null}
          currency={loaded.data.fundamentals.annualFinancials[0]?.currency ?? loaded.data.profile?.currency ?? "USD"}
          classification={loaded.data.classification}
          defaults={loaded.data.defaults}
          priceNotice={
            loaded.data.profileFailure
              ? providerFailureMessage(loaded.data.profileFailure, "the latest quote")
              : null
          }
        />
      )}
    </AppShell>
  );
}
