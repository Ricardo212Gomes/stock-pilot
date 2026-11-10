import { currentUserId, isAuthConfigured } from "@/auth";
import { parseChatRequest, runChat } from "@/lib/chat/conversation";
import type { ChatEvent } from "@/lib/chat/protocol";
import { isGeminiConfigured } from "@/lib/gemini";

// The AI chat's answers (see docs/chat.md), streamed as one JSON event a line while Gemini writes them.

// Far more than a long conversation; anything bigger is refused before it's parsed.
const MAX_BODY_CHARS = 256 * 1024;

function refuse(error: string, status: number): Response {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

// Only StockPilot's own pages ask. Another site can't send a JSON body without the browser checking with this
// server first, and when the browser names the page's origin, it has to be this host.
function fromThisSite(request: Request): boolean {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return false;
  const origin = request.headers.get("origin");
  if (!origin) return true;
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!fromThisSite(request)) return refuse("The chat only answers StockPilot's own pages.", 403);
  if (!isGeminiConfigured()) return refuse("Gemini is not configured. Add GEMINI_API_KEY to .env.local and restart the server.", 503);

  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_CHARS) return refuse("The conversation is too long. Start a new chat.", 413);
    body = JSON.parse(text);
  } catch {
    return refuse("The request wasn't understood.", 400);
  }
  const parsed = parseChatRequest(body);
  if (!parsed.ok) return refuse(parsed.error, 400);

  // The portfolio and favorites look-ups read the signed-in user's own data.
  const userId = await currentUserId().catch(() => null);

  // Stops Gemini and the look-ups' rounds when the browser goes away or the user stops the answer.
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort(), { once: true });
  const encoder = new TextEncoder();
  const line = (event: ChatEvent) => encoder.encode(`${JSON.stringify(event)}\n`);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of runChat({
          messages: parsed.messages,
          symbol: parsed.symbol,
          page: parsed.page,
          userId,
          canSignIn: isAuthConfigured(),
          signal: abort.signal,
        })) {
          if (abort.signal.aborted) break;
          controller.enqueue(line(event));
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          console.error("The chat failed:", error);
          controller.enqueue(line({ type: "error", error: "The answer couldn't be completed. Please try again." }));
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already cancelled by the browser.
        }
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // no-transform keeps compression from holding the stream back; nginx reads X-Accel-Buffering.
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
