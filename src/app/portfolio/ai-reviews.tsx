import Link from "next/link";
import { CompanyLogo } from "../components/company-logo";
import { formatDay } from "@/lib/portfolio";
import { STALE_DAYS, type Rating, type ReviewSummary } from "@/lib/portfolio-reviews";
import { formatMoney } from "@/lib/valuation/format";
import { AiReviewsSwitch } from "./ai-reviews-switch";
import { ReviewRow } from "./review-row";

// TradingAgents' reviews of the user's holdings on the Portfolio page (see docs/portfolio-reviews.md): a badge per
// holding in Holdings, and a section with every holding's latest rating, what changed, and the switch.

export type PortfolioReviews = { enabled: boolean; summaries: ReviewSummary[] };

export function reviewHref(symbol: string): string {
  return `/portfolio/review?symbol=${encodeURIComponent(symbol)}`;
}

function badgeClass(rating: Rating): string {
  if (rating === "Buy" || rating === "Overweight") return "portfolio-badge portfolio-badge-buy";
  if (rating === "Sell" || rating === "Underweight") return "portfolio-badge portfolio-badge-sell";
  return "portfolio-badge";
}

export function RatingBadge({ rating }: { rating: Rating }) {
  return <span className={badgeClass(rating)}>{rating === "Review" ? "No rating" : rating}</span>;
}

// The Holdings table's cell: the latest rating and its date, linking to the report.
export function ReviewCell({ review }: { review: ReviewSummary | undefined }) {
  if (!review) return <span className="portfolio-review-none">Not yet</span>;
  return (
    <Link className="portfolio-review-link" href={reviewHref(review.symbol)}>
      <RatingBadge rating={review.rating} />
      <small className={review.stale ? "portfolio-review-stale" : undefined}>{formatDay(review.analysisDate)}</small>
    </Link>
  );
}

function change(review: ReviewSummary): string | null {
  return review.previousRating && review.previousRating !== review.rating ? `was ${review.previousRating}` : null;
}

export function AiReviews({ reviews, holdings }: { reviews: PortfolioReviews; holdings: number }) {
  const { enabled, summaries } = reviews;
  const changed = summaries.filter((review) => change(review) !== null).length;
  return (
    <section className="portfolio-section" aria-labelledby="portfolio-reviews-heading">
      <h2 id="portfolio-reviews-heading">AI reviews</h2>
      {!enabled ? (
        <p className="portfolio-note">
          TradingAgents, a team of AI agents (market and news analysts, a bull and a bear researcher, a trader, a risk team
          and a portfolio manager), reviews one or two of your holdings a day against your actual position, and rates each
          Buy, Overweight, Hold, Underweight or Sell with its reasons. Turning it on sends your holdings&apos; tickers, shares
          and average cost to Google&apos;s Gemini API.
        </p>
      ) : summaries.length === 0 ? (
        <p className="portfolio-empty">
          Reviews are on. The daily run reviews two holdings at a time, so the first ratings appear after its next run; all
          {" "}{holdings} within about {Math.max(1, Math.ceil(holdings / 2))} days.
        </p>
      ) : (
        <>
          <p className="portfolio-note">
            {summaries.length} of {holdings} holdings reviewed{changed > 0 ? `; ${changed} changed rating since their last review` : ""}. Holdings rated
            Underweight or Sell come first. A review older than {STALE_DAYS} days is greyed out.
          </p>
          <div className="table-scroll">
            <table className="financial-table portfolio-table portfolio-reviews">
              <thead>
                <tr>
                  <th scope="col">Company</th>
                  <th scope="col">Rating</th>
                  <th scope="col" className="portfolio-optional">Target</th>
                  <th scope="col" className="portfolio-optional">Horizon</th>
                  <th scope="col" className="portfolio-optional">Reviewed</th>
                  <th scope="col">Plan</th>
                </tr>
              </thead>
              <tbody>
                {summaries.map((review) => (
                  <ReviewRow key={review.symbol} href={reviewHref(review.symbol)} className={review.stale ? "portfolio-review-stale" : undefined}>
                    <th scope="row">
                      <Link className="favorites-company" href={reviewHref(review.symbol)}>
                        <span className="earnings-logo-box"><CompanyLogo symbol={review.symbol} /></span>
                        <span><strong>{review.symbol}</strong></span>
                      </Link>
                    </th>
                    <td>
                      <RatingBadge rating={review.rating} />
                      {change(review) && <small>{change(review)}</small>}
                    </td>
                    <td className="portfolio-optional">{review.priceTarget === null ? "—" : formatMoney(review.priceTarget, "USD")}</td>
                    <td className="portfolio-optional">{review.horizon ?? "—"}</td>
                    <td className="portfolio-optional">{formatDay(review.analysisDate)}</td>
                    <td className="portfolio-review-plan">
                      {review.summary}
                    </td>
                  </ReviewRow>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <AiReviewsSwitch enabled={enabled} />
      <p className="portfolio-note">
        Written by AI agents from market data and news. They can be wrong, and the ratings aren&apos;t investment advice.
      </p>
    </section>
  );
}
