"use server";

import { normalizeTicker } from "@/lib/fmp";
import { generateGeminiText } from "@/lib/gemini";
import {
  SUMMARY_INSTRUCTIONS,
  SUMMARY_SCHEMA,
  buildSummaryPrompt,
  getSavedSummary,
  parseSummary,
  saveSummary,
  type TranscriptSummary,
} from "@/lib/transcript-summary";
import { getTranscript, isFiscalQuarter, quarterLabel, transcriptFailureMessage } from "@/lib/transcripts";

export type TranscriptSummaryResult = { ok: true; summary: TranscriptSummary } | { ok: false; error: string };

// Takes only the ticker and quarter; the transcript is reloaded on the server (from the saved
// copy), so the prompt never contains text supplied by the browser.
export async function summarizeTranscript(rawSymbol: unknown, rawQuarter: unknown, company: unknown): Promise<TranscriptSummaryResult> {
  const symbol = normalizeTicker(rawSymbol);
  if (!symbol || !isFiscalQuarter(rawQuarter)) return { ok: false, error: "There is no transcript to summarize." };

  const saved = await getSavedSummary(symbol, rawQuarter);
  if (saved) return { ok: true, summary: saved };

  const transcript = await getTranscript(symbol, rawQuarter);
  if (!transcript.ok) return { ok: false, error: transcriptFailureMessage(transcript.reason, rawQuarter) };

  const result = await generateGeminiText({
    instructions: SUMMARY_INSTRUCTIONS,
    prompt: buildSummaryPrompt({
      company: typeof company === "string" && company.length <= 120 ? company : symbol,
      quarterLabel: quarterLabel(rawQuarter),
      segments: transcript.segments,
    }),
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 1500,
      responseMimeType: "application/json",
      responseSchema: SUMMARY_SCHEMA,
    },
    subject: "summary",
  });
  if (!result.ok) return result;

  const summary = parseSummary(result.text);
  if (!summary) return { ok: false, error: "Gemini's summary could not be read. Please try again." };
  await saveSummary(symbol, rawQuarter, summary);
  return { ok: true, summary };
}
