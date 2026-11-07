import { redirect } from "next/navigation";
import { readSymbol, type ValuationSearchParams } from "../valuation-parts";

// The 3-Year Projection followed Jeremy Lefebvre's template, now Jeremy's Projection; keeps earlier links working.
export default async function ThreeYearProjectionPage({ searchParams }: { searchParams: ValuationSearchParams }) {
  const symbol = await readSymbol(searchParams);
  redirect(symbol ? `/valuation/jeremy-projection?symbol=${encodeURIComponent(symbol)}` : "/valuation/jeremy-projection");
}
