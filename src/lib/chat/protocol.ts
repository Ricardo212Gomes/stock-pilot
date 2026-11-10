// What the chat page and /api/chat exchange. Imports nothing from the server, so the page can bundle it.

export const MAX_MESSAGE_LENGTH = 4000;
// Earlier turns sent with each question; older ones are dropped.
export const MAX_HISTORY = 20;

export type ChatRole = "user" | "model";

export type ChatTurn = { role: ChatRole; text: string };

export type ChatRequest = {
  messages: ChatTurn[];
  // Where the question was asked: the company on screen (the page's ?symbol=) and the page's path, so "it" and
  // "this" have a referent.
  symbol?: string | null;
  page?: string | null;
};

export type ToolStatus = "running" | "done" | "failed";

// The answer streams as one JSON event a line.
export type ChatEvent =
  // The next piece of the answer's Markdown.
  | { type: "text"; text: string }
  // A look-up in StockPilot's data, sent when it starts and again when it ends. `href` is the page that shows it.
  | { type: "tool"; id: string; label: string; href: string | null; status: ToolStatus }
  // Something to say under the answer, such as it being cut off.
  | { type: "notice"; text: string }
  | { type: "error"; error: string };

export function isChatEvent(value: unknown): value is ChatEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Record<string, unknown>;
  switch (event.type) {
    case "text":
      return typeof event.text === "string";
    case "tool":
      return typeof event.id === "string" && typeof event.label === "string"
        && (event.href === null || typeof event.href === "string")
        && (event.status === "running" || event.status === "done" || event.status === "failed");
    case "notice":
      return typeof event.text === "string";
    case "error":
      return typeof event.error === "string";
    default:
      return false;
  }
}

// Reads the event lines as they arrive; a line cut across two chunks waits for the rest.
export function createEventReader(): { push(text: string): ChatEvent[]; flush(): ChatEvent[] } {
  let buffer = "";
  const parse = (lines: string[]) => lines.flatMap((line): ChatEvent[] => {
    if (!line.trim()) return [];
    try {
      const event: unknown = JSON.parse(line);
      return isChatEvent(event) ? [event] : [];
    } catch {
      return [];
    }
  });
  return {
    push(text) {
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop()!;
      return parse(lines);
    },
    flush() {
      const rest = buffer;
      buffer = "";
      return parse([rest]);
    },
  };
}
