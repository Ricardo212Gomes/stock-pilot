import { redirect } from "next/navigation";
import { readSymbol, type ValuationSearchParams } from "../valuation-parts";

// Financial Projections became the Plumas Projection; keeps earlier links working.
export default async function FinancialProjectionsPage({ searchParams }: { searchParams: ValuationSearchParams }) {
  const symbol = await readSymbol(searchParams);
  redirect(symbol ? `/valuation/plumas-projection?symbol=${encodeURIComponent(symbol)}` : "/valuation/plumas-projection");
}
