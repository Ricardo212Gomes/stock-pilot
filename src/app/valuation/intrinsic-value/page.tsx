import { AppShell } from "../../components/app-shell";
import { companyMetadata } from "../../components/company-metadata";
import { providerFailureMessage } from "@/lib/fmp-messages";
import { listedName } from "@/lib/listed-companies";
import { loadProjectionData } from "../data";
import { ProjectionWorkbench } from "../projection-workbench";
import { LoadError, SecSourceNote, ToolBreadcrumb, ToolStart, readSymbol, type ValuationSearchParams } from "../valuation-parts";

export const generateMetadata = companyMetadata("Intrinsic Value", "Estimate a company's intrinsic value with DCF, dividend, earnings and residual income models.");

export default async function IntrinsicValuePage({ searchParams }: { searchParams: ValuationSearchParams }) {
  const symbol = await readSymbol(searchParams);
  const loaded = symbol ? await loadProjectionData(symbol) : null;

  return (
    <AppShell contentClassName="dashboard-content" tickerValue={symbol ?? ""} activeSection="intrinsic-value">
      {symbol && <ToolBreadcrumb symbol={symbol} tool="intrinsic-value" />}
      {!symbol || !loaded ? (
        <ToolStart tool="intrinsic-value" title="What is a company actually worth?">
          Search for a ticker above to estimate its intrinsic value: the price its future cash, earnings or
          dividends justify today. StockPilot picks the valuation models that suit the type of company,
          fills in assumptions from its filings, and explains every number along the way.
        </ToolStart>
      ) : !loaded.ok ? (
        <LoadError symbol={symbol} reason={loaded.reason} />
      ) : (
        <ProjectionWorkbench
          symbol={symbol}
          companyName={loaded.data.profile?.companyName ?? listedName(symbol)}
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
      {loaded?.ok && <SecSourceNote source={loaded.data.fundamentals.source} />}
    </AppShell>
  );
}
