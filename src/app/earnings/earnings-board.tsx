"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CompanyLogo } from "../components/company-logo";
import { useModalDialog } from "../components/use-modal-dialog";
import type { EarningsDay, EarningsEvent, ReportTime } from "@/lib/earnings-calendar";

// How many tiles a section shows before the "+N" tile.
const VISIBLE_TILES = 11;

const TIME_LABEL: Record<ReportTime, string> = {
  bmo: "Before Open",
  dmh: "During Market",
  amc: "After Close",
  unknown: "Time TBA",
};

function TimeIcon({ time }: { time: ReportTime }) {
  if (time === "amc") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M14.5 12.5A5.5 5.5 0 0 1 7.5 5.5 5.5 5.5 0 1 0 14.5 12.5Z" />
      </svg>
    );
  }
  if (time === "unknown") {
    return (
      <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <circle cx="10" cy="10" r="6.5" />
        <path d="M10 6.5V10l2.5 1.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="10" cy="10" r="3" />
      <path d="M10 3v1.5M10 15.5V17M3 10h1.5M15.5 10H17M5 5l1 1M14 14l1 1M5 15l1-1M14 6l1-1" />
    </svg>
  );
}

function resultTone(event: EarningsEvent): "beat" | "miss" | null {
  if (event.epsSurprise === null) return null;
  return event.epsSurprise >= 0 ? "beat" : "miss";
}

function compact(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
}

function signed(value: number | null): string {
  return value === null ? "" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
}

function Tile({ event, onOpen }: { event: EarningsEvent; onOpen: (event: EarningsEvent) => void }) {
  const tone = resultTone(event);
  return (
    <button
      type="button"
      className="earnings-tile"
      onClick={() => onOpen(event)}
      title={event.name ?? event.symbol}
      aria-label={`${event.symbol}${event.name ? `, ${event.name}` : ""}${tone ? `, ${tone === "beat" ? "beat" : "missed"} the EPS estimate` : ""}`}
    >
      <span className="earnings-logo-box">
        <CompanyLogo symbol={event.symbol} />
        {tone && <span className={`earnings-result earnings-result-${tone}`} aria-hidden="true" />}
      </span>
      <span className="earnings-tile-symbol">{event.symbol}</span>
    </button>
  );
}

