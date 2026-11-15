// Stores the market valuation series (docs/market-valuation.md), run daily by .github/workflows/market-valuation.yml:
//   npm run market-valuation:update              — fetch Shiller, Siblis and FRED, store every series, and write the
//                                                  AI summaries when a new month's data has arrived
//   npm run market-valuation:update -- --dry-run — fetch and print what would be stored, without the database
// A source that fails leaves its stored rows as they are; the job fails only when every source does.
import { closeDb, isDatabaseConfigured } from "@/lib/db";
import { geminiModel, isGeminiConfigured } from "@/lib/gemini";
import { loadSeries, loadSummaries, storeSeries, storeSummary, summaryFacts } from "@/lib/market-valuation";
import { writeValuationSummary } from "@/lib/market-valuation-summary";
import { SOURCE_FETCHERS, type SourceId, type SourceSeries } from "@/lib/market-valuation-sources";

async function fetchAll(): Promise<{ series: SourceSeries[]; failed: SourceId[] }> {
  const series: SourceSeries[] = [];
  const failed: SourceId[] = [];
  for (const [id, fetcher] of Object.entries(SOURCE_FETCHERS) as [SourceId, () => Promise<SourceSeries[]>][]) {
    try {
      const fetched = await fetcher();
      series.push(...fetched);
      const points = fetched.reduce((total, item) => total + item.points.length, 0);
      console.log(`${id}: ${fetched.length} series, ${points} points.`);
    } catch (error) {
      failed.push(id);
      console.error(`${id} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { series, failed };
}

function describe(series: SourceSeries[]) {
  for (const item of series) {
    const first = item.points[0];
    const last = item.points.at(-1);
    if (!first || !last) continue;
    console.log(`  ${item.index}/${item.metric} (${item.source}): ${item.points.length} from ${first.date}, latest ${last.value} on ${last.date}${last.provisional ? " (provisional)" : ""}`);
  }
}

async function main(): Promise<number> {
  const dryRun = process.argv.includes("--dry-run");
  if (!dryRun && !isDatabaseConfigured()) {
    console.error("Set DATABASE_URL first (see docs/market-valuation.md).");
    return 1;
  }
  const { series, failed } = await fetchAll();
  if (failed.length === Object.keys(SOURCE_FETCHERS).length) return 1;
  if (dryRun) {
    describe(series);
    return 0;
  }

  try {
    const written = await storeSeries(series);
    console.log(`Stored ${written} points.`);

    if (!isGeminiConfigured()) {
      console.log("GEMINI_API_KEY isn't set, so the AI summaries were skipped.");
    } else {
      const [stored, summaries] = await Promise.all([loadSeries(), loadSummaries()]);
      for (const index of ["sp500", "ndx"] as const) {
        const { facts, basis } = summaryFacts(stored, index);
        if (facts.length === 0) continue;
        if (summaries[index]?.basis === basis && !process.argv.includes("--force-summary")) {
          console.log(`${index}: the AI summary is up to date.`);
          continue;
        }
        const result = await writeValuationSummary(index, facts);
        if (result.ok) {
          await storeSummary({ index, text: result.text, model: geminiModel(), basis });
          console.log(`${index}: wrote the AI summary.`);
        } else {
          console.error(`${index}: the AI summary failed: ${result.error}`);
        }
      }
    }
    return failed.length > 0 ? 1 : 0;
  } finally {
    await closeDb();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
