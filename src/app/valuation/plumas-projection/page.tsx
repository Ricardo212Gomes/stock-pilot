import { AppShell } from "../../components/app-shell";
import { companyMetadata } from "../../components/company-metadata";
import { loadPriceProjectionData } from "../data";
import { PlumasProjection } from "../plumas-projection";
import { LoadError, ProjectionFitCard, SecSourceNote, ToolStart, ValuationHeader, readSymbol, type ValuationSearchParams } from "../valuation-parts";

export const generateMetadata = companyMetadata("Plumas Projection", "Project a stock's revenue, margins, EPS, price and yearly return five years out, from the last report, in bear, base and bull scenarios.");

export default async function PlumasProjectionPage({ searchParams }: { searchParams: ValuationSearchParams }) {
  const symbol = await readSymbol(searchParams);
  const loaded = symbol ? await loadPriceProjectionData(symbol) : null;

  return (
    <AppShell contentClassName="dashboard-content" tickerValue={symbol ?? ""} activeSection="plumas-projection">
      {!symbol || !loaded ? (
        <ToolStart tool="plumas-projection" title="Where could the business and the price be in five years?">
          Search for a ticker above to project its revenue, margins, earnings per share and share price five years
          past the last report, year by year, in bear, base and bull scenarios, with the yearly return from today&apos;s
          price. Best for mature, dividend, buyback, cyclical and loss-making companies.
        </ToolStart>
      ) : (
        <>
          <ValuationHeader symbol={symbol} tool="plumas-projection">
            Five years of revenue, earnings and share price from the last fiscal year, in bear, base and bull scenarios.
          </ValuationHeader>
          {!loaded.ok ? (
            <LoadError symbol={symbol} reason={loaded.reason} />
          ) : (
            <>
              <ProjectionFitCard symbol={symbol} current="plumas-projection" fit={loaded.data.fit} classification={loaded.data.classification} />
              <PlumasProjection symbol={symbol} defaults={loaded.data.plumas} />
              <SecSourceNote source={loaded.data.income.source} />
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