function Section({
  time,
  events,
  onOpen,
}: {
  time: ReportTime;
  events: EarningsEvent[];
  onOpen: (event: EarningsEvent) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? events : events.slice(0, VISIBLE_TILES);
  const hidden = events.length - shown.length;
  return (
    <section className="earnings-section" aria-label={TIME_LABEL[time]}>
      <h3 className="earnings-section-heading"><TimeIcon time={time} />{TIME_LABEL[time]}</h3>
      <div className="earnings-tiles">
        {shown.map((event) => <Tile key={event.symbol} event={event} onOpen={onOpen} />)}
        {hidden > 0 && (
          <button type="button" className="earnings-tile earnings-more" onClick={() => setExpanded(true)} aria-label={`Show ${hidden} more`}>
            +{hidden}
          </button>
        )}
      </div>
    </section>
  );
}

function Details({ event: selected, onClose }: { event: EarningsEvent | null; onClose: () => void }) {
  const { dialog, shown: event } = useModalDialog(selected);

  return (
    <dialog
      ref={dialog}
      className="earnings-dialog"
      onClose={onClose}
      // A click on the backdrop lands on the dialog element itself.
      onClick={(click) => { if (click.target === dialog.current) onClose(); }}
      aria-labelledby="earnings-dialog-title"
    >
      {event && (
        <div className="earnings-dialog-body">
          <div className="earnings-dialog-heading">
            <span className="earnings-logo-box"><CompanyLogo symbol={event.symbol} /></span>
            <div>
              <h2 id="earnings-dialog-title">{event.symbol}</h2>
              {event.name && <p>{event.name}</p>}
            </div>
            <button type="button" className="ai-review-close" onClick={onClose} aria-label="Close">×</button>
          </div>
          <p className="earnings-dialog-when">
            {new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${event.date}T12:00:00Z`))}
            {" · "}{TIME_LABEL[event.time]}
            {event.quarter && event.year ? ` · Q${event.quarter} ${event.year}` : ""}
          </p>
          <dl className="earnings-dialog-figures">
            <div><dt>EPS estimate</dt><dd>{event.epsEstimate === null ? "—" : event.epsEstimate.toFixed(2)}</dd></div>
            <div>
              <dt>EPS actual</dt>
              <dd>
                {event.epsActual === null ? "Not reported yet" : event.epsActual.toFixed(2)}
                {event.epsSurprise !== null && <span className={event.epsSurprise >= 0 ? "positive-value" : "negative-value"}> {signed(event.epsSurprise)}</span>}
              </dd>
            </div>
            <div><dt>Revenue estimate</dt><dd>{compact(event.revenueEstimate)}</dd></div>
            <div>
              <dt>Revenue actual</dt>
              <dd>
                {event.revenueActual === null ? "Not reported yet" : compact(event.revenueActual)}
                {event.revenueSurprise !== null && <span className={event.revenueSurprise >= 0 ? "positive-value" : "negative-value"}> {signed(event.revenueSurprise)}</span>}
              </dd>
            </div>
          </dl>
          <Link className="earnings-dialog-link" href={`/stock?symbol=${encodeURIComponent(event.symbol)}`}>
            View {event.symbol} overview →
          </Link>
        </div>
      )}
    </dialog>
  );
}

export function EarningsBoard({
  days,
  today,
  rangeLabel,
  summary,
  previousHref,
  nextHref,
  currentHref,
  currentLabel,
  largeHref,
  allHref,
  all,
}: {
  days: EarningsDay[];
  today: string;
  rangeLabel: string;
  summary: string;
  previousHref: string;
  nextHref: string;
  currentHref: string | null;
  currentLabel: string;
  largeHref: string;
  allHref: string;
  all: boolean;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<EarningsEvent | null>(null);
  const todayParts = new Date(`${today}T12:00:00Z`);

  // Search narrows every section to matching tickers or company names.
  const visibleDays = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return days;
    return days.map((day) => {
      const groups = day.groups
        .map((group) => ({
          ...group,
          events: group.events.filter((event) =>
            event.symbol.toLowerCase().includes(term) || event.name?.toLowerCase().includes(term)),
        }))
        .filter((group) => group.events.length > 0);
      return { ...day, groups, count: groups.reduce((sum, group) => sum + group.events.length, 0) };
    });
  }, [days, query]);

  return (
    <>
      <div className="earnings-bar">
        <div className="earnings-bar-nav">
          <Link href={previousHref} className="earnings-round" aria-label="Previous week">‹</Link>
          {currentHref ? (
            <Link href={currentHref} className="earnings-round earnings-date-chip" aria-label={currentLabel} title={currentLabel}>
              <span>{new Intl.DateTimeFormat("en-US", { weekday: "narrow", timeZone: "UTC" }).format(todayParts)}</span>
              <strong>{todayParts.getUTCDate()}</strong>
            </Link>
          ) : (
            <span className="earnings-round earnings-date-chip" aria-hidden="true">
              <span>{new Intl.DateTimeFormat("en-US", { weekday: "narrow", timeZone: "UTC" }).format(todayParts)}</span>
              <strong>{todayParts.getUTCDate()}</strong>
            </span>
          )}
          <Link href={nextHref} className="earnings-round" aria-label="Next week">›</Link>
          <div className="earnings-bar-title">
            <p className="section-label">EARNINGS THIS WEEK</p>
            <strong>{rangeLabel}</strong>
          </div>
        </div>
        <div className="earnings-bar-tools">
          <nav className="chart-view-switch" aria-label="Companies shown">
            <Link href={largeHref} className={!all ? "chart-view-active" : ""} aria-current={!all ? "page" : undefined}>Large</Link>
            <Link href={allHref} className={all ? "chart-view-active" : ""} aria-current={all ? "page" : undefined}>All</Link>
          </nav>
          <label className="earnings-search">
            <span className="visually-hidden">Search this week&apos;s companies</span>
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="10.8" cy="10.8" r="6.8" />
              <path d="m16 16 4.2 4.2" />
            </svg>
            <input type="search" placeholder="Search stocks…" value={query} onChange={(change) => setQuery(change.target.value)} />
          </label>
        </div>
      </div>

      <p className="earnings-summary">{summary}</p>

      <div className="earnings-grid" style={{ ["--earnings-days" as string]: visibleDays.length }}>
        {visibleDays.map((day) => {
          const date = new Date(`${day.date}T12:00:00Z`);
          const isToday = day.date === today;
          return (
            <section key={day.date} className="earnings-column" aria-label={new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" }).format(date)}>
              <div className="earnings-column-heading">
                <span>{new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(date)}</span>
                <strong className={isToday ? "earnings-today-date" : ""} aria-current={isToday ? "date" : undefined}>
                  {date.getUTCDate()}
                </strong>
              </div>
              {day.groups.length === 0 ? (
                <p className="earnings-empty">{query ? "No matches" : "No reports"}</p>
              ) : day.groups.map((group) => (
                <Section key={`${group.time}-${query}`} time={group.time} events={group.events} onOpen={setSelected} />
              ))}
            </section>
          );
        })}
      </div>

      <Details event={selected} onClose={() => setSelected(null)} />
    </>
  );
}
