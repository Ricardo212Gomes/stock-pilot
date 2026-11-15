import { describe, expect, it } from "vitest";
import { decodeEntities, parseTelegramHtml, plainText, safeHref } from "./telegram-html";

describe("parseTelegramHtml", () => {
  it("keeps bold, italics and links, and decodes escaped text", () => {
    expect(parseTelegramHtml('📅 <b>Earnings</b> for <a href="https://example.com/a?x=1&amp;y=2">AT&amp;T</a>\n<i>Not advice &lt;ok&gt;</i>')).toEqual([
      { type: "text", text: "📅 " },
      { type: "bold", children: [{ type: "text", text: "Earnings" }] },
      { type: "text", text: " for " },
      { type: "link", href: "https://example.com/a?x=1&y=2", external: true, children: [{ type: "text", text: "AT&T" }] },
      { type: "text", text: "\n" },
      { type: "italic", children: [{ type: "text", text: "Not advice <ok>" }] },
    ]);
  });

  it("nests, and turns links to the app's address into its own paths", () => {
    const nodes = parseTelegramHtml('<a href="https://stockpilot.example/stock?symbol=NVDA"><b>NVDA</b></a>', "https://stockpilot.example/");
    expect(nodes).toEqual([{ type: "link", href: "/stock?symbol=NVDA", external: false, children: [{ type: "bold", children: [{ type: "text", text: "NVDA" }] }] }]);
  });

  it("never keeps a script, an event handler or an unsafe link", () => {
    const nodes = parseTelegramHtml('<script>alert(1)</script><b onclick="x()">Hi</b> <a href="javascript:alert(1)">click</a> <a href="//evil.example">x</a> <img src=x onerror=alert(1)>');
    // Unknown tags stay as visible text; there is no element for them.
    expect(plainText(nodes)).toBe('<script>alert(1)</script>Hi click x <img src=x onerror=alert(1)>');
    const json = JSON.stringify(nodes);
    expect(json).not.toContain('"type":"link"');
    expect(json).not.toContain("onclick");
  });

  it("closes what's left open and drops stray closing tags", () => {
    expect(parseTelegramHtml("<b>open <i>both</b> after</i> end</b>")).toEqual([
      { type: "bold", children: [{ type: "text", text: "open " }, { type: "italic", children: [{ type: "text", text: "both" }] }] },
      { type: "text", text: " after end" },
    ]);
  });
});

describe("safeHref and entities", () => {
  it("allows http(s) and app paths only", () => {
    expect(safeHref("/news?symbol=AAPL")).toEqual({ href: "/news?symbol=AAPL", external: false });
    expect(safeHref("https://www.sec.gov/a.htm")).toMatchObject({ external: true });
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,hi")).toBeNull();
    expect(safeHref("//evil.example/x")).toBeNull();
    expect(safeHref("mailto:a@b.c")).toBeNull();
  });

  it("decodes named and numeric entities", () => {
    expect(decodeEntities("&lt;b&gt; &amp; &#39;x&#x27; &unknown;")).toBe("<b> & 'x' &unknown;");
  });
});
