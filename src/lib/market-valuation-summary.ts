import { generateGeminiText, type GeminiResult } from "./gemini";
import { INDEX_LABEL } from "./market-valuation";

// The AI summary on the Market valuation page: a short paragraph from the stored numbers, written by the update job
// (never on a page visit) and only when a new month's data has arrived.

const INSTRUCTIONS = `You write a short, plain-English note on how expensive a US stock index is against its own history,
for an investor reading a valuation page. Use only the numbers given; never invent figures or dates. Write 3 or 4 sentences,
at most 90 words, in plain text without headings, lists, Markdown or emojis. Say where valuations stand against history,
what the comparison with the 10-year Treasury yield suggests, and one caveat (for example that valuation says little about
the next few months, or that the history is short). Don't recommend buying or selling.`;

export function summaryPrompt(index: "sp500" | "ndx", facts: string[]): string {
  return [`Index: ${INDEX_LABEL[index]}`, ...facts.map((fact) => `- ${fact}`)].join("\n");
}

// Plain text only, on one paragraph, cut at a sentence end if it ran long.
export function cleanSummary(text: string): string {
  const flat = text.replace(/[*_#`>]/g, "").replace(/\s+/g, " ").trim();
  if (flat.length <= 700) return flat;
  const cut = flat.slice(0, 700);
  const end = cut.lastIndexOf(". ");
  return end > 200 ? cut.slice(0, end + 1) : cut;
}

export async function writeValuationSummary(index: "sp500" | "ndx", facts: string[]): Promise<GeminiResult> {
  const result = await generateGeminiText({
    instructions: INSTRUCTIONS,
    prompt: summaryPrompt(index, facts),
    generationConfig: { temperature: 0.2, maxOutputTokens: 400 },
    subject: "valuation summary",
    timeoutMs: 60_000,
  });
  if (!result.ok) return result;
  const text = cleanSummary(result.text);
  return text ? { ok: true, text } : { ok: false, error: "Gemini returned an empty summary." };
}
