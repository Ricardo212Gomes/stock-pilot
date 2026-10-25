"use server";

import { normalizeTicker } from "@/lib/fmp";
import { ensureTranscriptSummary, type TranscriptSummaryResult } from "@/lib/transcript-summary";
import { isFiscalQuarter } from "@/lib/transcripts";

export type { TranscriptSummaryResult };

// Takes only the ticker and quarter; the transcript is reloaded on the server (from the saved
// copy), so the prompt never contains text supplied by the browser.
export async function summarizeTranscript(rawSymbol: unknown, rawQuarter: unknown, company: unknown): Promise<TranscriptSummaryResult> {
  const symbol = normalizeTicker(rawSymbol);
  if (!symbol || !isFiscalQuarter(rawQuarter)) return { ok: false, error: "There is no transcript to summarize." };
  return ensureTranscriptSummary(symbol, rawQuarter, typeof company === "string" && company.length <= 120 ? company : symbol);
}
