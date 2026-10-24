import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../components/app-shell";
import { CompanyLogo } from "../components/company-logo";
import { FavoriteButton } from "../components/favorite-button";
import { currentUserId, isAuthConfigured, signIn } from "@/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { listFavorites, MAX_FAVORITES, type Favorite } from "@/lib/favorites";
import { getQuote } from "@/lib/stock-overview";
import { formatMoney, formatSignedPercent } from "@/lib/valuation/format";

export const metadata: Metadata = {
  title: "Favorites — StockPilot",
  description: "The companies you follow, with their latest prices.",
};

function Notice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="empty-state empty-state-info" role="status">
      <span className="empty-state-icon" aria-hidden="true">★</span>
      <div>
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}

async function FavoritesBody() {
  if (!isAuthConfigured()) {
    return <Notice title="Sign-in isn't set up"><p>Favorites are saved to your Google account. Add the Google sign-in keys to the environment file (see docs/auth.md).</p></Notice>;
  }
  if (!isDatabaseConfigured()) {
    return <Notice title="No database connected"><p>Favorites are stored in Postgres. Set DATABASE_URL and run <code>npm run db:setup</code> (see docs/favorites.md).</p></Notice>;
  }

  const userId = await currentUserId();
  if (!userId) {
    return (
      <Notice title="Sign in to see your favorites">
        <p>Star companies from their overview page to follow them here.</p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/favorites" });
          }}
        >
          <button className="favorites-sign-in" type="submit">Sign in with Google</button>
        </form>
      </Notice>
    );
  }

  let favorites: Favorite[];
  try {
    favorites = await listFavorites(userId);
  } catch {
    return <Notice title="We couldn't load your favorites"><p>The database didn&apos;t respond. Check DATABASE_URL and that <code>npm run db:setup</code> has run.</p></Notice>;
  }
  if (favorites.length === 0) {
    return <Notice title="No favorites yet"><p>Open a company and select <strong>Add to favorites</strong> next to its name to follow it here.</p></Notice>;
  }

  const quotes = await Promise.all(favorites.map((favorite) => getQuote(favorite.symbol)));
  return (
    <>
      <p className="earnings-summary">
        {favorites.length} of {MAX_FAVORITES} favorites, newest first. Prices are cached for a few minutes.
      </p>
      <div className="table-scroll">
        <table className="financial-table favorites-table">
          <thead>
            <tr>
              <th scope="col">Company</th>
              <th scope="col">Price</th>
              <th scope="col">Change</th>
              <th scope="col" className="favorites-optional">Market cap</th>
              <th scope="col" className="favorites-optional">Tools</th>
              <th scope="col"><span className="visually-hidden">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {favorites.map(({ symbol }, index) => {
              const quote = quotes[index].ok ? quotes[index].data : null;
              const href = (path: string) => `${path}?symbol=${encodeURIComponent(symbol)}`;
              return (
                <tr key={symbol}>
                  <th scope="row">
                    <Link className="favorites-company" href={href("/stock")}>
                      <span className="earnings-logo-box"><CompanyLogo symbol={symbol} /></span>
                      <span>
                        <strong>{symbol}</strong>
                        <small>{quote?.name ?? "Quote unavailable"}</small>
                      </span>
                    </Link>
                  </th>
                  <td>{quote ? formatMoney(quote.price, "USD") : "—"}</td>
                  <td className={quote?.changePercent == null ? "" : quote.changePercent >= 0 ? "positive-value" : "negative-value"}>
                    {quote?.changePercent == null ? "—" : formatSignedPercent(quote.changePercent)}
                  </td>
                  <td className="favorites-optional">{quote?.marketCap ? formatMoney(quote.marketCap, "USD", true) : "—"}</td>
                  <td className="favorites-links favorites-optional">
                    <Link href={href("/stock/financials")}>Financials</Link>
                    <Link href={href("/valuation/intrinsic-value")}>Value</Link>
                    <Link href={href("/news")}>News</Link>
                  </td>
                  <td><FavoriteButton symbol={symbol} initial signedIn compact /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function FavoritesPage() {
  return (
    <AppShell contentClassName="dashboard-content" activeSection="favorites">
      <section className="company-heading">
        <div>
          <p className="section-label">WORKSPACE</p>
          <div className="company-title-row">
            <h1>Favorites</h1>
          </div>
          <p className="company-subtitle">The companies you follow, with today&apos;s price and quick links to each tool.</p>
        </div>
      </section>
      <FavoritesBody />
    </AppShell>
  );
}
