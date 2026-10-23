import type { FmpFailureReason } from "./fmp";

export function providerFailureMessage(reason: FmpFailureReason | undefined, subject: string): string {
  switch (reason) {
    case "rate-limited":
      return `FMP's request limit for your plan has been reached, so ${subject} couldn't be loaded. It resets daily. Try again later or upgrade your FMP plan.`;
    case "invalid-key":
      return `FMP rejected the API key, so ${subject} couldn't be loaded. Check FMP_API_KEY in your environment file and restart the development server.`;
    case "plan-restricted":
      return `Your FMP plan doesn't include ${subject} for this ticker. Upgrade your plan or try a different company.`;
    case "not-configured":
      return "FMP is not connected yet. Add your FMP_API_KEY to .env and restart the development server.";
    default:
      return `FMP could not return ${subject}. Try again in a moment.`;
  }
}
