export type ValuationTool = "intrinsic-value" | "jeremy-projection" | "plumas-projection";

// The Valuation section of the sidebar, in order.
export const VALUATION_TOOLS: { id: ValuationTool; label: string; path: string }[] = [
  { id: "intrinsic-value", label: "Intrinsic Value", path: "/valuation/intrinsic-value" },
  { id: "jeremy-projection", label: "Jeremy's Projection", path: "/valuation/jeremy-projection" },
  { id: "plumas-projection", label: "Plumas Projection", path: "/valuation/plumas-projection" },
];

export function valuationTool(id: ValuationTool) {
  return VALUATION_TOOLS.find((tool) => tool.id === id)!;
}
