"use client";

import { useMemo, useState } from "react";
import { SparkIcon } from "../components/spark-icon";
import { compareEvents, countdown, daysBetween, EVENT_CATEGORIES, PAST_DAYS, type EventCategory, type MarketEvent } from "@/lib/market-events";
import { findNewsEvents } from "./actions";

type Range = "3m" | "12m" | "all";

const RANGES: { id: Range; label: string; months: number | null }[] = [
  { id: "3m", label: "3 months", months: 3 },
  { id: "12m", label: "12 months", months: 12 },
  { id: "all", label: "All", months: null },
];

// One outline icon per category, beside its name, so the category never rests on the icon alone.
const CATEGORY_ICONS: Record<EventCategory, string> = {
  fed: "M3 8h14L10 3.5 3 8ZM5 8v6.5M8.3 8v6.5M11.7 8v6.5M15 8v6.5M3 16.5h14",
  data: "M3.5 16.5h13M5 14V9.5M8.5 14V5.5M12 14v-3M15.5 14V7.5",
  politics: "M4 9.5h12v7H4zM7 9.5v-3h6v3M8.5 12.5h3",
  global: "M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM3.5 10h13M10 3.5c1.8 1.8 2.7 4 2.7 6.5s-.9 4.7-2.7 6.5M10 3.5C8.2 5.3 7.3 7.5 7.3 10s.9 4.7 2.7 6.5",
};

function CategoryIcon({ category }: { category: EventCategory }) {
  return (
    <svg className="event-category-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d={CATEGORY_ICONS[category]} />
    </svg>
  );
}

function parseDay(isoDay: string): Date {
  return new Date(`${isoDay}T12:00:00Z`);
}

function format(isoDay: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(parseDay(isoDay));
}

