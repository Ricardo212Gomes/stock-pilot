import { getSql, isDatabaseConfigured } from "./db";
import type { FiscalQuarter, TranscriptSegment } from "./transcripts";

// An AI summary of an earnings call transcript. Summaries are saved next to the transcript, so
// each call is summarized once.

export type CallTone = "positive" | "neutral" | "cautious" | "negative";

export type TranscriptSummary = {
  overview: string;
  highlights: string[];
  outlook: string[];
  analystQuestions: string[];
  tone: CallTone;
  toneReason: string;
};

const TONES: CallTone[] = ["positive", "neutral", "cautious", "negative"];
// About 30,000 tokens: longer calls are cut, keeping the start of the Q&A.
const MAX_TRANSCRIPT_CHARS = 120_000;

export const SUMMARY_INSTRUCTIONS = [
  "You are an objective equity research assistant summarizing an earnings call for an individual investor.",
  "Address the reader directly and never mention their experience level.",
  "Use only what is said in the transcript. Do not add outside facts, news or prices.",
  "Quote numbers exactly as management states them, with their units and periods.",
  "overview: two or three plain sentences on how the quarter went and what management emphasized.",
  "highlights: up to five of the most important results or announcements, each one short sentence.",
  "outlook: up to four points on guidance and what management expects next; leave it empty if none was given.",
  "analystQuestions: up to four themes analysts pressed on, each with the gist of management's answer.",
  "tone: management's overall tone, one of positive, neutral, cautious or negative, and toneReason: one sentence why.",
  "Plain text only, no Markdown. Do not give a buy, sell or price recommendation.",
].join(" ");

export const SUMMARY_SCHEMA = {
  type: "OBJECT",
  properties: {
    overview: { type: "STRING" },
    highlights: { type: "ARRAY", items: { type: "STRING" } },
    outlook: { type: "ARRAY", items: { type: "STRING" } },
    analystQuestions: { type: "ARRAY", items: { type: "STRING" } },
    tone: { type: "STRING", enum: TONES },
    toneReason: { type: "STRING" },
  },
  required: ["overview", "highlights", "outlook", "analystQuestions", "tone", "toneReason"],
};

export function buildSummaryPrompt({
  company,
  quarterLabel,
  segments,
}: {
  company: string;
  quarterLabel: string;
  segments: TranscriptSegment[];
}): string {
  let transcript = segments
    .map((segment) => `${segment.speaker}${segment.title && segment.title !== segment.speaker ? ` (${segment.title})` : ""}: ${segment.content}`)
    .join("\n\n");
  if (transcript.length > MAX_TRANSCRIPT_CHARS) transcript = `${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n[The rest of the call is cut for length.]`;
  return `Summarize ${company}'s ${quarterLabel} earnings call.\n\nTranscript:\n\n${transcript}`;
}

function cleanText(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function cleanList(value: unknown, count: number): string[] {
  return Array.isArray(value)
    ? value.map((item) => cleanText(item, 320).replace(/^[-•*]\s*/, "")).filter(Boolean).slice(0, count)
    : [];
}

export function parseSummary(text: string): TranscriptSummary | null {
  let payload: unknown;
  try {
    payload = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  const record = (payload ?? {}) as Record<string, unknown>;
  const overview = cleanText(record.overview, 800);
  if (!overview) return null;
  const tone = TONES.includes(record.tone as CallTone) ? (record.tone as CallTone) : "neutral";
  return {
    overview,
    highlights: cleanList(record.highlights, 5),
    outlook: cleanList(record.outlook, 4),
    analystQuestions: cleanList(record.analystQuestions, 4),
    tone,
    toneReason: cleanText(record.toneReason, 320),
  };
}

// Kept without a database, and as a fallback when it can't be reached.
const memory = new Map<string, TranscriptSummary>();

export async function getSavedSummary(symbol: string, quarter: FiscalQuarter): Promise<TranscriptSummary | null> {
  if (isDatabaseConfigured()) {
    try {
      const [row] = await getSql()<{ summary: TranscriptSummary | null }[]>`
        select summary from transcripts where symbol = ${symbol} and quarter = ${quarter}
      `;
      if (row?.summary) return row.summary;
    } catch {
      // Fall through to the in-memory copy.
    }
  }
  return memory.get(`${symbol}:${quarter}`) ?? null;
}

export async function saveSummary(symbol: string, quarter: FiscalQuarter, summary: TranscriptSummary): Promise<void> {
  memory.set(`${symbol}:${quarter}`, summary);
  if (!isDatabaseConfigured()) return;
  try {
    const sql = getSql();
    await sql`update transcripts set summary = ${sql.json(summary)} where symbol = ${symbol} and quarter = ${quarter}`;
  } catch {
    // The memory copy still saves a second Gemini request until the server restarts.
  }
}
