import { describe, expect, it } from "vitest";
import { MAX_HISTORY } from "@/lib/chat/protocol";
import { applyEvents, toTurns, type AnswerMessage, type ChatMessage } from "./ai-chat-store";

const answer: AnswerMessage = { id: "a1", role: "model", text: "", tools: [], status: "streaming" };

describe("toTurns", () => {
  it("sends the questions and answers' text, without failed answers, latest first kept", () => {
    const messages: ChatMessage[] = [
      { id: "u1", role: "user", text: "First?" },
      { ...answer, id: "a1", text: "", status: "error", error: "Busy" },
      { id: "u2", role: "user", text: "Again?" },
      { ...answer, id: "a2", text: "Yes.", status: "done" },
    ];
    expect(toTurns(messages)).toEqual([{ role: "user", text: "First?" }, { role: "user", text: "Again?" }, { role: "model", text: "Yes." }]);

    const many = Array.from({ length: 30 }, (_, index): ChatMessage => ({ id: `u${index}`, role: "user", text: `q${index}` }));
    expect(toTurns(many)).toHaveLength(MAX_HISTORY);
    expect(toTurns(many).at(-1)).toEqual({ role: "user", text: "q29" });
  });
});

describe("applyEvents", () => {
  it("adds text, updates each look-up's chip in place, and records notices and errors", () => {
    const next = applyEvents(answer, [
      { type: "tool", id: "0-0", label: "AAPL overview", href: "/stock?symbol=AAPL", status: "running" },
      { type: "text", text: "Apple " },
      { type: "tool", id: "0-0", label: "AAPL overview", href: "/stock?symbol=AAPL", status: "done" },
      { type: "text", text: "is up." },
      { type: "notice", text: "Cut off." },
    ]);
    expect(next).toEqual({
      ...answer,
      text: "Apple is up.",
      tools: [{ id: "0-0", label: "AAPL overview", href: "/stock?symbol=AAPL", status: "done" }],
      notice: "Cut off.",
    });
    expect(applyEvents(next, [{ type: "error", error: "Gemini is busy." }])).toMatchObject({ status: "error", error: "Gemini is busy.", text: "Apple is up." });
    // The message it started from is left as it was.
    expect(answer.text).toBe("");
  });
});
