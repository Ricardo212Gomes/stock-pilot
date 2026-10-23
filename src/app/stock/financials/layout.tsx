import { AiReviewProvider } from "./ai-review";

// Stays mounted while moving between Financials tabs and periods, so AI reviews are kept;
// leaving Financials unmounts it and clears them.
export default function FinancialsLayout({ children }: LayoutProps<"/stock/financials">) {
  return <AiReviewProvider>{children}</AiReviewProvider>;
}
