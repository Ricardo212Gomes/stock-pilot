import { describe, expect, it } from "vitest";
import { createEventReader, isChatEvent } from "./protocol";

describe("createEventReader", () => {
  it("reads events cut across chunks and skips lines it doesn't know", () => {
    const reader = createEventReader();
    expect(reader.push('{"type":"text","te')).toEqual([]);
    expect(reader.push('xt":"Hi"}\n{"type":"mystery"}\nnot json\n{"type":"notice",')).toEqual([{ type: "text", text: "Hi" }]);
    expect(reader.push('"text":"Cut off."}')).toEqual([]);
    expect(reader.flush()).toEqual([{ type: "notice", text: "Cut off." }]);
  });
});

describe("isChatEvent", () => {
  it("checks each event's fields", () => {
    expect(isChatEvent({ type: "tool", id: "0-0", label: "AAPL news", href: "/news?symbol=AAPL", status: "done" })).toBe(true);
    expect(isChatEvent({ type: "tool", id: "0-0", label: "Market events", href: null, status: "running" })).toBe(true);
    expect(isChatEvent({ type: "tool", id: "0-0", label: "x", href: null, status: "maybe" })).toBe(false);
    expect(isChatEvent({ type: "error" })).toBe(false);
    expect(isChatEvent("text")).toBe(false);
  });
});
