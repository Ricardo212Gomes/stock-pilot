import { generateGeminiText } from "./gemini";

// Picks the headlines that matter for the Telegram news digest, with a one-line reason each.

export type NewsCandidate = {
  id: string;
  symbol: string;
  title: string;
  summary: string;
  source: string | null;
  url: string | null;
  publishedAt: string;
};

export type NewsPick = NewsCandidate & { why: string | null };

export const MAX_PICKS = 6;
// Headlines per company offered to Gemini, newest first; more makes the prompt slow without better picks.
export const CANDIDATES_PER_SYMBOL = 6;
// Without Gemini, the newest headlines per company stand in for a selection.
const FALLBACK_PER_SYMBOL = 2;

export const NEWS_INSTRUCTIONS = [
  "You pick the news an investor who owns these stocks should not miss today.",
  "Keep news that can move the stock or changes the story: results, guidance, deals, regulation, lawsuits, management changes, major products or customers, large analyst moves.",
  "Skip roundups, listicles, 'stocks to buy' pieces, price-move recaps without a cause, and articles that only mention the company in passing.",
  `Pick at most ${MAX_PICKS}, most important first, and none if nothing qualifies. Never pick two articles about the same event.`,
  "For each pick, give why: one plain sentence on what it means for the company, using only the headline and summary.",
  "No Markdown, no buy or sell advice.",
].join(" ");

export const NEWS_SCHEMA = {
  type: "OBJECT",
  properties: {
    picks: {
      type: "ARRAY",
      items: { type: "OBJECT", properties: { id: { type: "STRING" }, why: { type: "STRING" } }, required: ["id", "why"] },
    },
  },
  required: ["picks"],
};

export function buildNewsPrompt(candidates: NewsCandidate[]): string {
  const list = candidates.map((item) => ({ id: item.id, ticker: item.symbol, source: item.source, title: item.title, summary: item.summary.slice(0, 400) }));
  return `Headlines from the last day about the investor's stocks:\n\n${JSON.stringify(list)}`;
}

export function parsePicks(text: string, candidates: NewsCandidate[]): NewsPick[] | null {
  let payload: unknown;
  try {
    payload = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return null;
  }
  const picks = (payload as { picks?: unknown } | null)?.picks;
  if (!Array.isArray(picks)) return null;
  const byId = new Map(candidates.map((item) => [item.id, item]));
  const seen = new Set<string>();
  return picks.flatMap((pick): NewsPick[] => {
    const { id, why } = (pick ?? {}) as { id?: unknown; why?: unknown };
    const item = typeof id === "string" ? byId.get(id) : undefined;
    if (!item || seen.has(item.id)) return [];
    seen.add(item.id);
    return [{ ...item, why: typeof why === "string" && why.trim() ? why.replace(/\s+/g, " ").trim().slice(0, 300) : null }];
  }).slice(0, MAX_PICKS);
}

function fallbackPicks(candidates: NewsCandidate[]): NewsPick[] {
  const perSymbol = new Map<string, number>();
  return [...candidates]
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt))
    .filter((item) => {
      const count = perSymbol.get(item.symbol) ?? 0;
      perSymbol.set(item.symbol, count + 1);
      return count < FALLBACK_PER_SYMBOL;
    })
    .slice(0, MAX_PICKS)
    .map((item) => ({ ...item, why: null }));
}

// The headlines worth sending; Gemini chooses, and a plain newest-first list stands in if it fails.
export async function selectNews(candidates: NewsCandidate[]): Promise<{ picks: NewsPick[]; aiSelected: boolean }> {
  if (candidates.length === 0) return { picks: [], aiSelected: false };
  // One retry: a long prompt occasionally times out on the first attempt.
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await generateGeminiText({
      instructions: NEWS_INSTRUCTIONS,
      prompt: buildNewsPrompt(candidates),
      generationConfig: { temperature: 0.1, maxOutputTokens: 2000, responseMimeType: "application/json", responseSchema: NEWS_SCHEMA },
      subject: "news selection",
      timeoutMs: 90_000,
    });
    const picks = result.ok ? parsePicks(result.text, candidates) : null;
    if (picks) return { picks, aiSelected: true };
  }
  return { picks: fallbackPicks(candidates), aiSelected: false };
}
