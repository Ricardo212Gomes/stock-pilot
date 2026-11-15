import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../../components/app-shell";
import { currentUserId, isAuthConfigured, signIn } from "@/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { listSavedProjections, MAX_SAVED_PROJECTIONS, type SavedProjectionSummary } from "@/lib/saved-projections";
import { sortSaved, type SavedOrder as Order, type SavedSort as Sort } from "@/lib/saved-projection-inputs";
import { SavedProjectionsTable, withPricesNow } from "../saved-table";

export const metadata: Metadata = {
  title: "Saved projections — StockPilot",
  description: "Every projection you saved, with the value then and the price now.",
};

type SavedPageProps = { searchParams: Promise<{ sort?: string | string[]; order?: string | string[] }> };

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

function SortLink({ sort, order, current, children }: { sort: Sort; order: Order; current: { sort: Sort; order: Order }; children: React.ReactNode }) {
  const active = current.sort === sort && current.order === order;
  return (
    <Link
      href={`/valuation/saved?sort=${sort}&order=${order}`}
      className={active ? "chart-view-active" : ""}
      aria-current={active ? "true" : undefined}
    >
      {children}
    </Link>
  );
}

async function SavedBody({ sort, order }: { sort: Sort; order: Order }) {
  if (!isAuthConfigured()) {
    return <Notice title="Sign-in isn't set up"><p>Saved projections belong to your Google account. Add the Google sign-in keys to the environment file (see docs/auth.md).</p></Notice>;
  }
  if (!isDatabaseConfigured()) {
    return <Notice title="No database connected"><p>Saved projections are stored in Postgres. Set DATABASE_URL and run <code>npm run db:setup</code> (see docs/favorites.md).</p></Notice>;
  }
  const userId = await currentUserId();
  if (!userId) {
    return (
      <Notice title="Sign in to see your saved projections">
        <p>Save a projection from Intrinsic Value, Jeremy&apos;s Projection or the Plumas Projection to find it here on any device.</p>
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/valuation/saved" });
          }}
        >
          <button className="favorites-sign-in" type="submit">Sign in with Google</button>
        </form>
      </Notice>
    );
  }

  let list: SavedProjectionSummary[];
  try {
    list = await listSavedProjections(userId);
  } catch {
    return <Notice title="We couldn't load your saved projections"><p>The database didn&apos;t respond. Check DATABASE_URL and that <code>npm run db:setup</code> has run.</p></Notice>;
  }
  if (list.length === 0) {
    return (
      <Notice title="Nothing saved yet">
        <p>Open a company&apos;s Valuation tab and select <strong>Save</strong> in any of its tools to keep a projection here.</p>
      </Notice>
    );
  }

  const rows = sortSaved(await withPricesNow(list), sort, order);
  const current = { sort, order };
  const companies = new Set(list.map(({ symbol }) => symbol)).size;
  return (
    <>
      <div className="saved-toolbar">
        <p className="earnings-summary">
          {list.length} of {MAX_SAVED_PROJECTIONS} saved, across {companies} {companies === 1 ? "company" : "companies"}. Prices are cached for a minute.
        </p>
        <nav className="chart-view-switch" aria-label="Sort saved projections">
          <SortLink sort="date" order="desc" current={current}>Newest</SortLink>
          <SortLink sort="date" order="asc" current={current}>Oldest</SortLink>
          <SortLink sort="gap" order="desc" current={current}>Largest gap</SortLink>
          <SortLink sort="gap" order="asc" current={current}>Smallest gap</SortLink>
        </nav>
      </div>
      <SavedProjectionsTable rows={rows} showCompany />
      <p className="table-footnote">
        Value then is the value per share when it was saved: Intrinsic Value&apos;s blended value, or the base
        scenario&apos;s price target for the last projected year. The gap is that value against today&apos;s price.
      </p>
    </>
  );
}

export default async function SavedProjectionsPage({ searchParams }: SavedPageProps) {
  const params = await searchParams;
  const sort: Sort = params.sort === "gap" ? "gap" : "date";
  const order: Order = params.order === "asc" ? "asc" : "desc";
  return (
    <AppShell contentClassName="dashboard-content" activeSection="saved-projections">
      <section className="company-heading">
        <div>
          <p className="section-label">WORKSPACE</p>
          <div className="company-title-row">
            <h1>Saved projections</h1>
          </div>
          <p className="company-subtitle">Every projection you saved, in every company and tool, with the value then and the price now.</p>
        </div>
      </section>
      <SavedBody sort={sort} order={order} />
    </AppShell>
  );
}
