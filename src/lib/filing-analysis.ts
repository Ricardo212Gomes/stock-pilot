import { getSql, isDatabaseConfigured } from "./db";
import { generateGeminiText } from "./gemini";
import { secHeaders } from "./sec";
import { isEarningsRelease, pressReleaseUrl, type Filing } from "./sec-filings";

// AI analyses of SEC filings for the Telegram filing alerts: the document is read from sec.gov,
// reduced to plain text, and summarized once; the analysis is saved and shared.

export type FilingAnalysis = {
  headline: string;
  summary: string;
  keyPoints: string[];
  watch: string[];
  sentiment: "positive" | "neutral" | "negative";
};

const SENTIMENTS: FilingAnalysis["sentiment"][] = ["positive", "neutral", "negative"];
// About 30,000 tokens: plenty for an 8-K or a press release, and the key part of a 10-K or 10-Q.
const MAX_DOCUMENT_CHARS = 120_000;
// 8-K items worth an alert; 5.07 (vote results), 9.01 (exhibits only) and similar are left out.
const ALERT_ITEMS = new Set(["1.01", "1.02", "1.05", "2.01", "2.02", "2.03", "2.05", "2.06", "3.01", "4.01", "4.02", "5.01", "5.02", "7.01", "8.01"]);
const REPORT_FORMS = new Set(["10-K", "10-Q", "20-F", "40-F"]);

// Annual and quarterly reports, and 8-Ks about something that matters to shareholders.
export function isAlertFiling(filing: Pick<Filing, "form" | "items">): boolean {
  if (REPORT_FORMS.has(filing.form)) return true;
  return filing.form === "8-K" && filing.items.some((item) => ALERT_ITEMS.has(item));
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " ", "&#160;": " ", "&rsquo;": "’", "&lsquo;": "‘", "&ldquo;": "“", "&rdquo;": "”", "&mdash;": "—", "&ndash;": "–" };

// Readable text from an EDGAR HTML document: no tags, scripts, styles or hidden XBRL headers.
export function htmlToText(html: string): string {
  return html
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, " ")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|li|h\d|table)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&[a-z]+;|&#\d+;/gi, (entity) => ENTITIES[entity.toLowerCase()] ?? " ")
    .replace(/[ \t ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

// For a 10-K or 10-Q, start at Management's Discussion and Analysis, where management explains
// the period; the table of contents mentions it first, so the last long match is the section.
export function focusDocument(text: string, form: string): string {
  if (REPORT_FORMS.has(form)) {
    const matches = [...text.matchAll(/management['’]s discussion and analysis/gi)].map((match) => match.index ?? 0);
    const start = matches.find((index, position) => position > 0 && text.length - index > 20_000) ?? matches[0];
    if (start !== undefined) return text.slice(start, start + MAX_DOCUMENT_CHARS);
  }
  return text.slice(0, MAX_DOCUMENT_CHARS);
}

export const FILING_INSTRUCTIONS = [
  "You are an objective equity research assistant analyzing an SEC filing for an investor who owns the stock.",
  "Address the reader directly and never mention their experience level.",
  "Use only the filing text. Quote numbers exactly as written, with units and periods. Do not add outside facts or prices.",
  "headline: one short line on what this filing is about.",
  "summary: two or three plain sentences on what happened and why it matters to shareholders.",
  "keyPoints: up to five specific facts or figures from the filing.",
  "watch: up to three things to keep an eye on (risks, guidance, pending events); leave it empty if nothing stands out.",
  "sentiment: positive, neutral or negative for shareholders, judged only from the filing.",
  "Plain text only, no Markdown. Do not give a buy, sell or price recommendation.",
].join(" ");

export const FILING_SCHEMA = {
  type: "OBJECT",
  properties: {
    headline: { type: "STRING" },
    summary: { type: "STRING" },
    keyPoints: { type: "ARRAY", items: { type: "STRING" } },
    watch: { type: "ARRAY", items: { type: "STRING" } },
    sentiment: { type: "STRING", enum: SENTIMENTS },
  },
  required: ["headline", "summary", "keyPoints", "watch", "sentiment"],
};

function clean(value: unknown, limit: number): string {
  if (typeof value !== "string") return "";
  const text = value.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function cleanList(value: unknown, count: number): string[] {
  return Array.isArray(value) ? value.map((item) => clean(item, 300).replace(/^[-•*]\s*/, "")).filter(Boolean).slice(0, count) : [];
}

export function parseFilingAnalysis(text: string): FilingAnalysis | null {
  let payload: unknown;
  try {
    payload = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  const record = (payload ?? {}) as Record<string, unknown>;
  const headline = clean(record.headline, 200);
  const summary = clean(record.summary, 800);
  if (!headline || !summary) return null;
  return {
    headline,
    summary,
    keyPoints: cleanList(record.keyPoints, 5),
    watch: cleanList(record.watch, 3),
    sentiment: SENTIMENTS.includes(record.sentiment as FilingAnalysis["sentiment"]) ? (record.sentiment as FilingAnalysis["sentiment"]) : "neutral",
  };
}

async function documentText(filing: Filing): Promise<string | null> {
  // An earnings 8-K's substance is the attached press release.
  const url = (isEarningsRelease(filing) && (await pressReleaseUrl(filing))) || filing.documentUrl;
  try {
    const response = await fetch(url, { headers: secHeaders(), cache: "no-store", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return null;
    const text = focusDocument(htmlToText(await response.text()), filing.form);
    return text.length > 200 ? text : null;
  } catch {
    return null;
  }
}

async function savedAnalysis(accession: string): Promise<FilingAnalysis | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const [row] = await getSql()<{ analysis: FilingAnalysis }[]>`select analysis from filing_analyses where accession = ${accession}`;
    return row?.analysis ?? null;
  } catch {
    return null;
  }
}

export type FilingAnalysisResult = { ok: true; analysis: FilingAnalysis } | { ok: false; error: string };

export async function ensureFilingAnalysis(symbol: string, company: string, filing: Filing): Promise<FilingAnalysisResult> {
  const saved = await savedAnalysis(filing.accession);
  if (saved) return { ok: true, analysis: saved };

  const text = await documentText(filing);
  if (!text) return { ok: false, error: "The filing's text couldn't be read from sec.gov." };

  let analysis: FilingAnalysis | null = null;
  let error = "Gemini's analysis could not be read.";
  // One retry: long filings occasionally time out on the first attempt.
  for (let attempt = 0; attempt < 2 && !analysis; attempt++) {
    const result = await generateGeminiText({
      instructions: FILING_INSTRUCTIONS,
      prompt: `${company} (${symbol}) filed a ${filing.form} on ${filing.filed}: ${filing.description}.\n\nFiling text:\n\n${text}`,
      generationConfig: { temperature: 0.2, maxOutputTokens: 2000, responseMimeType: "application/json", responseSchema: FILING_SCHEMA },
      subject: "filing analysis",
      timeoutMs: 90_000,
    });
    if (result.ok) analysis = parseFilingAnalysis(result.text);
    else error = result.error;
  }
  if (!analysis) return { ok: false, error };

  if (isDatabaseConfigured()) {
    const sql = getSql();
    await sql`
      insert into filing_analyses (accession, symbol, form, filed, analysis)
      values (${filing.accession}, ${symbol}, ${filing.form}, ${filing.filed}, ${sql.json(analysis)})
      on conflict (accession) do nothing
    `.catch(() => undefined);
  }
  return { ok: true, analysis };
}
