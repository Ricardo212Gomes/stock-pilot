import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, plainText, type Block } from "./markdown";

describe("parseInline", () => {
  it("reads bold, italics, code and line breaks", () => {
    expect(parseInline("**Revenue** rose *fast*, see `TTM`\nnext")).toEqual([
      { type: "strong", children: [{ type: "text", text: "Revenue" }] },
      { type: "text", text: " rose " },
      { type: "em", children: [{ type: "text", text: "fast" }] },
      { type: "text", text: ", see " },
      { type: "code", text: "TTM" },
      { type: "break" },
      { type: "text", text: "next" },
    ]);
  });

  it("leaves arithmetic, snake_case and escaped markers as text", () => {
    expect(parseInline("5 * 3 * 2")).toEqual([{ type: "text", text: "5 * 3 * 2" }]);
    expect(parseInline("free_cash_flow")).toEqual([{ type: "text", text: "free_cash_flow" }]);
    expect(parseInline("\\*not italic\\*")).toEqual([{ type: "text", text: "*not italic*" }]);
  });

  it("links only to StockPilot's own pages", () => {
    expect(parseInline("[Financials](/stock/financials?symbol=AAPL)")).toEqual([
      { type: "link", href: "/stock/financials?symbol=AAPL", children: [{ type: "text", text: "Financials" }] },
    ]);
    expect(parseInline("[click](https://example.com) and [x](//evil.com) and [y](javascript:void)")).toEqual([
      { type: "text", text: "click and x and y" },
    ]);
  });

  it("shows an unfinished marker as typed while an answer streams in", () => {
    expect(parseInline("**Reven")).toEqual([{ type: "text", text: "**Reven" }]);
  });
});

describe("parseMarkdown", () => {
  it("splits paragraphs, headings, rules and code", () => {
    const blocks = parseMarkdown("## Summary\nFirst line\nsecond line\n\n---\n\n```\nconst a = 1;\n```\n\nLast.");
    expect(blocks.map((block) => block.type)).toEqual(["heading", "paragraph", "rule", "code", "paragraph"]);
    expect(blocks[1]).toEqual({ type: "paragraph", content: [{ type: "text", text: "First line" }, { type: "break" }, { type: "text", text: "second line" }] });
    expect(blocks[3]).toEqual({ type: "code", text: "const a = 1;" });
  });

  it("reads bullet and numbered lists, nested items and a list right after a sentence", () => {
    const [intro, list] = parseMarkdown("Highlights:\n* **Revenue:** $10B\n  - up 5%\n* EPS: $2.10");
    expect(intro.type).toBe("paragraph");
    expect(list).toMatchObject({ type: "list", ordered: false, items: [{ children: [{ type: "list", items: [{ content: [{ type: "text", text: "up 5%" }] }] }] }, {}] });
    expect(parseMarkdown("3. Third\n4. Fourth")).toMatchObject([{ type: "list", ordered: true, start: 3 }]);
  });

  it("keeps a list together across blank lines between its items, and ends it before a paragraph", () => {
    const blocks = parseMarkdown("- one\n\n- two\n\nAfter the list.");
    expect(blocks.map((block) => block.type)).toEqual(["list", "paragraph"]);
    expect((blocks[0] as Extract<Block, { type: "list" }>).items).toHaveLength(2);
  });

  it("reads tables, marking columns of figures and long text", () => {
    const [table] = parseMarkdown([
      "| Company | Revenue | Growth | Note |",
      "| :--- | :--- | ---: | --- |",
      "| Apple | $416.2B | +6.4% | Services drove most of the growth this year |",
      "| Microsoft | $281.7B | — | |",
      "| Alphabet | $350.0B |",
    ].join("\n"));
    expect(table).toMatchObject({
      type: "table",
      align: ["left", "left", "right", null],
      numeric: [false, true, true, false],
      wrap: [false, false, false, true],
    });
    // A short row is padded to the header's columns.
    expect((table as Extract<Block, { type: "table" }>).rows[2]).toEqual([[{ type: "text", text: "Alphabet" }], [{ type: "text", text: "$350.0B" }], [], []]);
  });

  it("treats a header without its separator line as text, as it is mid-stream", () => {
    expect(parseMarkdown("| Year | Revenue |")).toEqual([{ type: "paragraph", content: [{ type: "text", text: "| Year | Revenue |" }] }]);
  });
});

describe("plainText", () => {
  it("drops the markers for copying, with tables as tab-separated rows", () => {
    const blocks = parseMarkdown("Apple's **revenue**:\n\n| Year | Revenue |\n| --- | --- |\n| 2025 | $416B |\n\n1. First\n   - inner");
    expect(plainText(blocks)).toBe("Apple's revenue:\n\nYear\tRevenue\n2025\t$416B\n\n1. First\n  • inner");
  });
});
