import Link from "next/link";
import type { SavedTool } from "@/lib/saved-projection-inputs";
import type { SavingContext } from "./saved-data";
import { SavedProjectionsTable, withPricesNow } from "./saved-table";
import { valuationTool } from "./tools";

// On each valuation tool, above it: this company's saved projections in this tool, folded away until wanted.
export async function SavedSection({ symbol, tool, saving }: { symbol: string; tool: SavedTool; saving: SavingContext }) {
  if (saving.status !== "ready" && !saving.openError) return null;
  const draftHref = `${valuationTool(tool).path}?symbol=${encodeURIComponent(symbol)}`;
  const rows = await withPricesNow(saving.list);

  return (
    <>
      {saving.openError && (
        <p className="projection-notice saved-open-error" role="alert">
          {saving.openError} <Link href={draftHref}>Back to your draft</Link>
        </p>
      )}
      {saving.status === "ready" && (saving.list.length > 0 || saving.listError) && (
        <details className="saved-section" open={saving.opened !== null}>
          <summary>
            <span className="section-label">SAVED</span>
            <span className="saved-section-title">
              Your {valuationTool(tool).label} projections of {symbol} <small>({saving.list.length})</small>
            </span>
          </summary>
          {saving.listError ? (
            <p className="projection-notice">Your saved projections couldn&apos;t be loaded. Check the database connection.</p>
          ) : (
            <>
              <SavedProjectionsTable rows={rows} showCompany={false} openedId={saving.opened?.id ?? null} closeHref={draftHref} />
              <p className="table-footnote">
                Open one to pick up where you left off; your unsaved draft in this browser stays as it is.
                The gap is the value saved then against today&apos;s price. <Link href="/valuation/saved">All saved projections →</Link>
              </p>
            </>
          )}
        </details>
      )}
    </>
  );
}
