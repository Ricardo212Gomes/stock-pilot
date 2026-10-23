const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-3.5-flash-lite";

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown }> };
  }>;
};

export type GeminiResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export async function generateGeminiText({
  instructions,
  prompt,
  generationConfig,
  subject,
}: {
  instructions: string;
  prompt: string;
  generationConfig: Record<string, unknown>;
  // Names the task in error messages, e.g. "analysis" → "could not complete the analysis".
  subject: string;
}): Promise<GeminiResult> {
  // Blank values count as unset, so an empty line in .env falls back cleanly.
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: "Gemini is not configured. Add GEMINI_API_KEY to .env.local and restart the server.",
    };
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  try {
    const response = await fetch(`${GEMINI_BASE_URL}/${model}:generateContent`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instructions }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: "Gemini rejected the API key. Check that it is valid and enabled for the Gemini API." };
      }
      if (response.status === 429) {
        return { ok: false, error: "Gemini's request limit was reached. Wait a moment and try again." };
      }
      return { ok: false, error: `Gemini could not complete the ${subject}. Please try again.` };
    }

    const result = (await response.json()) as GeminiResponse;
    const text = result.candidates?.[0]?.content?.parts
      ?.map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("\n")
      .trim();

    if (!text) {
      return { ok: false, error: `Gemini returned an empty ${subject}. Please try again.` };
    }

    return { ok: true, text };
  } catch {
    return { ok: false, error: "Gemini could not be reached. Check your connection and try again." };
  }
}
