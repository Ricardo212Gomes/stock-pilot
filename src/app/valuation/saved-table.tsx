import Link from "next/link";
import { headlineValue, valueGap, type SavedValue } from "@/lib/saved-projection-inputs";
import type { SavedProjectionSummary } from "@/lib/saved-projections";
import { formatMoney, formatSignedPercent } from "@/lib/valuation/format";
import { getHeaderQuote } from "@/lib/stock-overview";
import { CompanyLogo } from "../components/company-logo";
import { SavedRowActions } from "./saved-row-actions";
import { valuationTool } from "./tools";

export type SavedRow = SavedProjectionSummary & { priceNow: number | null; gap: number | null };

// Today's price for each company in the list (one cached quote each) and the gap from the value saved then.
export async function withPricesNow(list: SavedProjectionSummary[]): Promise<SavedRow[]> {
  const symbols = [...new Set(list.map(({ symbol }) => symbol))];
  const quotes = await Promise.all(symbols.map((symbol) => getHeaderQuote(symbol)));
  const prices = new Map(symbols.map((symbol, index) => {
    const quote = quotes[index];
    return [symbol, quote.ok ? quote.data.price : null] as const;
  }));
  return list.map((saved) => {
    const priceNow = prices.get(saved.symbol) ?? null;
    return { ...saved, priceNow, gap: valueGap(headlineValue(saved.valueAtSave)?.value ?? null, priceNow) };
  });
}

export function savedHref(saved: Pick<SavedProjectionSummary, "tool" | "symbol" | "id">): string {
  return `${valuationTool(saved.tool).path}?symbol=${encodeURIComponent(saved.symbol)}&saved=${saved.id}`;
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

// The other scenarios' values, under the headline one, e.g. "Bear $80 · Bull $160".
function otherValues(values: SavedValue[], headline: SavedValue | null, currency: string): string | null {
  // Intrinsic Value's model values stay on its page; the list shows the blended value alone.
  if (headline?.id === "blended") return null;
  const others = values.filter((value) => value !== headline && value.value !== null);
  if (others.length === 0 || others.length > 5) return null;
  return others.map(({ label, value }) => `${label.replace(/ case$/, "")} ${formatMoney(value, currency)}`).join(" · ");
}

export function SavedProjectionsTable({
  rows,
  showCompany,
  openedId = null,
  closeHref = null,
}: {
  rows: SavedRow[];
  // On the All saved page: the company and tool of each row.
  showCompany: boolean;
  openedId?: string | null;
  // Where to go when the open projection is deleted.
  closeHref?: string | null;
}) {
  return (
    <div className="table-scroll">
      <table className="financial-table saved-table">
        <thead>
          <tr>
            {showCompany && <th scope="col" className="saved-left">Company</th>}
            <th scope="col" className="saved-left">Name</th>
            <th scope="col" className="saved-optional">Saved</th>
            <th scope="col" title="The value per share when it was saved: the blended value, or the base scenario's price target">Value then</th>
            <th scope="col" className="saved-optional">Price at save</th>
            <th scope="col">Price now</th>
            <th scope="col" title="Value then ÷ price now − 1: above zero, the saved value is above today's price">Gap</th>
            <th scope="col"><span className="visually-hidden">Rename or delete</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const headline = headlineValue(row.valueAtSave);
            const others = otherValues(row.valueAtSave, headline, row.currency);
            const isOpen = row.id === openedId;
            return (
              <tr key={row.id} className={isOpen ? "saved-row-open" : undefined}>
                {showCompany && (
                  <td className="saved-left">
                    <Link className="favorites-company" href={`/stock?symbol=${encodeURIComponent(row.symbol)}`}>
                      <span className="earnings-logo-box"><CompanyLogo symbol={row.symbol} /></span>
                      <span>
                        <strong>{row.symbol}</strong>
                        <small>{valuationTool(row.tool).label}</small>
                      </span>
                    </Link>
                  </td>
                )}
                <th scope="row" className="saved-name">
                  {isOpen ? <strong>{row.name}</strong> : <Link href={savedHref(row)}>{row.name}</Link>}
                  {isOpen && <span className="saved-open-badge">Open</span>}
                  {row.note && <small className="saved-note">{row.note}</small>}
                  {row.baseYear !== null && <small className="saved-meta">From fiscal {row.baseYear}</small>}
                </th>
                <td className="saved-optional">
                  <time dateTime={row.updatedAt}>{DATE.format(new Date(row.updatedAt))}</time>
                </td>
                <td>
                  {formatMoney(headline?.value ?? null, row.currency)}
                  {headline && headline.id !== "blended" && row.valueAtSave.length > 1 && <small className="saved-meta">{headline.label.replace(/ case$/, "")}</small>}
                  {others && <small className="saved-meta saved-optional">{others}</small>}
                </td>
                <td className="saved-optional">{formatMoney(row.priceAtSave, row.currency)}</td>
                <td>{formatMoney(row.priceNow, row.currency)}</td>
                <td className={row.gap === null ? "" : row.gap >= 0 ? "positive-value" : "negative-value"}>{formatSignedPercent(row.gap)}</td>
                <td><SavedRowActions id={row.id} name={row.name} closeHref={isOpen ? closeHref : null} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
