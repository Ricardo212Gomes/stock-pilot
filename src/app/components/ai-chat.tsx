"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { memo, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { parseMarkdown, plainText } from "@/lib/chat/markdown";
import { MAX_MESSAGE_LENGTH } from "@/lib/chat/protocol";
import { ChatMarkdown } from "./ai-chat-markdown";
import { chatStore, type AnswerMessage, type ChatContext, type ToolUse } from "./ai-chat-store";
import { SparkIcon } from "./spark-icon";
import { loadStockIndex, type StockIndex } from "./ticker-search";

// The AI chat (see docs/chat.md): a button fixed to the bottom right of every page, opening a panel over it.
// It lives in the root layout, so it stays open, with its draft, while the user moves between pages, and it
// tells the server which company and page are on screen.

// The question box grows with the question up to this height, then scrolls.
const MAX_INPUT_HEIGHT = 160;
// Scrolled to within this of the end, the conversation follows new text down.
const BOTTOM_MARGIN = 24;
// Space kept above the latest question when it's scrolled to the top.
const QUESTION_GAP = 12;
const TICKER = /^[A-Z0-9.-]{1,15}$/;
// Where the panel takes the whole screen (the 640px rules in globals.css).
const PHONE = "(max-width: 640px)";

// How the conversation scrolls as an answer arrives: "question" follows it until the question reaches the top, so
// a long answer reads from its start; "bottom" follows it to the end (the user scrolled there); "free" stays put
// (the user scrolled up to read).
type Follow = "question" | "bottom" | "free";

// "Apple Inc." → "Apple", for questions that read naturally.
function shortName(name: string): string {
  return name.replace(/,? (Inc|Corp|Corporation|Company|Co|Holdings|Ltd|plc|Group|Platforms)\.?$/i, "");
}

function suggestionsFor(symbol: string | null, name: string | null): string[] {
  if (symbol) {
    const company = name ?? symbol;
    return [
      `How is ${company} doing? Give me the key figures.`,
      `What do analysts expect from ${company}?`,
      `What did ${company} say on its last earnings call?`,
      `Have ${company}'s insiders been buying or selling?`,
    ];
  }
  return [
    "How have Nvidia's revenue and margins changed over five years?",
    "Compare Microsoft, Alphabet and Amazon on P/E and growth.",
    "Who reports earnings this week?",
    "Is the market fearful right now, and when is the next Fed decision?",
  ];
}

function Icon({ children }: { children: ReactNode }) {
  return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">{children}</svg>;
}

