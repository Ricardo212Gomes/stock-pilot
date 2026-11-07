import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "../components/app-shell";
import { RecommendationsTable } from "./recommendations-table";
import { providerFailureMessage } from "@/lib/fmp-messages";
import { getRecommendationScreen } from "@/lib/recommendations";

export const metadata: Metadata = {
  title: "Recommendations — StockPilot",
  description: "Large US stocks trading below analysts' targets, rated Buy, and pulled back below their 12-week average.",
};

// The first load of the day fetches about 70 cached-for-a-day responses, so the table streams in after the heading.
async function Screen() {
  const result = await getRecommendationScreen();
  if (!result.ok) {
    return (
      <section className="empty-state" role="status">
        <span className="empty-state-icon" aria-hidden="true">!</span>
        <div>
          <h2>We couldn&apos;t run the screen</h2>
          <p>{providerFailureMessage(result.reason, "the analyst data")}</p>
        </div>
      </section>
    );
  }
  const { candidates, covered, universe, asOf } = result.data;
  return <RecommendationsTable candidates={candidates} covered={covered} universe={universe} asOf={asOf} />;
}

export default function RecommendationsPage() {
  return (
    <AppShell contentClassName="dashboard-content" activeSection="recommendations" dataSource="Analyst data from Financial Modeling Prep and Finnhub">
      <section className="company-heading">
        <div>
          <p className="section-label">WORKSPACE</p>
          <div className="company-title-row">
            <h1>Recommendations</h1>
          </div>
          <p className="company-subtitle">
            Large US stocks that analysts rate Buy, trading well below their price targets and pulled back under their
            12-week average, with the price trend around it.
          </p>
        </div>
      </section>
      <Suspense fallback={<p className="reco-loading" role="status">Screening the largest US companies…</p>}>
        <Screen />
      </Suspense>
    </AppShell>
  );
}
