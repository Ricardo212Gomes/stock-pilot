import { redirect } from "next/navigation";

type ProjectionsPageProps = {
  searchParams: Promise<{ symbol?: string | string[]; view?: string | string[] }>;
};

// The old Projections page, now split into the Valuation tools; keeps earlier links working.
export default async function ProjectionsPage({ searchParams }: ProjectionsPageProps) {
  const { symbol, view } = await searchParams;
  const path = view === "3y" ? "/valuation/three-year-projection" : view === "dcf" ? "/valuation/dcf-calculator" : "/valuation/intrinsic-value";
  redirect(typeof symbol === "string" && symbol ? `${path}?symbol=${encodeURIComponent(symbol)}` : path);
}
