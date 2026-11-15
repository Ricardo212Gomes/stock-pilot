"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { badgeLabel, KIND_LABEL, notificationHref, timeAgo } from "@/lib/notification-kinds";
import { markAllReadAction, markReadAction, refreshBellAction, type BellItem, type BellState } from "../notifications/inbox-actions";
import { NotificationIcon } from "./notification-icon";

// The bell's button and panel, like the account menu: the latest 10, unread in bold. Opening it refreshes the list;
// a notification opens its page and is marked as read.
export function NotificationBellPanel({ initial }: { initial: Extract<BellState, { ok: true }> }) {
  const router = useRouter();
  const details = useRef<HTMLDetailsElement>(null);
  const [state, setState] = useState(initial);
  const [, startTransition] = useTransition();
  const [now, setNow] = useState<number | null>(null);
  const badge = badgeLabel(state.unread);

  // A new page brings a new count.
  const [seen, setSeen] = useState(initial);
  if (initial !== seen) {
    setSeen(initial);
    setState(initial);
  }

  // Close on a click outside or Escape, as the account menu does.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (details.current?.open && !details.current.contains(event.target as Node)) details.current.open = false;
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && details.current?.open) {
        details.current.open = false;
        details.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  function onToggle() {
    if (!details.current?.open) return;
    setNow(Date.now());
    startTransition(async () => {
      const fresh = await refreshBellAction();
      if (fresh.ok) setState(fresh);
    });
  }

  function open(item: BellItem) {
    if (details.current) details.current.open = false;
    if (!item.read) {
      setState((current) => ({
        ...current,
        unread: Math.max(0, current.unread - 1),
        items: current.items.map((other) => (other.id === item.id ? { ...other, read: true } : other)),
      }));
      startTransition(async () => {
        await markReadAction([item.id]);
      });
    }
  }

  function readAll() {
    setState((current) => ({ ...current, unread: 0, items: current.items.map((item) => ({ ...item, read: true })) }));
    startTransition(async () => {
      await markAllReadAction();
      router.refresh();
    });
  }

  const label = badge ? `Notifications, ${state.unread} unread` : "Notifications";
  return (
    <details className="notification-bell" ref={details} onToggle={onToggle}>
      <summary aria-label={label} title="Notifications">
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M10 3.25a4.5 4.5 0 0 0-4.5 4.5v2.6c0 .7-.25 1.38-.7 1.9L4 13.25h12l-.8-1a2.97 2.97 0 0 1-.7-1.9v-2.6A4.5 4.5 0 0 0 10 3.25ZM8.25 15.5a1.85 1.85 0 0 0 3.5 0" />
        </svg>
        {badge && <span className="notification-badge" aria-hidden="true">{badge}</span>}
      </summary>
      <div className="notification-panel">
        <div className="notification-panel-heading">
          <strong>Notifications</strong>
          {state.unread > 0 && <button type="button" className="text-button" onClick={readAll}>Mark all as read</button>}
        </div>
        {state.items.length === 0 ? (
          <p className="notification-empty">
            Nothing yet. Alerts about your favorites, such as upcoming earnings, call summaries, news and SEC filings, will show up here.
          </p>
        ) : (
          <ul className="notification-list">
            {state.items.map((item) => (
              <li key={item.id}>
                <Link
                  href={notificationHref(item.kind, item.symbols)}
                  className={item.read ? "notification-item" : "notification-item notification-unread"}
                  onClick={() => open(item)}
                >
                  <NotificationIcon kind={item.kind} />
                  <span>
                    <span className="notification-title">{item.title}</span>
                    <small>
                      {KIND_LABEL[item.kind]} · <time dateTime={item.createdAt}>{now === null ? timeAgo(item.createdAt) : timeAgo(item.createdAt, now)}</time>
                    </small>
                  </span>
                  {!item.read && <span className="notification-dot" aria-label="Unread" />}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link className="notification-see-all" href="/notifications" onClick={() => { if (details.current) details.current.open = false; }}>
          See all notifications
        </Link>
      </div>
    </details>
  );
}