function monthsAhead(today: string, months: number): string {
  const date = parseDay(today);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

// A month-only event stays upcoming until its month is over.
function isPast(event: MarketEvent, today: string): boolean {
  if (event.monthOnly) return event.date.slice(0, 7) < today.slice(0, 7);
  return (event.endDate ?? event.date) < today;
}

type NewsState =
  | { status: "idle" | "pending" }
  | { status: "done"; events: MarketEvent[]; headlines: number }
  | { status: "error"; message: string };

function EventRow({ event, today }: { event: MarketEvent; today: string }) {
  const past = isPast(event, today);
  const category = EVENT_CATEGORIES.find((item) => item.id === event.category)!;
  const days = daysBetween(today, event.date);
  return (
    <li className={`event-row${past ? " event-past" : ""}${event.importance === "high" ? " event-high" : ""}`}>
      <time className="event-date" dateTime={event.monthOnly ? event.date.slice(0, 7) : event.date}>
        {event.monthOnly ? (
          <span className="event-weekday">Date not set</span>
        ) : (
          <>
            <span className="event-weekday">{format(event.date, { weekday: "short" })}</span>
            <span className="event-day">{format(event.date, { day: "numeric" })}</span>
          </>
        )}
      </time>
      <span className="event-marker" aria-hidden="true" />
      <div className="event-body">
        <p className="event-meta">
          <span className="event-category"><CategoryIcon category={event.category} />{category.label}</span>
          {event.time && <span>{event.time} ET</span>}
          {event.endDate && <span>Until {format(event.endDate, { month: "short", day: "numeric" })}</span>}
          {event.importance === "high" && <span className="event-badge">High impact</span>}
          {event.tags.map((tag) => <span key={tag} className="event-tag">{tag}</span>)}
          {!event.monthOnly && !past && days <= 30 && <span className="event-countdown">{countdown(today, event.date)}</span>}
        </p>
        <h4 className="event-title">{event.title}</h4>
        {event.detail && <p className="event-detail">{event.detail}</p>}
        {event.outcome && <p className="event-outcome">Decision: {event.outcome}</p>}
        <p className="event-source">
          {event.ai && <><SparkIcon className="event-ai-icon" />Found by AI in </>}
          <a href={event.source.url} target="_blank" rel="noopener noreferrer">{event.source.label}</a>
        </p>
      </div>
    </li>
  );
}

export function EventsTimeline({
  events,
  today,
  aiConfigured,
  initialNews,
}: {
  events: MarketEvent[];
  today: string;
  aiConfigured: boolean;
  // A scan from the last few hours, shown without asking again.
  initialNews: { events: MarketEvent[]; headlines: number } | null;
}) {
  const [categories, setCategories] = useState<Set<EventCategory>>(() => new Set(EVENT_CATEGORIES.map((category) => category.id)));
  const [range, setRange] = useState<Range>("3m");
  const [highOnly, setHighOnly] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [news, setNews] = useState<NewsState>(initialNews ? { status: "done", ...initialNews } : { status: "idle" });

  const all = useMemo(
    () => [...events, ...(news.status === "done" ? news.events : [])].sort(compareEvents),
    [events, news],
  );
  const months = RANGES.find((item) => item.id === range)!.months;
  const until = months === null ? null : monthsAhead(today, months);
  // Filters other than the category, so each category button can count what it would show.
  const inView = all.filter((event) =>
    (showPast || !isPast(event, today))
    && (until === null || event.date <= until)
    && (!highOnly || event.importance === "high"));
  const visible = inView.filter((event) => categories.has(event.category));

  const groups = new Map<string, MarketEvent[]>();
  for (const event of visible) {
    const key = event.date.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }

  function toggle(category: EventCategory) {
    setCategories((current) => {
      const next = new Set(current);
      if (next.has(category) && next.size > 1) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  function scan() {
    setNews({ status: "pending" });
    findNewsEvents()
      .then((result) => setNews(result.ok
        ? { status: "done", events: result.events, headlines: result.headlines }
        : { status: "error", message: result.error }))
      .catch(() => setNews({ status: "error", message: "The news scan failed to run. Please try again." }));
  }

  return (
    <section className="events-card" aria-labelledby="events-heading">
      <div className="events-heading">
        <h2 id="events-heading">Timeline</h2>
        {aiConfigured && (
          <button type="button" className="ai-analysis-button" onClick={scan} disabled={news.status === "pending"}>
            <SparkIcon />
            <span>{news.status === "pending" ? "Reading the news…" : news.status === "done" ? "Scan again" : "Find events in the news"}</span>
          </button>
        )}
      </div>

      <div className="events-toolbar">
        <div className="events-filters" role="group" aria-label="Categories">
          {EVENT_CATEGORIES.map((category) => {
            const count = inView.filter((event) => event.category === category.id).length;
            return (
              <button
                key={category.id}
                type="button"
                className="events-filter"
                aria-pressed={categories.has(category.id)}
                onClick={() => toggle(category.id)}
              >
                <CategoryIcon category={category.id} />
                {category.label}
                <span className="events-filter-count">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="events-options">
          <div className="chart-view-switch" role="group" aria-label="How far ahead">
            {RANGES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={range === item.id ? "chart-view-active" : ""}
                aria-pressed={range === item.id}
                onClick={() => setRange(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="events-check">
            <input type="checkbox" checked={highOnly} onChange={(event) => setHighOnly(event.target.checked)} />
            High impact only
          </label>
          <label className="events-check">
            <input type="checkbox" checked={showPast} onChange={(event) => setShowPast(event.target.checked)} />
            Last {PAST_DAYS} days
          </label>
        </div>
      </div>

      {news.status === "pending" && <p className="ai-analysis-status" role="status">Reading two weeks of headlines for dated events…</p>}
      {news.status === "done" && (
        <p className="ai-analysis-status" role="status">
          {news.events.length === 0
            ? `No dated events turned up in ${news.headlines} recent headlines.`
            : `Added ${news.events.length} event${news.events.length === 1 ? "" : "s"} found in ${news.headlines} headlines from the last two weeks. AI can misread a headline: check each against its source.`}
        </p>
      )}
      {news.status === "error" && <p className="ai-analysis-error" role="alert">{news.message}</p>}

      {groups.size === 0 ? (
        <p className="events-empty">No events match these filters.</p>
      ) : (
        [...groups].map(([month, items]) => (
          <section key={month} className="events-month" aria-label={format(`${month}-01`, { month: "long", year: "numeric" })}>
            <h3>{format(`${month}-01`, { month: "long", year: "numeric" })}</h3>
            <ol className="events-list">
              {items.map((event) => <EventRow key={event.id} event={event} today={today} />)}
            </ol>
          </section>
        ))
      )}
    </section>
  );
}
