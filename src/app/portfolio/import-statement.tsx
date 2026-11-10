"use client";

import { useState, useTransition } from "react";
import { importStatementAction, previewStatementAction, type ImportPreview } from "./actions";
import { ImportPreviewPanel } from "./import-preview";

// Imports a broker's statement (Trading 212's or Trade Republic's): the PDF is read on the server and shown here as what would be
// added, and nothing is saved until the import is confirmed.
export function ImportStatement({ startOpen = false }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [switchCurrency, setSwitchCurrency] = useState(true);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  // A new key empties the file input, so the same file can be chosen again.
  const [inputKey, setInputKey] = useState(0);
  const [pending, startTransition] = useTransition();

  function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0] ?? null;
    setFile(chosen);
    setPreview(null);
    setStatus(null);
    if (!chosen) return;
    const data = new FormData();
    data.set("statement", chosen);
    startTransition(async () => {
      try {
        const result = await previewStatementAction(data);
        if (result.ok) setPreview(result.preview);
        else setStatus({ ok: false, text: result.error });
      } catch {
        setStatus({ ok: false, text: "The statement couldn't be sent. Please try again." });
      }
    });
  }

  function confirm() {
    if (!file || !preview) return;
    const data = new FormData();
    data.set("statement", file);
    if (switchCurrency && preview.currency !== preview.portfolioCurrency) data.set("currency", preview.currency);
    startTransition(async () => {
      try {
        const result = await importStatementAction(data);
        if (!result.ok) {
          setStatus({ ok: false, text: result.error });
          return;
        }
        setStatus({ ok: true, text: result.message });
        setPreview(null);
        setFile(null);
        setInputKey((key) => key + 1);
      } catch {
        setStatus({ ok: false, text: "That didn't work. Please try again." });
      }
    });
  }

  function cancel() {
    setPreview(null);
    setFile(null);
    setStatus(null);
    setInputKey((key) => key + 1);
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="portfolio-import-toggle">
        <button type="button" className="settings-button settings-button-quiet" onClick={() => setOpen(true)}>Import a statement</button>
        {status?.ok && <p className="settings-status" role="status">{status.text}</p>}
      </div>
    );
  }

  return (
    <section className="portfolio-import" aria-labelledby="portfolio-import-heading">
      <h3 id="portfolio-import-heading">Import a broker statement</h3>
      <p>
        Choose a PDF covering the time since you opened the account: from Trading 212, an activity statement (History,
        then Statements); from Trade Republic, an account statement. Every trade is read from it, with the dividends and
        interest, so the profit is all there. Import one from each broker to see both together. Nothing is saved until
        you confirm.
      </p>
      <label className="portfolio-import-file">
        <span className="visually-hidden">Broker statement (PDF)</span>
        <input key={inputKey} type="file" accept="application/pdf,.pdf" onChange={choose} disabled={pending} />
      </label>
      {pending && <p className="portfolio-import-pending" role="status">{preview ? "Importing…" : "Reading the statement…"}</p>}
      {preview && !pending && (
        <ImportPreviewPanel preview={preview} switchCurrency={switchCurrency} onSwitchCurrency={setSwitchCurrency} onConfirm={confirm} onCancel={cancel} />
      )}
      {status && <p className={status.ok ? "settings-status" : "ai-analysis-error"} role={status.ok ? "status" : "alert"}>{status.text}</p>}
      {!preview && !pending && (
        <button type="button" className="portfolio-import-close" onClick={cancel}>Close</button>
      )}
    </section>
  );
}
