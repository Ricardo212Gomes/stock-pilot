import { AppShell } from "../../components/app-shell";
import { companyMetadata } from "../../components/company-metadata";
import { loadPriceProjectionData } from "../data";
import { loadSaving } from "../saved-data";
import { SavedSection } from "../saved-section";
import { JeremyProjection } from "../jeremy-projection";
import { LoadError, ProjectionFitCard, SecSourceNote, ToolStart, ValuationHeader, readSymbol, type ValuationSearchParams } from "../valuation-parts";

export const generateMetadata = companyMetadata("Jeremy's Projection", "Bull, base and bear cases for a stock's revenue, net income, EPS, price and yearly return, from this year's analyst consensus.");

export default async function JeremyProjectionPage({ searchParams }: { searchParams: ValuationSearchParams }) {
  const symbol = await readSymbol(searchParams);
  const [loaded, saving] = symbol
    ? await Promise.all([loadPriceProjectionData(symbol), loadSaving(symbol, "jeremy-projection", (await searchParams).saved)])
    : [null, null];

  return (
    <AppShell contentClassName="dashboard-content" tickerValue={symbol ?? ""} activeSection="jeremy-projection">
      {!symbol || !loaded ? (
        <ToolStart tool="jeremy-projection" title="What could a growth stock return?">
          Search for a ticker above for bull, base and bear cases over this fiscal year and the four after it, starting
          from analysts&apos; consensus: revenue and net income growth, EPS, a P/E range, the share price and the yearly
          return, following Jeremy Lefebvre&apos;s (1000xStocks) projection. Best for growth stocks.
        </ToolStart>
      ) : (
        <>
          <ValuationHeader symbol={symbol} tool="jeremy-projection">
            Bull, base and bear cases from this year&apos;s analyst consensus, following Jeremy Lefebvre&apos;s (1000xStocks) projection.
          </ValuationHeader>
          {!loaded.ok ? (
            <LoadError symbol={symbol} reason={loaded.reason} />
          ) : (
            <>
              <ProjectionFitCard symbol={symbol} current="jeremy-projection" fit={loaded.data.fit} classification={loaded.data.classification} />
              {saving && <SavedSection symbol={symbol} tool="jeremy-projection" saving={saving} />}
              <JeremyProjection
                key={saving?.opened?.id ?? "draft"}
                symbol={symbol}
                defaults={loaded.data.jeremy}
                saving={{ status: saving?.status ?? "unavailable", opened: saving?.opened ?? null }}
              />
              <SecSourceNote source={loaded.data.income.source} />
            </>
          )}
        </>
      )}
    </AppShell>
  );
}
