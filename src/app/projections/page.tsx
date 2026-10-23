import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../components/app-shell";
import { StockNav } from "../components/stock-nav";
import { normalizeTicker } from "@/lib/fmp";
import { providerFailureMessage } from "@/lib/fmp-messages";
import { loadDcfData, loadProjectionData, loadThreeYearData } from "./data";
import { DcfCalculator } from "./dcf-calculator";
import { ProjectionWorkbench } from "./projection-workbench";
import { ThreeYearCalculator } from "./three-year-calculator";

export const metadata: Metadata = {
  title: "Stock projections — StockPilot",
  description: "Estimate a company's intrinsic value with DCF, dividend, earnings and residual income models.",
};

type ProjectionsPageProps = {
  searchParams: Promise<{ symbol?: string | string[]; view?: string | string[] }>;
};

type ProjectionView = "intrinsic" | "3y" | "dcf";

const VIEWS: { id: ProjectionView; label: string }[] = [
  { id: "intrinsic", label: "Intrinsic value" },
  { id: "3y", label: "3-Year Projection" },
  { id: "dcf", label: "DCF Calculator" },
];

function isProjectionView(value: unknown): value is ProjectionView {
  return VIEWS.some((view) => view.id === value);
}

function viewHref(symbol: string, view: ProjectionView): string {
  return view === "intrinsic" ? `/projections?symbol=${symbol}` : `/projections?symbol=${symbol}&view=${view}`;
}

function LoadError({ symbol, reason }: { symbol: string; reason: Parameters<typeof providerFailureMessage>[0] | "no-data" }) {
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

export default async function ProjectionsPage({ searchParams }: ProjectionsPageProps) {
  const params = await searchParams;
  const rawSymbol = Array.isArray(params.symbol) ? null : params.symbol;
  const symbol = rawSymbol ? normalizeTicker(rawSymbol) : null;
  const rawView = Array.isArray(params.view) ? params.view[0] : params.view;
  const view: ProjectionView = isProjectionView(rawView) ? rawView : "intrinsic";
  // Each tab loads only its own data.
  const [loaded, threeYear, dcf] = await Promise.all([
    symbol && view === "intrinsic" ? loadProjectionData(symbol) : null,
    symbol && view === "3y" ? loadThreeYearData(symbol) : null,
    symbol && view === "dcf" ? loadDcfData(symbol) : null,
  ]);

  return (
    <AppShell contentClassName="dashboard-content" tickerValue={symbol ?? ""} activeSection="projections">
      {symbol && (
        <div className="breadcrumb">
          <Link href={`/stock?symbol=${symbol}`}>{symbol}</Link><span>/</span><span>Projections</span>
        </div>
      )}
      {symbol && <StockNav symbol={symbol} active="projections" />}
      {symbol && (
        <nav className="statement-tabs projection-tabs" aria-label="Projection types">
          {VIEWS.map((item) => (
            <Link
              key={item.id}
              href={viewHref(symbol, item.id)}
              className={item.id === view ? "statement-tab-active" : ""}
              aria-current={item.id === view ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}

      {symbol && view === "dcf" ? (
        !dcf ? null : !dcf.ok ? (
          <LoadError symbol={symbol} reason={dcf.reason} />
        ) : (
          <DcfCalculator symbol={symbol} defaults={dcf.data.defaults} />
        )
      ) : symbol && view === "3y" ? (
        !threeYear ? null : !threeYear.ok ? (
          <LoadError symbol={symbol} reason={threeYear.reason} />
        ) : (
          <ThreeYearCalculator symbol={symbol} defaults={threeYear.data.defaults} />
        )
      ) : !symbol || !loaded ? (
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
        <LoadError symbol={symbol} reason={loaded.reason} />
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
