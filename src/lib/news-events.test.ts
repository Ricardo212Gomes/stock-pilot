import { describe, expect, it } from "vitest";
import { parseNewsEvents, parseNewsRss, type Headline } from "./news-events";

describe("parseNewsRss", () => {
  it("reads each item, dropping the publisher from the title", () => {
    const xml = `<rss><channel>
      <item><title>OPEC+ to meet on Nov. 29 to set 2027 quotas - Reuters</title><link>https://news.google.com/rss/articles/abc</link>
        <pubDate>Fri, 06 Nov 2026 14:00:00 GMT</pubDate><source url="https://www.reuters.com">Reuters</source></item>
      <item><title>Trump &amp; Xi to meet in April - AP News</title><link>javascript:alert(1)</link><pubDate>Fri, 06 Nov 2026 14:00:00 GMT</pubDate></item>
    </channel></rss>`;
    expect(parseNewsRss(xml, "g0-")).toEqual([
      { id: "g0-0", title: "OPEC+ to meet on Nov. 29 to set 2027 quotas", summary: "", date: "2026-11-06", source: "Reuters", url: "https://news.google.com/rss/articles/abc" },
    ]);
  });
});

describe("parseNewsEvents", () => {
  const headlines: Headline[] = [
    { id: "h1", title: "OPEC+ to meet on Nov. 29", summary: "", date: "2026-11-06", source: "Reuters", url: "https://example.com/opec" },
    { id: "h2", title: "EU leaders aim to appoint new ECB chief in December", summary: "", date: "2026-11-04", source: "Reuters", url: "https://example.com/ecb" },
    { id: "h3", title: "No link", summary: "", date: "2026-11-04", source: null, url: null },
  ];
  const answer = (events: unknown[]) => JSON.stringify({ events });

  it("keeps dated events from headlines we sent and links each to its source", () => {
    const events = parseNewsEvents(answer([
      { date: "2026-11-29", endDate: "", title: "OPEC+ meeting on 2027 quotas", kind: "energy", importance: "high", why: "Output targets move oil prices.", sourceId: "h1" },
      { date: "2026-12-01", monthOnly: true, title: "EU leaders pick a new ECB president", kind: "geopolitics", importance: "medium", why: "A new chief can shift euro rates.", sourceId: "h2" },
    ]), headlines, "2026-11-07")!;
    expect(events.map((event) => [event.date, event.monthOnly, event.category, event.importance, event.tags, event.source, event.ai])).toEqual([
      ["2026-11-29", false, "global", "high", ["Energy"], { label: "Reuters", url: "https://example.com/opec" }, true],
      ["2026-12-01", true, "global", "medium", ["Geopolitics"], { label: "Reuters", url: "https://example.com/ecb" }, true],
    ]);
  });

  it("drops past, far-off, unsourced, unlinked and duplicate events", () => {
    const events = parseNewsEvents(answer([
      { date: "2026-11-01", title: "Already happened", kind: "trade", importance: "medium", why: "", sourceId: "h1" },
      { date: "2026-10-01", monthOnly: true, title: "Last month", kind: "trade", importance: "medium", why: "", sourceId: "h1" },
      { date: "2028-06-01", title: "Too far", kind: "trade", importance: "medium", why: "", sourceId: "h1" },
      { date: "2026-12-01", title: "Made-up source", kind: "trade", importance: "medium", why: "", sourceId: "nope" },
      { date: "2026-12-01", title: "No link", kind: "trade", importance: "medium", why: "", sourceId: "h3" },
      { date: "2026-13-45", title: "Bad date", kind: "trade", importance: "medium", why: "", sourceId: "h1" },
      { date: "2026-11-29", title: "OPEC+ meeting", kind: "energy", importance: "medium", why: "", sourceId: "h1" },
      { date: "2026-11-29", title: "OPEC+ Meeting", kind: "energy", importance: "medium", why: "", sourceId: "h1" },
      // This month still counts while it lasts.
      { date: "2026-11-01", monthOnly: true, title: "Later this month", kind: "us-politics", importance: "medium", why: "", sourceId: "h1" },
    ]), headlines, "2026-11-07")!;
    expect(events.map((event) => [event.title, event.category])).toEqual([
      ["OPEC+ meeting", "global"],
      ["Later this month", "politics"],
    ]);
  });

  it("returns null when the answer isn't JSON", () => {
    expect(parseNewsEvents("Sorry, I can't help.", headlines, "2026-11-07")).toBeNull();
  });
});
