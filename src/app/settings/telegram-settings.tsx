"use client";

import { useState, useTransition } from "react";
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
  earningsAlerts: boolean;
  transcriptSummaries: boolean;
};

export function TelegramSettings({ botUsername, telegramName, pendingLink, earningsAlerts, transcriptSummaries }: Props) {
  const [link, setLink] = useState(pendingLink);
  // Each card shows its own result.
  const [status, setStatus] = useState<{ card: "telegram" | "alerts"; ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [preferences, setPreferences] = useState({ earningsAlerts, transcriptSummaries });

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
    run("alerts", () => savePreferencesAction(next.earningsAlerts, next.transcriptSummaries));
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
            <p>Get your favorites&apos; upcoming earnings and summaries of their earnings calls in Telegram.</p>
            <button type="button" className="settings-button" disabled={pending} onClick={() => run("telegram", startTelegramLinkAction, (result) => setLink(result.link ?? null))}>
              Connect Telegram
            </button>
          </>
        )}
        {statusFor("telegram")}
      </section>

      <section className="settings-card" aria-labelledby="alerts-heading">
        <h2 id="alerts-heading">What to send</h2>
        <label className="settings-toggle">
          <input type="checkbox" checked={preferences.earningsAlerts} disabled={pending} onChange={() => togglePreference("earningsAlerts")} />
          <span>
            <strong>Upcoming earnings</strong>
            <small>Every Monday: which favorites report in the next 7 days, with the time and estimates.</small>
          </span>
        </label>
        <label className="settings-toggle">
          <input type="checkbox" checked={preferences.transcriptSummaries} disabled={pending} onChange={() => togglePreference("transcriptSummaries")} />
          <span>
            <strong>Earnings call summaries</strong>
            <small>An AI summary of each favorite&apos;s new earnings call, once its transcript is out.</small>
          </span>
        </label>
        {statusFor("alerts")}
      </section>
    </>
  );
}
