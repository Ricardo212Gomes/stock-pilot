import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../../components/app-shell";
import { ChatMarkdown } from "../../components/ai-chat-markdown";
import { CompanyLogo } from "../../components/company-logo";
import { currentUserId, isAuthConfigured, signIn } from "@/auth";
import { parseMarkdown } from "@/lib/chat/markdown";
import { isDatabaseConfigured } from "@/lib/db";
import { listedName } from "@/lib/listed-companies";
import { formatDay } from "@/lib/portfolio";
import { getLatestReview, type ReviewSection, type ReviewWithReport, type SectionGroup } from "@/lib/portfolio-reviews";
import { formatMoney, formatSignedPercent } from "@/lib/valuation/format";
import { ratingTone } from "../ai-reviews";

export const metadata: Metadata = {
  title: "AI review — StockPilot",
  description: "TradingAgents' latest review of one of your holdings: the rating, the plan and each agent's report.",
};

type ReviewPageProps = { searchParams: Promise<{ symbol?: string | string[] }> };

const GROUP_LABELS: Record<SectionGroup, string> = {
  Decision: "The decision",
  Research: "Research debate",
  Risk: "Risk debate",
  Analysts: "Analysts' reports",
};

function readSymbol(value: string | string[] | undefined): string | null {
  const symbol = (Array.isArray(value) ? value[0] : value)?.trim().toUpperCase() ?? "";
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) ? symbol : null;
}

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="empty-state empty-state-info" role="status">
      <span className="empty-state-icon" aria-hidden="true">i</span>
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}

function Masthead({ review }: { review: ReviewWithReport }) {
  const name = listedName(review.symbol);
  const rating = review.rating === "Review" ? "No rating" : review.rating;
  // The target against what the position cost: what the plan would make or lose on it.
  const versusCost = review.priceTarget !== null && review.averageCost > 0 ? review.priceTarget / review.averageCost - 1 : null;
  return (
    <>
      <section className="review-masthead">
        <span className="earnings-logo-box review-masthead-logo"><CompanyLogo symbol={review.symbol} /></span>
        <div>
          <p className="section-label"><Link href="/portfolio">PORTFOLIO</Link> · AI REVIEW</p>
          <h1>
            {review.symbol} <span className={`review-rating review-rating-${ratingTone(review.rating)}`}>{rating}</span>
          </h1>
          <p className="company-subtitle">
            {name ? `${name} · ` : ""}Reviewed {formatDay(review.analysisDate)} by TradingAgents, against your position
          </p>
        </div>
      </section>
      <div className="portfolio-cards">
        <section className="portfolio-card" aria-label="Price target">
          <p className="portfolio-card-label">Price target</p>
          <p className="portfolio-card-value">{review.priceTarget === null ? "—" : formatMoney(review.priceTarget, "USD")}</p>
          <p className="portfolio-card-detail">{review.horizon ? `Over ${review.horizon}` : "No horizon given"}</p>
        </section>
        <section className="portfolio-card" aria-label="Your position">
          <p className="portfolio-card-label">Your position, as reviewed</p>
          <p className="portfolio-card-value">{review.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })} shares</p>
          <p className="portfolio-card-detail">At {formatMoney(review.averageCost, "USD")} average cost</p>
        </section>
        <section className="portfolio-card" aria-label="Target against your cost">
          <p className="portfolio-card-label">Target against your cost</p>
          <p className={`portfolio-card-value ${versusCost === null ? "" : versusCost >= 0 ? "positive-value" : "negative-value"}`}>
            {versusCost === null ? "—" : formatSignedPercent(versusCost)}
          </p>
          <p className="portfolio-card-detail">The target over your average cost</p>
        </section>
      </div>
      <section className={`review-plan review-tone-${ratingTone(review.rating)}`} aria-labelledby="review-plan-heading">
        <h2 id="review-plan-heading">The plan</h2>
        <p>{review.summary}</p>
      </section>
    </>
  );
}

function Contents({ sections }: { sections: ReviewSection[] }) {
  const groups = [...new Set(sections.map((section) => section.group))];
  return (
    <nav className="review-contents" aria-label="The agents' reports">
      <p className="section-label">THE AGENTS</p>
      {groups.map((group) => (
        <div key={group}>
          <p className="review-contents-group">{GROUP_LABELS[group]}</p>
          <ul>
            {sections.filter((section) => section.group === group).map((section) => (
              <li key={section.id}>
                <a className={`review-tone-${section.tone}`} href={`#review-${section.id}`}>
                  <span className="review-dot" aria-hidden="true" />
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function SectionCard({ section }: { section: ReviewSection }) {
  return (
    <details id={`review-${section.id}`} className={`review-section review-tone-${section.tone}`} open={section.open}>
      <summary>
        <span className="review-section-group">{GROUP_LABELS[section.group]}</span>
        <span className="review-section-title">
          <span className="review-dot" aria-hidden="true" />
          {section.title}
        </span>
        <span className="review-section-preview">{section.preview}</span>
      </summary>
      <div className="review-section-body">
        <ChatMarkdown blocks={parseMarkdown(section.text)} />
      </div>
    </details>
  );
}

function Report({ review }: { review: ReviewWithReport }) {
  return (
    <>
      <Masthead review={review} />
      <div className="review-layout">
        <div className="review-sections">
          {review.sections.map((section) => <SectionCard key={section.id} section={section} />)}
        </div>
        <Contents sections={review.sections} />
      </div>
      <div className="news-footnote portfolio-footnote">
        <p>
          By TradingAgents{review.model ? ` on ${review.model}` : ""}: market and news analysts, a bull and a bear researcher,
          a trader, three risk analysts and a portfolio manager, given your shares and average cost. Written by AI from market
          data and news. It can be wrong, and it isn&apos;t investment advice.
        </p>
      </div>
    </>
  );
}

async function ReviewBody({ symbol }: { symbol: string | null }) {
  if (!isAuthConfigured() || !isDatabaseConfigured()) {
    return <Notice title="Reviews aren't set up"><p>They need Google sign-in and a database (see docs/portfolio-reviews.md).</p></Notice>;
  }
  const userId = await currentUserId();
  if (!userId) {
    return (
      <Notice title="Sign in to see your reviews">
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: symbol ? `/portfolio/review?symbol=${encodeURIComponent(symbol)}` : "/portfolio" });
          }}
        >
          <button className="favorites-sign-in" type="submit">Sign in with Google</button>
        </form>
      </Notice>
    );
  }
  if (!symbol) return <Notice title="Choose a holding"><p>Open a review from the AI review column on the <Link href="/portfolio">Portfolio</Link>.</p></Notice>;
  const review = await getLatestReview(userId, symbol).catch(() => null);
  if (!review) {
    return <Notice title={`No review of ${symbol} yet`}><p>The daily run reviews two holdings at a time; see the AI reviews section on the <Link href="/portfolio">Portfolio</Link>.</p></Notice>;
  }
  return <Report review={review} />;
}

export default async function ReviewPage({ searchParams }: ReviewPageProps) {
  const symbol = readSymbol((await searchParams).symbol);
  return (
    <AppShell contentClassName="dashboard-content" activeSection="portfolio" headerLabel={symbol ? `${symbol} · AI review` : "AI review"} dataSource="Reviews by TradingAgents on Google Gemini">
      <ReviewBody symbol={symbol} />
    </AppShell>
  );
}
