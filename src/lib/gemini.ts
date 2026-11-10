const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const NOT_CONFIGURED = "Gemini is not configured. Add GEMINI_API_KEY to .env.local and restart the server.";
const UNREACHABLE = "Gemini could not be reached. Check your connection and try again.";

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: unknown }> };
  }>;
};

export type GeminiResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

type GeminiSettings = { apiKey: string; model: string };

function geminiSettings(): GeminiSettings | null {
  // Blank values count as unset, so an empty line in .env falls back cleanly.
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  return apiKey ? { apiKey, model: process.env.GEMINI_MODEL || DEFAULT_MODEL } : null;
}

export function isGeminiConfigured(): boolean {
  return geminiSettings() !== null;
}

// `subject` names the task, e.g. "analysis" → "could not complete the analysis".
function statusError(status: number, subject: string): string {
  if (status === 401 || status === 403) {
    return "Gemini rejected the API key. Check that it is valid and enabled for the Gemini API.";
  }
  if (status === 429) return "Gemini's request limit was reached. Wait a moment and try again.";
  if (status === 503) return "Gemini is busy right now. Please try again in a moment.";
  return `Gemini could not complete the ${subject}. Please try again.`;
}

// Google's side failing or overloaded, which usually passes within seconds.
function isTransient(status: number): boolean {
  return status === 500 || status === 503;
}

