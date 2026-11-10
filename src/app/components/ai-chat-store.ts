import { createEventReader, MAX_HISTORY, MAX_MESSAGE_LENGTH, type ChatEvent, type ChatTurn, type ToolStatus } from "@/lib/chat/protocol";

// The AI chat's conversation and panel, outside React: an answer keeps arriving while the panel is closed or the
// user opens one of its sources. The conversation is kept in the tab's session storage, so it survives a reload;
// closing the tab forgets it.

export type ToolUse = { id: string; label: string; href: string | null; status: ToolStatus };

// Where the user was when they asked: the company on screen and the page, so "it" has a referent.
export type ChatContext = { symbol: string | null; page: string | null };

export type UserMessage = { id: string; role: "user"; text: string; context?: ChatContext };

export type AnswerMessage = {
  id: string;
  role: "model";
  text: string;
  tools: ToolUse[];
  status: "streaming" | "done" | "stopped" | "error";
  error?: string;
  notice?: string;
};

export type ChatMessage = UserMessage | AnswerMessage;

export type ChatState = {
  messages: ChatMessage[];
  open: boolean;
  // An answer finished while the panel was closed.
  unread: boolean;
};

const STORAGE_KEY = "stockpilot-chat";
// Older turns are dropped from storage beyond this.
const MAX_STORED = 60;
const SERVER_STATE: ChatState = { messages: [], open: false, unread: false };

let lastId = 0;
function newId(): string {
  lastId += 1;
  return `${Date.now().toString(36)}-${lastId}`;
}

function isMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (typeof message.id !== "string" || typeof message.text !== "string") return false;
  return message.role === "user" || (message.role === "model" && Array.isArray(message.tools) && typeof message.status === "string");
}

// What goes back to the server: the questions and the answers' text. The look-ups' results never do; each
// answer fetches its own figures.
export function toTurns(messages: ChatMessage[]): ChatTurn[] {
  return messages
    .flatMap((message): ChatTurn[] => (message.text.trim() ? [{ role: message.role, text: message.text }] : []))
    .slice(-MAX_HISTORY);
}

export function applyEvents(message: AnswerMessage, events: ChatEvent[]): AnswerMessage {
  let next = message;
  for (const event of events) {
    switch (event.type) {
      case "text":
        next = { ...next, text: next.text + event.text };
        break;
      case "tool": {
        const tool: ToolUse = { id: event.id, label: event.label, href: event.href, status: event.status };
        const known = next.tools.some((item) => item.id === event.id);
        next = { ...next, tools: known ? next.tools.map((item) => (item.id === event.id ? tool : item)) : [...next.tools, tool] };
        break;
      }
      case "notice":
        next = { ...next, notice: event.text };
        break;
      case "error":
        next = { ...next, status: "error", error: event.error };
        break;
    }
  }
  return next;
}

async function responseError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error) return body.error;
  } catch {
    // Not a JSON error: the status says enough.
  }
  return response.status === 429
    ? "Too many questions at once. Wait a moment and try again."
    : "StockPilot couldn't answer just now. Please try again.";
}

function loadMessages(): ChatMessage[] {
  try {
    const saved: unknown = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "null");
    if (!Array.isArray(saved)) return [];
    // An answer saved while it was arriving was cut off by the reload.
    return saved.filter(isMessage).map((message) => (message.role === "model" && message.status === "streaming" ? { ...message, status: "stopped" } : message));
  } catch {
    // Storage unavailable or unreadable: start empty.
    return [];
  }
}

const listeners = new Set<() => void>();
let state: ChatState | null = null;
let controller: AbortController | null = null;

function get(): ChatState {
  state ??= { messages: loadMessages(), open: false, unread: false };
  return state;
}

function update(patch: Partial<ChatState>): void {
  const previous = get();
  state = { ...previous, ...patch };
  if (patch.messages && patch.messages !== previous.messages) {
    try {
      if (patch.messages.length) window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(patch.messages.slice(-MAX_STORED)));
      else window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // The conversation still works for this visit.
    }
  }
  for (const listener of listeners) listener();
}

function updateAnswer(id: string, change: (answer: AnswerMessage) => AnswerMessage): void {
  update({ messages: get().messages.map((message) => (message.id === id && message.role === "model" ? change(message) : message)) });
}

function busy(): boolean {
  const last = get().messages.at(-1);
  return last?.role === "model" && last.status === "streaming";
}

async function ask(question: string, context: ChatContext, history: ChatMessage[]): Promise<void> {
  const user: UserMessage = { id: newId(), role: "user", text: question, context };
  const answer: AnswerMessage = { id: newId(), role: "model", text: "", tools: [], status: "streaming" };
  update({ messages: [...history, user, answer] });

  const current = new AbortController();
  controller = current;
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: toTurns([...history, user]), symbol: context.symbol, page: context.page }),
      signal: current.signal,
    });
    if (!response.ok || !response.body) {
      const error = await responseError(response);
      updateAnswer(answer.id, (message) => ({ ...message, status: "error", error }));
      return;
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    const events = createEventReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const batch = events.push(value);
      // One update per network chunk, however many events it carried.
      if (batch.length) updateAnswer(answer.id, (message) => applyEvents(message, batch));
    }
    const rest = events.flush();
    updateAnswer(answer.id, (message) => {
      const finished = applyEvents(message, rest);
      if (finished.status !== "streaming") return finished;
      return finished.text.trim()
        ? { ...finished, status: "done" }
        : { ...finished, status: "error", error: "No answer came back. Please try again." };
    });
  } catch {
    updateAnswer(answer.id, (message) => (current.signal.aborted
      ? { ...message, status: "stopped" }
      : { ...message, status: "error", error: message.error ?? "The connection to StockPilot was lost. Please try again." }));
  } finally {
    if (controller === current) controller = null;
    // Answered while the panel was closed: the button shows a dot until it's opened.
    if (!get().open && !current.signal.aborted) update({ unread: true });
  }
}

export const chatStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get,
  // The server renders the button closed, with no conversation; the browser fills it in after hydration.
  serverState(): ChatState {
    return SERVER_STATE;
  },
  setOpen(open: boolean): void {
    update(open ? { open, unread: false } : { open });
  },
  send(text: string, context: ChatContext): void {
    const question = text.trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!question || busy()) return;
    void ask(question, context, get().messages);
  },
  stop(): void {
    controller?.abort();
  },
  // Asks the question before a failed answer again, from where it was first asked.
  retry(answerId: string): void {
    if (busy()) return;
    const all = get().messages;
    const index = all.findIndex((message) => message.id === answerId);
    const question = all[index - 1];
    if (index < 1 || question.role !== "user") return;
    void ask(question.text, question.context ?? { symbol: null, page: null }, all.slice(0, index - 1));
  },
  clear(): void {
    controller?.abort();
    controller = null;
    update({ messages: [], unread: false });
  },
};
