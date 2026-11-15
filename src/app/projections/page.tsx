import { redirect } from "next/navigation";

type ProjectionsPageProps = {
  searchParams: Promise<{ symbol?: string | string[]; view?: string | string[] }>;
};

// The old Projections page, now split into the Valuation tools; keeps earlier links working.
export default async function ProjectionsPage({ searchParams }: ProjectionsPageProps) {
  const { symbol, view } = await searchParams;
  const path = view === "3y" ? "/valuation/jeremy-projection" : "/valuation/intrinsic-value";
  const query = [
    typeof symbol === "string" && symbol ? `symbol=${encodeURIComponent(symbol)}` : "",
    // The DCF Calculator is now the Intrinsic Value page's Detailed DCF.
    view === "dcf" ? "model=dcf" : "",
  ].filter(Boolean).join("&");
  redirect(`${path}${query ? `?${query}` : ""}${view === "dcf" ? "#detailed-dcf" : ""}`);
}