export async function generateGeminiText({
  instructions,
  prompt,
  generationConfig,
  subject,
  timeoutMs = 45_000,
}: {
  instructions: string;
  prompt: string;
  generationConfig: Record<string, unknown>;
  // Names the task in error messages, e.g. "analysis" → "could not complete the analysis".
  subject: string;
  // Pages keep the default; background jobs with long prompts (news, filings) can wait longer.
  timeoutMs?: number;
}): Promise<GeminiResult> {
  const settings = geminiSettings();
  if (!settings) return { ok: false, error: NOT_CONFIGURED };

  try {
    const response = await fetch(`${GEMINI_BASE_URL}/${settings.model}:generateContent`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": settings.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instructions }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) return { ok: false, error: statusError(response.status, subject) };

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
    return { ok: false, error: UNREACHABLE };
  }
}

// --- Streaming, with function calling (the AI chat) ---------------------------------------------------

export type GeminiFunctionCall = { id?: string; name: string; args?: Record<string, unknown> };

export type GeminiPart = {
  text?: string;
  // A thought summary rather than the answer; only returned when asked for.
  thought?: boolean;
  // Opaque. Gemini 3 checks that each function call comes back with the signature it was given.
  thoughtSignature?: string;
  functionCall?: GeminiFunctionCall;
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
};

export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

export type GeminiFunctionDeclaration = {
  name: string;
  description: string;
  // Gemini's schema subset, with types in capitals ("OBJECT", "STRING").
  parameters?: Record<string, unknown>;
};

export type GeminiStreamChunk = {
  parts: GeminiPart[];
  // Set on the last chunk: "STOP", "MAX_TOKENS", "SAFETY", "MALFORMED_FUNCTION_CALL"…
  finishReason: string | null;
  // Set when the prompt itself was refused.
  blockReason: string | null;
};

// Carries a message that can be shown to the user as it is. `transient`: Google was overloaded or failed, so the
// same request may well work a moment later.
export class GeminiError extends Error {
  constructor(message: string, readonly transient = false) {
    super(message);
  }
}

// Splits a text/event-stream into each event's data. Chunks can end anywhere, even between "\r" and "\n".
export function createSseParser(): { push(text: string): string[]; flush(): string[] } {
  let buffer = "";

  function eventData(block: string): string | null {
    const lines = block.split("\n").filter((line) => line.startsWith("data:"));
    if (lines.length === 0) return null;
    const data = lines.map((line) => line.slice(line.startsWith("data: ") ? 6 : 5)).join("\n");
    return data.trim() ? data : null;
  }

  return {
    push(text) {
      buffer += text;
      // A lone "\r" may be the first half of "\r\n": keep it for the next chunk.
      const held = buffer.endsWith("\r") ? "\r" : "";
      const blocks = buffer.slice(0, buffer.length - held.length).replace(/\r\n?/g, "\n").split("\n\n");
      buffer = blocks.pop()! + held;
      return blocks.flatMap((block) => eventData(block) ?? []);
    },
    flush() {
      const data = eventData(buffer.replace(/\r\n?/g, "\n"));
      buffer = "";
      return data ? [data] : [];
    },
  };
}

type StreamPayload = {
  candidates?: Array<{ content?: { parts?: unknown }; finishReason?: unknown }>;
  promptFeedback?: { blockReason?: unknown };
  error?: unknown;
};

export function parseStreamChunk(data: string, subject: string): GeminiStreamChunk {
  let payload: StreamPayload;
  try {
    payload = JSON.parse(data) as StreamPayload;
  } catch {
    throw new GeminiError(`Gemini sent an unreadable ${subject}. Please try again.`);
  }
  // An error after the stream has started arrives as an event of its own, such as 503 when the model is overloaded.
  if (payload.error) {
    console.error(`Gemini stream error: ${JSON.stringify(payload.error).slice(0, 500)}`);
    const code = (payload.error as { code?: unknown }).code;
    const status = typeof code === "number" ? code : 0;
    throw new GeminiError(statusError(status, subject), isTransient(status));
  }
  const candidate = payload.candidates?.[0];
  const rawParts: unknown = candidate?.content?.parts;
  const parts = Array.isArray(rawParts)
    ? rawParts.filter((part): part is GeminiPart => !!part && typeof part === "object")
    : [];
  return {
    parts,
    finishReason: typeof candidate?.finishReason === "string" ? candidate.finishReason : null,
    blockReason: typeof payload.promptFeedback?.blockReason === "string" ? payload.promptFeedback.blockReason : null,
  };
}

// The model's reply as it's written, chunk by chunk. Throws GeminiError with a message for the user; when
// `signal` aborts (the user stopped the answer) it throws whatever the abort raised.
export async function* streamGeminiContent({
  instructions,
  contents,
  functions,
  allowFunctionCalls = true,
  generationConfig,
  subject,
  signal,
  timeoutMs = 90_000,
}: {
  instructions: string;
  contents: GeminiContent[];
  functions: GeminiFunctionDeclaration[];
  // False makes the model answer with what it has instead of calling another function.
  allowFunctionCalls?: boolean;
  generationConfig: Record<string, unknown>;
  subject: string;
  signal?: AbortSignal;
  // The whole reply, not just the first byte.
  timeoutMs?: number;
}): AsyncGenerator<GeminiStreamChunk> {
  const settings = geminiSettings();
  if (!settings) throw new GeminiError(NOT_CONFIGURED);

  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const failure = (error: unknown) => {
    if (error instanceof GeminiError || signal?.aborted) return error;
    return new GeminiError(timeout.aborted ? `Gemini took too long to write the ${subject}. Please try again.` : UNREACHABLE);
  };

  let response: Response;
  try {
    response = await fetch(`${GEMINI_BASE_URL}/${settings.model}:streamGenerateContent?alt=sse`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": settings.apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: instructions }] },
        contents,
        ...(functions.length > 0
          ? {
              tools: [{ functionDeclarations: functions }],
              toolConfig: { functionCallingConfig: { mode: allowFunctionCalls ? "AUTO" : "NONE" } },
            }
          : {}),
        generationConfig,
      }),
      signal: combined,
    });
  } catch (error) {
    throw failure(error);
  }

  if (!response.ok || !response.body) {
    if (![401, 403, 429, 503].includes(response.status)) {
      // A rejected request (bad history, schema or signature) only says why in the body; the user sees the
      // generic message.
      const detail = await response.text().catch(() => "");
      console.error(`Gemini stream failed with ${response.status}: ${detail.slice(0, 500)}`);
    }
    throw new GeminiError(statusError(response.status, subject), isTransient(response.status));
  }

  const parser = createSseParser();
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const data of parser.push(value)) yield parseStreamChunk(data, subject);
    }
    for (const data of parser.flush()) yield parseStreamChunk(data, subject);
  } catch (error) {
    throw failure(error);
  } finally {
    // Frees the connection when the caller stops early.
    reader.cancel().catch(() => {});
  }
}
