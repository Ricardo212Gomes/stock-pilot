"use client";

import { useState, useTransition } from "react";
import type { NotificationPreferences } from "@/lib/notification-settings";
import {
  confirmTelegramLinkAction,
  disconnectTelegramAction,
  savePreferencesAction,
  sendTestMessageAction,
  startTelegramLinkAction,
  type SettingsActionResult,
} from "./actions";

type Props = {
  botUsername: string;
  telegramName: string | null;
  pendingLink: string | null;
  initialPreferences: NotificationPreferences;
};

const ALERTS: { key: keyof NotificationPreferences; title: string; detail: string }[] = [
  { key: "earningsAlerts", title: "Upcoming earnings", detail: "Every Monday: which favorites report in the next 7 days, with the time and estimates." },
  { key: "transcriptSummaries", title: "Earnings call summaries", detail: "An AI summary of each favorite's new earnings call, once its transcript is out." },
  { key: "newsAlerts", title: "Relevant news", detail: "Each weekday evening: the headlines about your favorites that matter, picked by AI with a line on why." },
  { key: "filingAlerts", title: "SEC filing analysis", detail: "When a favorite files a 10-K, 10-Q or significant 8-K: an AI analysis of what it says and what to watch." },
];

export function TelegramSettings({ botUsername, telegramName, pendingLink, initialPreferences }: Props) {
  const [link, setLink] = useState(pendingLink);
  // Each card shows its own result.
  const [status, setStatus] = useState<{ card: "telegram" | "alerts"; ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [preferences, setPreferences] = useState(initialPreferences);

  function run(
    card: "telegram" | "alerts",
    action: () => Promise<SettingsActionResult>,
    after?: (result: Extract<SettingsActionResult, { ok: true }>) => void,
  ) {
    setStatus(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) {
          setStatus({ card, ok: false, text: result.error });
          return;
        }
        if (result.message) setStatus({ card, ok: true, text: result.message });
        after?.(result);
      } catch {
        setStatus({ card, ok: false, text: "That didn't work. Please try again." });
      }
    });
  }

  function statusFor(card: "telegram" | "alerts") {
    if (status?.card !== card) return null;
    return <p className={status.ok ? "settings-status" : "ai-analysis-error"} role={status.ok ? "status" : "alert"}>{status.text}</p>;
  }

  function togglePreference(key: keyof typeof preferences) {
    const next = { ...preferences, [key]: !preferences[key] };
    setPreferences(next);
    run("alerts", () => savePreferencesAction(next));
  }

  return (
    <>
      <section className="settings-card" aria-labelledby="telegram-heading">
        <h2 id="telegram-heading">Telegram</h2>
        {telegramName ? (
          <>
            <p className="settings-connected"><span aria-hidden="true">●</span> Connected to <strong>{telegramName}</strong></p>
            <div className="settings-actions">
              <button type="button" className="settings-button" disabled={pending} onClick={() => run("telegram", sendTestMessageAction)}>Send a test message</button>
              <button type="button" className="settings-button settings-button-quiet" disabled={pending} onClick={() => run("telegram", disconnectTelegramAction, () => setLink(null))}>Disconnect</button>
            </div>
          </>
        ) : link ? (
          <ol className="settings-steps">
            <li>
              <a className="settings-button" href={link} target="_blank" rel="noreferrer">Open @{botUsername} in Telegram</a>
            </li>
            <li>Press <strong>Start</strong> in the chat with the bot.</li>
            <li>
              <button type="button" className="settings-button" disabled={pending} onClick={() => run("telegram", confirmTelegramLinkAction)}>
                {pending ? "Checking…" : "I've pressed Start"}
              </button>
            </li>
          </ol>
        ) : (
          <>
            <p>Get your favorites&apos; upcoming earnings, earnings call summaries, relevant news and SEC filing analyses in Telegram.</p>
            <button type="button" className="settings-button" disabled={pending} onClick={() => run("telegram", startTelegramLinkAction, (result) => setLink(result.link ?? null))}>
              Connect Telegram
            </button>
          </>
        )}
        {statusFor("telegram")}
      </section>

      <section className="settings-card" aria-labelledby="alerts-heading">
        <h2 id="alerts-heading">What to send</h2>
        {ALERTS.map((alert) => (
          <label className="settings-toggle" key={alert.key}>
            <input type="checkbox" checked={preferences[alert.key]} disabled={pending} onChange={() => togglePreference(alert.key)} />
            <span>
              <strong>{alert.title}</strong>
              <small>{alert.detail}</small>
            </span>
          </label>
        ))}
        {statusFor("alerts")}
      </section>
    </>
  );
}
