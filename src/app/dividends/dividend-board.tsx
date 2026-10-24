"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CompanyLogo } from "../components/company-logo";
import type { DividendDay, DividendEvent } from "@/lib/dividend-calendar";

function money(value: number | null): string {
  return value === null ? "—" : `$${value < 1 ? value.toFixed(3).replace(/0$/, "") : value.toFixed(2)}`;
}

function longDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${iso}T12:00:00Z`));
}

function Details({ event, onClose }: { event: DividendEvent | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (event && !dialog.current?.open) dialog.current?.showModal();
    if (!event && dialog.current?.open) dialog.current.close();
  }, [event]);

  return (
    <dialog
      ref={dialog}
      className="earnings-dialog"
      onClose={onClose}
      // A click on the backdrop lands on the dialog element itself.
      onClick={(click) => { if (click.target === dialog.current) onClose(); }}
      aria-labelledby="dividend-dialog-title"
    >
      {event && (
        <div className="earnings-dialog-body">
          <div className="earnings-dialog-heading">
            <span className="earnings-logo-box"><CompanyLogo symbol={event.symbol} /></span>
            <div>
              <h2 id="dividend-dialog-title">{event.symbol}</h2>
              {event.name && <p>{event.name}</p>}
            </div>
            <button type="button" className="ai-review-close" onClick={onClose} aria-label="Close">×</button>
          </div>
          <dl className="earnings-dialog-figures">
            <div><dt>Dividend</dt><dd>{money(event.dividend)}{event.frequency && <span className="dividend-frequency"> {event.frequency.toLowerCase()}</span>}</dd></div>
            <div><dt>Yield</dt><dd>{event.yieldPercent === null ? "—" : `${event.yieldPercent.toFixed(2)}%`}</dd></div>
            <div><dt>Annual dividend</dt><dd>{money(event.annualDividend)}</dd></div>
            <div><dt>Declared</dt><dd>{longDate(event.declarationDate)}</dd></div>
            <div>
              <dt><span className="stat-term" title="Buy before this date to receive the dividend.">Ex-dividend date</span></dt>
              <dd>{longDate(event.exDate)}</dd>
            </div>
            <div><dt>Record date</dt><dd>{longDate(event.recordDate)}</dd></div>
            <div><dt>Payment date</dt><dd>{longDate(event.paymentDate)}</dd></div>
          </dl>
          <Link className="earnings-dialog-link" href={`/stock?symbol=${encodeURIComponent(event.symbol)}`}>
            View {event.symbol} overview →
          </Link>
        </div>
      )}
    </dialog>
  );
}

export function DividendBoard({ weeks, today }: { weeks: DividendDay[][]; today: string }) {
  const [selected, setSelected] = useState<DividendEvent | null>(null);
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri"];

  return (
    <>
      <div className="dividend-month" role="grid" aria-label="Dividend calendar">
        <div className="dividend-weekdays" role="row">
          {weekdays.map((day) => <span role="columnheader" key={day}>{day}</span>)}
        </div>
        {weeks.map((week) => (
          <div className="dividend-week" role="row" key={week[0].date}>
            {week.map((day) => {
              const isToday = day.date === today;
              const label = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" })
                .format(new Date(`${day.date}T12:00:00Z`));
              return (
                <div
                  key={day.date}
                  role="gridcell"
                  aria-label={`${label}: ${day.events.length} ${day.events.length === 1 ? "dividend" : "dividends"}`}
                  className={`dividend-day${day.inMonth ? "" : " dividend-day-outside"}${day.events.length === 0 ? " dividend-day-empty" : ""}`}
                >
                  <span className={`dividend-day-number${isToday ? " earnings-today-date" : ""}`}>
                    <span className="dividend-day-weekday">{label.split(",")[0]} </span>{Number(day.date.slice(8))}
                  </span>
                  <div className="dividend-tiles">
                    {day.events.map((event) => (
                      <button
                        key={`${event.symbol}-${event.exDate}`}
                        type="button"
                        className="earnings-tile dividend-tile"
                        onClick={() => setSelected(event)}
                        title={event.name ?? event.symbol}
                      >
                        <span className="earnings-logo-box"><CompanyLogo symbol={event.symbol} /></span>
                        <span className="earnings-tile-symbol">{event.symbol}</span>
                        <span className="dividend-amount">{money(event.dividend)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <Details event={selected} onClose={() => setSelected(null)} />
    </>
  );
}
