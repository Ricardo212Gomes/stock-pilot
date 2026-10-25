import { AppShell } from "../../components/app-shell";
import { companyMetadata } from "../../components/company-metadata";
import { loadThreeYearData } from "../data";
import { ThreeYearCalculator } from "../three-year-calculator";
import { LoadError, SecSourceNote, ToolBreadcrumb, ToolHeading, ToolStart, readSymbol, type ValuationSearchParams } from "../valuation-parts";

export const generateMetadata = companyMetadata("3-Year Projection", "Project a stock's price and yearly return in five scenarios from revenue growth, net income growth and P/E.");

export default async function ThreeYearProjectionPage({ searchParams }: { searchParams: ValuationSearchParams }) {
  const symbol = await readSymbol(searchParams);
  const loaded = symbol ? await loadThreeYearData(symbol) : null;

  return (
    <AppShell contentClassName="dashboard-content" tickerValue={symbol ?? ""} activeSection="three-year-projection">
      {!symbol || !loaded ? (
        <ToolStart tool="three-year-projection" title="What could a stock return?">
          Search for a ticker above to project its price five years out, in five scenarios from ultra bearish to
          ultra bullish. Revenue and net income each grow at their own rate, and the price comes from a low and a
          high P/E, following Jeremy Lefebvre&apos;s (1000xStocks) projection template.
        </ToolStart>
      ) : (
        <>
          <ToolBreadcrumb symbol={symbol} tool="three-year-projection" />
          <ToolHeading symbol={symbol} tool="three-year-projection">
            Price and yearly return in five scenarios, from the last fiscal year&apos;s revenue and net income.
          </ToolHeading>
          {!loaded.ok ? (
            <LoadError symbol={symbol} reason={loaded.reason} />
          ) : (
            <>
              <ThreeYearCalculator symbol={symbol} defaults={loaded.data.defaults} />
              <SecSourceNote source={loaded.data.income.source} />
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
