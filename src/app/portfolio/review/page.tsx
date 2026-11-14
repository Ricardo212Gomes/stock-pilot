import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../../components/app-shell";
import { ChatMarkdown } from "../../components/ai-chat-markdown";
import { currentUserId, isAuthConfigured, signIn } from "@/auth";
import { parseMarkdown } from "@/lib/chat/markdown";
import { isDatabaseConfigured } from "@/lib/db";
import { formatDay } from "@/lib/portfolio";
import { getLatestReview, type ReviewWithReport } from "@/lib/portfolio-reviews";
import { formatMoney } from "@/lib/valuation/format";
import { RatingBadge } from "../ai-reviews";

export const metadata: Metadata = {
  title: "AI review — StockPilot",
  description: "TradingAgents' latest review of one of your holdings: the rating, the plan and each agent's report.",
};

type ReviewPageProps = { searchParams: Promise<{ symbol?: string | string[] }> };

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

function Report({ review }: { review: ReviewWithReport }) {
  return (
    <>
      <div className="portfolio-cards">
        <section className="portfolio-card" aria-label="Rating">
          <p className="portfolio-card-label">Rating</p>
          <p className="portfolio-card-value"><RatingBadge rating={review.rating} /></p>
          <p className="portfolio-card-detail">Reviewed {formatDay(review.analysisDate)}</p>
        </section>
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
      </div>
      <section className="portfolio-section" aria-labelledby="review-plan-heading">
        <h2 id="review-plan-heading">The plan</h2>
        <p className="ai-run-summary">{review.summary}</p>
      </section>
      {review.sections.map((section) => (
        <section key={section.id} className="portfolio-section portfolio-review-report" aria-labelledby={`review-${section.id}`}>
          <h2 id={`review-${section.id}`}>{section.title}</h2>
          <ChatMarkdown blocks={parseMarkdown(section.text)} />
        </section>
      ))}
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
      <section className="company-heading">
        <div>
          <p className="section-label"><Link href="/portfolio">PORTFOLIO</Link></p>
          <div className="company-title-row">
            <h1>{symbol ? `${symbol}: AI review` : "AI review"}</h1>
          </div>
          <p className="company-subtitle">TradingAgents&apos; latest review of this holding, against your position.</p>
        </div>
      </section>
      <ReviewBody symbol={symbol} />
    </AppShell>
  );
}
