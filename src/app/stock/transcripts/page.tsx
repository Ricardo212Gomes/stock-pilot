import Link from "next/link";
import { AppShell } from "../../components/app-shell";
import { CompanyHeader } from "../../components/company-header";
import { companyMetadata } from "../../components/company-metadata";
import { StockNav } from "../../components/stock-nav";
import { normalizeTicker } from "@/lib/fmp";
import { listedName } from "@/lib/listed-companies";
import { getHeaderQuote } from "@/lib/stock-overview";
import { getSavedSummary } from "@/lib/transcript-summary";
import { TranscriptSummaryCard } from "./transcript-summary";
import {
  OLD_EMPTY_RETRY_MS,
  getTranscript,
  isFiscalQuarter,
  latestReportedQuarter,
  quarterLabel,
  recentQuarters,
  savedQuarters,
  transcriptFailureMessage,
  type FiscalQuarter,
  type TranscriptResult,
  type TranscriptSegment,
} from "@/lib/transcripts";

export const generateMetadata = companyMetadata("Transcripts", "Read a company's earnings calls, speaker by speaker, with an AI summary.");

type TranscriptsPageProps = {
  searchParams: Promise<{ symbol?: string | string[]; quarter?: string | string[] }>;
};

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sentimentTone(score: number | null): { className: string; label: string } | null {
  if (score === null) return null;
  if (score >= 0.3) return { className: "transcript-sentiment-positive", label: `Positive tone (${score.toFixed(1)})` };
  if (score <= -0.3) return { className: "transcript-sentiment-negative", label: `Negative tone (${score.toFixed(1)})` };
  return null;
}

// The operator's first mention of questions after the prepared remarks starts the Q&A.
function questionsStart(segments: TranscriptSegment[]): number {
  return segments.findIndex((segment, index) => index > 1 && segment.speaker === "Operator" && /question/i.test(segment.content));
}

function Transcript({ segments }: { segments: TranscriptSegment[] }) {
  const qa = questionsStart(segments);
  const speakers = new Map<string, string | null>();
  for (const segment of segments) if (segment.speaker !== "Operator" && !speakers.has(segment.speaker)) speakers.set(segment.speaker, segment.title);

  return (
    <>
      <section className="transcript-participants" aria-labelledby="participants-heading">
        <h2 id="participants-heading">Participants</h2>
        <ul>
          {[...speakers].map(([name, title]) => (
            <li key={name}><strong>{name}</strong>{title && <span>{title}</span>}</li>
          ))}
        </ul>
        {qa > 0 && <a className="transcript-jump" href="#questions">Jump to questions and answers ↓</a>}
      </section>
      <div className="transcript">
        {segments.map((segment, index) => {
          const tone = sentimentTone(segment.sentiment);
          return (
            <div key={index}>
              {index === qa && <h2 className="transcript-divider" id="questions">Questions and answers</h2>}
              <article className={`transcript-turn${segment.speaker === "Operator" ? " transcript-turn-operator" : ""}`}>
                <header>
                  <strong>{segment.speaker}</strong>
                  {segment.title && segment.title !== segment.speaker && <span>{segment.title}</span>}
                  {tone && <span className={`transcript-sentiment ${tone.className}`} title={tone.label}>{tone.label.split(" (")[0]}</span>}
                </header>
                <p>{segment.content}</p>
              </article>
            </div>
          );
        })}
      </div>
    </>
  );
}

export default async function TranscriptsPage({ searchParams }: TranscriptsPageProps) {
  const params = await searchParams;
  const symbol = normalizeTicker(single(params.symbol)) ?? "AAPL";
  const requested = single(params.quarter);

  const [quote, latest] = await Promise.all([getHeaderQuote(symbol), latestReportedQuarter(symbol)]);
  const quarters = recentQuarters(latest);
  let quarter: FiscalQuarter = isFiscalQuarter(requested) ? requested : latest;
  let result: TranscriptResult = await getTranscript(symbol, quarter, isFiscalQuarter(requested) && requested !== latest ? { emptyRetryMs: OLD_EMPTY_RETRY_MS } : {});
  let fellBack = false;
  // The newest call is often not transcribed yet, and some companies' recent calls are missing:
  // by default, walk back up to four quarters to the latest one Alpha Vantage has.
  if (!isFiscalQuarter(requested)) {
    for (const earlier of quarters.slice(1, 5)) {
      if (result.ok || result.reason !== "unavailable") break;
      const attempt = await getTranscript(symbol, earlier, { emptyRetryMs: OLD_EMPTY_RETRY_MS });
      if (attempt.ok || attempt.reason !== "unavailable") {
        quarter = earlier;
        result = attempt;
        fellBack = attempt.ok;
      }
    }
  }
  const [known, savedSummary] = await Promise.all([
    savedQuarters(symbol, quarters),
    result.ok ? getSavedSummary(symbol, quarter) : Promise.resolve(null),
  ]);
  const companyName = quote.ok ? quote.data.name : listedName(symbol) ?? symbol;

  return (
    <AppShell contentClassName="dashboard-content" tickerValue={symbol} headerLabel={`${symbol} · Transcripts`} dataSource="Transcripts from Alpha Vantage">
      <CompanyHeader symbol={symbol} quote={quote} />
      <StockNav symbol={symbol} active="transcripts" />

      <div className="statement-toolbar">
        <nav className="statement-tabs transcript-quarters" aria-label="Fiscal quarter">
          {(quarters.includes(quarter) ? quarters : [quarter, ...quarters]).map((item) => (
            <Link
              key={item}
              href={`/stock/transcripts?symbol=${encodeURIComponent(symbol)}&quarter=${item}`}
              className={item === quarter ? "statement-tab-active" : known.get(item) === false ? "transcript-quarter-missing" : ""}
              aria-current={item === quarter ? "page" : undefined}
              title={known.get(item) === false ? "Alpha Vantage doesn't have this call" : undefined}
            >
              {quarterLabel(item)}
            </Link>
          ))}
        </nav>
      </div>

      <section className="company-heading">
        <div>
          <p className="section-label">EARNINGS CALL</p>
          <div className="company-title-row">
            <h2>{companyName} {quarterLabel(quarter)} earnings call</h2>
          </div>
          <p className="company-subtitle">
            {fellBack
              ? `Alpha Vantage doesn't have the ${quarterLabel(latest)} call yet, so this is the latest one it has.`
              : "Fiscal quarters follow the company's own fiscal year."}
          </p>
        </div>
      </section>

      {result.ok ? (
        <>
          <TranscriptSummaryCard
            key={`${symbol}:${quarter}`}
            symbol={symbol}
            quarter={quarter}
            quarterLabel={quarterLabel(quarter)}
            company={companyName}
            initial={savedSummary}
          />
          <Transcript segments={result.segments} />
        </>
      ) : (
        <section className={`empty-state${result.reason === "unavailable" ? " empty-state-info" : ""}`} role="status">
          <span className="empty-state-icon" aria-hidden="true">{result.reason === "unavailable" ? "i" : "!"}</span>
          <div>
            <h2>{result.reason === "unavailable" ? "No transcript yet" : "We couldn't load this transcript"}</h2>
            <p>{transcriptFailureMessage(result.reason, quarter)}</p>
          </div>
        </section>
      )}

      <p className="news-footnote">
        Transcripts from Alpha Vantage, with its sentiment score for each passage. The free key allows 25 requests a day,
        so each transcript is saved after it first loads.
      </p>
    </AppShell>
  );
}
