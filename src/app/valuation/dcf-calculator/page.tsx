import { AppShell } from "../../components/app-shell";
import { companyMetadata } from "../../components/company-metadata";
import { loadDcfData } from "../data";
import { DcfCalculator } from "../dcf-calculator";
import { LoadError, SecSourceNote, ToolStart, ValuationHeader, readSymbol, type ValuationSearchParams } from "../valuation-parts";

export const generateMetadata = companyMetadata("DCF Calculator", "Discount ten years of free cash flow plus a terminal value to a value per share.");

export default async function DcfCalculatorPage({ searchParams }: { searchParams: ValuationSearchParams }) {
  const symbol = await readSymbol(searchParams);
  const loaded = symbol ? await loadDcfData(symbol) : null;

  return (
    <AppShell contentClassName="dashboard-content" tickerValue={symbol ?? ""} activeSection="dcf-calculator">
      {!symbol || !loaded ? (
        <ToolStart tool="dcf-calculator" title="What are its future cash flows worth today?">
          Search for a ticker above to discount ten years of free cash flow, plus a terminal value, to a value per
          share, and compare it with today&apos;s price.
        </ToolStart>
      ) : (
        <>
          <ValuationHeader symbol={symbol} tool="dcf-calculator">
            Ten years of free cash flow and a terminal value, discounted to a value per share.
          </ValuationHeader>
          {!loaded.ok ? (
            <LoadError symbol={symbol} reason={loaded.reason} />
          ) : (
            <>
              <DcfCalculator symbol={symbol} defaults={loaded.data.defaults} />
              <SecSourceNote source={loaded.data.income.source} />
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
