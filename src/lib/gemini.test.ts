import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSseParser, GeminiError, generateGeminiText, parseStreamChunk, streamGeminiContent, type GeminiStreamChunk } from "./gemini";

// A text/event-stream body, optionally cut into small pieces to test reassembly.
function sse(events: unknown[], pieceLength = 0): Response {
  const text = events.map((event) => `data: ${JSON.stringify(event)}\r\n\r\n`).join("");
  const pieces = pieceLength ? text.match(new RegExp(`[\\s\\S]{1,${pieceLength}}`, "g"))! : [text];
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(encoder.encode(piece));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

const text = (value: string, finishReason?: string) => ({
  candidates: [{ content: { role: "model", parts: [{ text: value }] }, ...(finishReason ? { finishReason } : {}) }],
});

async function collect(chunks: AsyncGenerator<GeminiStreamChunk>): Promise<GeminiStreamChunk[]> {
  const all: GeminiStreamChunk[] = [];
  for await (const chunk of chunks) all.push(chunk);
  return all;
}

const request = {
  instructions: "Be brief.",
  contents: [{ role: "user" as const, parts: [{ text: "Hi" }] }],
  functions: [{ name: "find_stock", description: "Find a ticker.", parameters: { type: "OBJECT", properties: {} } }],
  generationConfig: { maxOutputTokens: 100 },
  subject: "answer",
};

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "gemini-key");
  vi.stubEnv("GEMINI_MODEL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createSseParser", () => {
  it("reassembles events cut anywhere, even between \\r and \\n", () => {
    const parser = createSseParser();
    const stream = 'data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n';
    const events = [...stream].flatMap((char) => parser.push(char));
    expect([...events, ...parser.flush()]).toEqual(['{"a":1}', '{"b":2}']);
  });

  it("joins multi-line data, skips comments and empty events, and flushes an unterminated one", () => {
    const parser = createSseParser();
    expect(parser.push(": keep-alive\n\ndata: first\ndata:second\n\nevent: ping\n\ndata: last")).toEqual(["first\nsecond"]);
    expect(parser.flush()).toEqual(["last"]);
    expect(parser.flush()).toEqual([]);
  });
});

describe("parseStreamChunk", () => {
  it("reads the parts, the finish reason and a refused prompt", () => {
    expect(parseStreamChunk(JSON.stringify(text("Hello", "STOP")), "answer")).toEqual({ parts: [{ text: "Hello" }], finishReason: "STOP", blockReason: null });
    expect(parseStreamChunk(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }), "answer")).toEqual({ parts: [], finishReason: null, blockReason: "SAFETY" });
  });

  it("turns an error event into a message, marking overload as worth a retry", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const busy = (() => {
      try {
        parseStreamChunk(JSON.stringify({ error: { code: 503, status: "UNAVAILABLE" } }), "answer");
      } catch (error) {
        return error;
      }
    })();
    expect(busy).toBeInstanceOf(GeminiError);
    expect((busy as GeminiError).message).toMatch(/busy/);
    expect((busy as GeminiError).transient).toBe(true);
    expect(() => parseStreamChunk(JSON.stringify({ error: { code: 400 } }), "answer")).toThrow(/could not complete the answer/);
    expect(() => parseStreamChunk("not json", "answer")).toThrow(/unreadable answer/);
  });
});

describe("streamGeminiContent", () => {
  it("streams from streamGenerateContent with the functions offered and the key in a header", async () => {
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      void input;
      void init;
      return sse([text("Hel"), text("lo", "STOP")], 5);
    });
    vi.stubGlobal("fetch", fetchMock);

    const chunks = await collect(streamGeminiContent(request));
    expect(chunks.map((chunk) => chunk.parts[0]?.text).join("")).toBe("Hello");
    expect(chunks.at(-1)?.finishReason).toBe("STOP");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:streamGenerateContent?alt=sse");
    expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe("gemini-key");
    const body = JSON.parse(String(init?.body));
    expect(body.systemInstruction.parts[0].text).toBe("Be brief.");
    expect(body.tools[0].functionDeclarations[0].name).toBe("find_stock");
    expect(body.toolConfig.functionCallingConfig.mode).toBe("AUTO");
  });

  it("can forbid function calls for a final answer", async () => {
    const fetchMock = vi.fn(async (input: URL | string, init?: RequestInit) => {
      void input;
      void init;
      return sse([text("Done.", "STOP")]);
    });
    vi.stubGlobal("fetch", fetchMock);
    await collect(streamGeminiContent({ ...request, allowFunctionCalls: false }));
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).toolConfig.functionCallingConfig.mode).toBe("NONE");
  });

  it("explains refusals and overload", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failWith = async (status: number) => {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status })));
      try {
        await collect(streamGeminiContent(request));
      } catch (error) {
        return error as GeminiError;
      }
      throw new Error("expected a failure");
    };
    expect((await failWith(429)).message).toMatch(/request limit/);
    expect((await failWith(403)).message).toMatch(/rejected the API key/);
    const busy = await failWith(503);
    expect(busy.message).toMatch(/busy/);
    expect(busy.transient).toBe(true);
    const rejected = await failWith(400);
    expect(rejected.message).toMatch(/could not complete the answer/);
    expect(rejected.transient).toBe(false);
  });

  it("needs a key, and passes the user's abort through", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("GEMINI_API_KEY", "");
    await expect(collect(streamGeminiContent(request))).rejects.toThrow(/not configured/);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.stubEnv("GEMINI_API_KEY", "gemini-key");
    const controller = new AbortController();
    fetchMock.mockImplementation(async (_input: unknown, init?: RequestInit) => {
      controller.abort();
      init?.signal?.throwIfAborted();
      return sse([text("never")]);
    });
    const failure = await collect(streamGeminiContent({ ...request, signal: controller.signal })).catch((error: unknown) => error);
    expect(failure).not.toBeInstanceOf(GeminiError);
    expect(controller.signal.aborted).toBe(true);
  });
});

describe("generateGeminiText", () => {
  it("says when Gemini is overloaded", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await expect(generateGeminiText({ instructions: "x", prompt: "y", generationConfig: {}, subject: "review" })).resolves.toEqual({
      ok: false,
      error: "Gemini is busy right now. Please try again in a moment.",
    });
  });
});
