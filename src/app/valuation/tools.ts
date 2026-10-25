export type ValuationTool = "intrinsic-value" | "three-year-projection" | "dcf-calculator";

// The Valuation section of the sidebar, in order.
export const VALUATION_TOOLS: { id: ValuationTool; label: string; path: string }[] = [
  { id: "intrinsic-value", label: "Intrinsic Value", path: "/valuation/intrinsic-value" },
  { id: "three-year-projection", label: "3-Year Projection", path: "/valuation/three-year-projection" },
  { id: "dcf-calculator", label: "DCF Calculator", path: "/valuation/dcf-calculator" },
];

export function valuationTool(id: ValuationTool) {
  return VALUATION_TOOLS.find((tool) => tool.id === id)!;
}
