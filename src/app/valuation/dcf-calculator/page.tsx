import { redirect } from "next/navigation";

type DcfCalculatorPageProps = {
  searchParams: Promise<{ symbol?: string | string[] }>;
};

// The DCF Calculator is now the Intrinsic Value page's Detailed DCF; earlier links open it there.
export default async function DcfCalculatorPage({ searchParams }: DcfCalculatorPageProps) {
  const { symbol } = await searchParams;
  const query = typeof symbol === "string" && symbol ? `symbol=${encodeURIComponent(symbol)}&model=dcf` : "model=dcf";
  redirect(`/valuation/intrinsic-value?${query}#detailed-dcf`);
}