// A chip per look-up, once each: the same page asked for twice shows once.
function Sources({ tools }: { tools: ToolUse[] }) {
  const unique = tools.filter((tool, index) => tools.findIndex((other) => other.label === tool.label && other.href === tool.href) === index);
  if (unique.length === 0) return null;
  return (
    <ul className="ai-chat-sources" aria-label="StockPilot data used">
      {unique.map((tool) => {
        const className = `ai-chat-source ai-chat-source-${tool.status}`;
        return (
          <li key={tool.id}>
            {tool.href && tool.status !== "failed" ? (
              <Link
                className={className}
                href={tool.href}
                title={`Open ${tool.label} in StockPilot`}
                // On a phone the panel covers the page, so it steps aside to show it; elsewhere it stays open beside it.
                onClick={() => {
                  if (window.matchMedia(PHONE).matches) chatStore.setOpen(false);
                }}
              >
                {tool.label}
              </Link>
            ) : (
              <span className={className} title={tool.status === "failed" ? `${tool.label}: couldn't load` : tool.label}>{tool.label}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard refused (an insecure page or a denied permission): nothing to undo.
    }
  }
  return (
    <button type="button" className="ai-chat-copy" onClick={copy} aria-live="polite">
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

const Answer = memo(function Answer({ message }: { message: AnswerMessage }) {
  const blocks = useMemo(() => parseMarkdown(message.text), [message.text]);
  const streaming = message.status === "streaming";
  const running = message.tools.filter((tool) => tool.status === "running");
  let status: string | null = null;
  if (streaming && running.length > 0) status = `Looking up ${running.map((tool) => tool.label).join(", ")}…`;
  else if (streaming && !message.text) status = "Thinking…";

  return (
    <article className="ai-chat-turn ai-chat-answer" aria-busy={streaming} aria-label="Answer">
      <SparkIcon className="ai-chat-answer-icon" />
      <div className="ai-chat-answer-body">
        {blocks.length > 0 && <ChatMarkdown blocks={blocks} />}
        {status && <p className="ai-chat-status">{status}</p>}
        {message.notice && <p className="ai-chat-note">{message.notice}</p>}
        {message.status === "stopped" && <p className="ai-chat-note">{message.text ? "Stopped." : "Stopped before an answer."}</p>}
        {message.status === "error" && (
          <p className="ai-chat-error" role="alert">
            {message.error ?? "Something went wrong."}{" "}
            <button type="button" onClick={() => chatStore.retry(message.id)}>Try again</button>
          </p>
        )}
        <Sources tools={message.tools} />
        {message.status === "done" && message.text && (
          <div className="ai-chat-answer-actions">
            <CopyButton text={plainText(blocks)} />
          </div>
        )}
      </div>
    </article>
  );
});

export function AiChat() {
  const { messages, open, unread } = useSyncExternalStore(chatStore.subscribe, chatStore.get, chatStore.serverState);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams.get("symbol")?.trim().toUpperCase() ?? "";
  const symbol = TICKER.test(raw) ? raw.replace(/\./g, "-") : null;
  const [draft, setDraft] = useState("");
  const [expanded, setExpanded] = useState(false);
  // The bundled stock list, for the company's name; loaded the first time the panel opens.
  const [stocks, setStocks] = useState<StockIndex | null>(null);
  const panelId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const follow = useRef<Follow>("question");
  // The position this component last scrolled to, so its own scrolling isn't taken for the user's.
  const scrolledTo = useRef<number | null>(null);

  const last = messages.at(-1);
  const busy = last?.role === "model" && last.status === "streaming";
  const listed = symbol && stocks ? stocks.find((stock) => stock.symbol === symbol)?.name : undefined;
  const name = listed ? shortName(listed) : null;
  const context: ChatContext = { symbol, page: pathname };

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!open || !scroller || follow.current === "free") return;
    const end = scroller.scrollHeight - scroller.clientHeight;
    let target = end;
    if (follow.current === "question") {
      const questions = scroller.querySelectorAll<HTMLElement>(".ai-chat-question");
      const latest = questions[questions.length - 1];
      if (latest) {
        const top = scroller.scrollTop + latest.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        target = Math.min(end, top - QUESTION_GAP);
      }
    }
    if (Math.abs(scroller.scrollTop - target) > 1) {
      scrolledTo.current = target;
      scroller.scrollTop = target;
    }
  }, [messages, open]);

  function onScroll() {
    const scroller = scrollRef.current;
    if (!scroller) return;
    if (scrolledTo.current !== null && Math.abs(scroller.scrollTop - scrolledTo.current) <= 2) {
      scrolledTo.current = null;
      return;
    }
    follow.current = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - BOTTOM_MARGIN ? "bottom" : "free";
  }

  function resizeInput() {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, MAX_INPUT_HEIGHT)}px`;
  }

  function openPanel() {
    follow.current = "question";
    chatStore.setOpen(true);
    if (!stocks) loadStockIndex().then(setStocks, () => {});
    // A phone would cover half the panel with its keyboard, so only pointer devices start in the question box.
    if (window.matchMedia("(pointer: fine)").matches) requestAnimationFrame(() => inputRef.current?.focus());
  }

  function closePanel() {
    chatStore.setOpen(false);
    launcherRef.current?.focus();
  }

  function send(text: string) {
    if (!text.trim() || busy) return;
    follow.current = "question";
    chatStore.send(text, context);
    setDraft("");
    if (inputRef.current) inputRef.current.style.height = "";
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    send(draft);
  }

  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter starts a new line. Not while an input method is composing a character.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send(draft);
    }
  }

  function onPanelKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !event.nativeEvent.isComposing) {
      event.stopPropagation();
      closePanel();
    }
  }

  function newChat() {
    chatStore.clear();
    setDraft("");
    inputRef.current?.focus();
  }

  return (
    <>
      <section
        id={panelId}
        className={`ai-chat-panel${expanded ? " ai-chat-panel-expanded" : ""}`}
        data-open={open}
        inert={!open}
        role="dialog"
        aria-label="AI chat"
        onKeyDown={onPanelKeyDown}
      >
        <header className="ai-chat-header">
          <SparkIcon />
          <h2>AI chat</h2>
          {symbol && (
            <span className="ai-chat-context" title={`You're on ${name ?? symbol}'s pages, so questions about "it" mean ${symbol}`}>{symbol}</span>
          )}
          <div className="ai-chat-header-actions">
            {messages.length > 0 && (
              <button type="button" className="ai-chat-icon-button" onClick={newChat} aria-label="New chat" title="New chat">
                <Icon><path d="M10 4.5v11M4.5 10h11" /></Icon>
              </button>
            )}
            <button
              type="button"
              className="ai-chat-icon-button ai-chat-expand"
              onClick={() => setExpanded(!expanded)}
              aria-label={expanded ? "Make the chat smaller" : "Make the chat larger"}
              title={expanded ? "Smaller" : "Larger"}
            >
              <Icon>
                {expanded
                  ? <path d="M8.5 3.5v5h-5M11.5 16.5v-5h5M8.5 8.5 3.5 3.5M11.5 11.5l5 5" />
                  : <path d="M12 3.5h4.5V8M8 16.5H3.5V12M16.5 3.5 11 9M3.5 16.5 9 11" />}
              </Icon>
            </button>
            <button type="button" className="ai-chat-icon-button" onClick={closePanel} aria-label="Close the AI chat" title="Close (Esc)">
              <Icon><path d="m5 5 10 10M15 5 5 15" /></Icon>
            </button>
          </div>
        </header>

        <div className="ai-chat-scroll" ref={scrollRef} onScroll={onScroll}>
          {messages.length === 0 ? (
            <div className="ai-chat-intro">
              <h3>{symbol ? `Ask about ${name ? `${name} (${symbol})` : symbol}` : "Ask about any US stock"}</h3>
              <p>
                Answers come from StockPilot&apos;s data: quotes, financials, analysts&apos; forecasts, news, filings, insider
                trades, earnings calls and the market calendar, and your portfolio when you&apos;re signed in. Each answer
                links to the pages it read.
              </p>
              <ul className="ai-chat-suggestions" aria-label="Suggested questions">
                {suggestionsFor(symbol, name).map((suggestion) => (
                  <li key={suggestion}>
                    <button type="button" className="ai-chat-suggestion" onClick={() => send(suggestion)}>{suggestion}</button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="ai-chat-log" role="log" aria-label="Conversation">
              {messages.map((message) => (message.role === "user" ? (
                <div key={message.id} className="ai-chat-turn ai-chat-question">
                  <p>{message.text}</p>
                </div>
              ) : (
                <Answer key={message.id} message={message} />
              )))}
            </div>
          )}
        </div>

        <form className="ai-chat-composer" onSubmit={onSubmit}>
          <div className="ai-chat-input">
            <label className="visually-hidden" htmlFor={`${panelId}-input`}>Your question</label>
            <textarea
              id={`${panelId}-input`}
              ref={inputRef}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                resizeInput();
              }}
              onKeyDown={onInputKeyDown}
              rows={1}
              maxLength={MAX_MESSAGE_LENGTH}
              enterKeyHint="send"
              placeholder={symbol ? `Ask about ${symbol} or anything else…` : "Ask about a stock, the market or your portfolio…"}
            />
            {busy ? (
              <button type="button" className="ai-chat-send ai-chat-stop" onClick={chatStore.stop} aria-label="Stop the answer" title="Stop">
                <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="6" y="6" width="8" height="8" rx="1.5" fill="currentColor" /></svg>
              </button>
            ) : (
              <button type="submit" className="ai-chat-send" disabled={!draft.trim()} aria-label="Send" title="Send (Enter)">
                <Icon><path d="M10 15.5v-11M5.5 9 10 4.5 14.5 9" /></Icon>
              </button>
            )}
          </div>
          <p className="ai-chat-disclaimer">Written by Gemini from StockPilot&apos;s data. It can be wrong, and it isn&apos;t investment advice.</p>
        </form>
      </section>

      <button
        ref={launcherRef}
        type="button"
        className={`ai-chat-launcher${open ? " ai-chat-launcher-open" : ""}`}
        onClick={open ? closePanel : openPanel}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close the AI chat" : unread ? "Open the AI chat: an answer is ready" : "Open the AI chat"}
        title="AI chat"
      >
        {open ? <Icon><path d="m5.5 8 4.5 4.5L14.5 8" /></Icon> : <SparkIcon />}
        {unread && !open && <span className="ai-chat-unread" aria-hidden="true" />}
      </button>
    </>
  );
}
